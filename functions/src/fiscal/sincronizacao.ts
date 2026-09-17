/**
 * Sincronização dos documentos fiscais de uma empresa com o Ambiente Nacional da NF-e.
 *
 * Fluxo (NT 2014.002, item 3.5):
 *   último NSU guardado → consulta distNSU → lote de até 50 documentos → grava cada um →
 *   atualiza o NSU → repete enquanto ultNSU < maxNSU → para e agenda a próxima janela.
 *
 * Três garantias que o desenho precisa ter:
 *  - **por tenant**: o NSU é de cada CNPJ, nunca global; tudo é lido e escrito dentro de
 *    /empresas/{id}/... e o id do tenant é sempre validado no backend, nunca aceito do cliente;
 *  - **idempotente**: o documento da nota usa a chave de acesso como id, o XML só é regravado
 *    quando o hash muda e o resumo nunca sobrescreve uma NF-e completa já baixada;
 *  - **retomável**: o NSU é gravado a cada lote, então uma execução interrompida continua
 *    de onde parou, e a trava expira sozinha se a function morrer no meio.
 */
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { logger } from 'firebase-functions'
import { db, storage } from '../lib/admin'
import { FISCAL_MAX_LOTES } from '../lib/config'
import {
  RETORNO,
  explicarRetorno,
  type AmbienteFiscal,
  type DistribuicaoDFeProvider,
  type RespostaDistribuicao,
} from '../providers/fiscal/DistribuicaoDFeProvider'
import { SefazDistribuicaoProvider, UF_IBGE, formatarNsu } from '../providers/fiscal/sefazNacional'
import { decifrar } from './certificado'
import { eventoCancelaNota, lerDocumento } from './documento'
import {
  caminhoXml,
  configFiscalRef,
  notasRef,
  privadoFiscalRef,
  sincronizacoesRef,
  type ConfiguracaoFiscal,
  type EventoNota,
  type NotaFiscal,
  type PrivadoFiscal,
  type Sincronizacao,
  type SituacaoSync,
} from './modelo'
import { analisarXml } from './xml'

/** Uma trava mais velha que isso é considerada órfã (function morta, deploy no meio, timeout). */
const LOCK_EXPIRA_MS = 10 * 60 * 1000
/** Janela obrigatória entre consultas quando não há mais documentos (NT 2014.002, item 3.11.4). */
export const ESPERA_SEM_DOCUMENTOS_MS = 60 * 60 * 1000
/** Serviço paralisado (108/109): tentamos de novo antes da hora cheia. */
const ESPERA_INDISPONIVEL_MS = 30 * 60 * 1000

// ---------- regras de NSU (puras, para poderem ser testadas sozinhas) ----------

export interface PassoSincronizacao {
  /** 'continuar' pede outro lote; 'parar' encerra a varredura desta execução */
  acao: 'continuar' | 'parar'
  /** NSU que deve ser guardado e usado na próxima requisição */
  nsu: string
  situacao: SituacaoSync
  esperaMs: number
  /** Só o 138 traz documentos para gravar */
  temDocumentos: boolean
  /** 'rejeicao' é erro que a empresa precisa ver na tela; 'indisponivel' é só tentar de novo */
  motivo?: 'rejeicao' | 'indisponivel'
}

/**
 * Traduz o retorno da SEFAZ para o próximo passo, seguindo a NT 2014.002:
 *  138 → grava o lote e continua a partir do ultNSU devolvido; se ultNSU == maxNSU, espera 1 h;
 *  137 → não há mais nada agora: espera 1 h (consultar antes disso vira consumo indevido);
 *  656 → CNPJ bloqueado por 1 h; a rejeição traz o ultNSU, que aproveitamos para reposicionar;
 *  589 → nosso NSU passou do maior da SEFAZ: volta para o maxNSU informado;
 *  108/109 → serviço paralisado: tenta de novo antes da hora cheia;
 *  demais → rejeição; para e mostra o motivo na tela.
 */
export function avaliarResposta(
  resposta: Pick<RespostaDistribuicao, 'cStat' | 'ultNSU' | 'maxNSU'>,
  nsuAtual: string,
): PassoSincronizacao {
  const ultNSU = resposta.ultNSU ? formatarNsu(resposta.ultNSU) : undefined
  const maxNSU = resposta.maxNSU ? formatarNsu(resposta.maxNSU) : undefined

  switch (resposta.cStat) {
    case RETORNO.DOCUMENTO_LOCALIZADO: {
      const nsu = ultNSU ?? nsuAtual
      const acabou = maxNSU !== undefined && Number(nsu) >= Number(maxNSU)
      return {
        acao: acabou ? 'parar' : 'continuar',
        nsu,
        situacao: 'aguardando',
        esperaMs: ESPERA_SEM_DOCUMENTOS_MS,
        temDocumentos: true,
      }
    }
    case RETORNO.NENHUM_DOCUMENTO:
      return { acao: 'parar', nsu: ultNSU ?? nsuAtual, situacao: 'aguardando', esperaMs: ESPERA_SEM_DOCUMENTOS_MS, temDocumentos: false }
    case RETORNO.CONSUMO_INDEVIDO:
      return {
        acao: 'parar',
        nsu: ultNSU && Number(ultNSU) > 0 ? ultNSU : nsuAtual,
        situacao: 'bloqueado',
        esperaMs: ESPERA_SEM_DOCUMENTOS_MS,
        temDocumentos: false,
      }
    case RETORNO.NSU_SUPERIOR_AO_MAXIMO:
      return { acao: 'parar', nsu: maxNSU ?? '000000000000000', situacao: 'aguardando', esperaMs: ESPERA_SEM_DOCUMENTOS_MS, temDocumentos: false }
    case RETORNO.PARALISADO_CURTO:
    case RETORNO.PARALISADO_SEM_PREVISAO:
      return { acao: 'parar', nsu: nsuAtual, situacao: 'erro', esperaMs: ESPERA_INDISPONIVEL_MS, temDocumentos: false, motivo: 'indisponivel' }
    default:
      return { acao: 'parar', nsu: nsuAtual, situacao: 'erro', esperaMs: ESPERA_SEM_DOCUMENTOS_MS, temDocumentos: false, motivo: 'rejeicao' }
  }
}

/**
 * O CNPJ consultado precisa ter a mesma raiz (8 primeiras posições) do CNPJ do certificado.
 * É a regra H04 da NT; sem ela a SEFAZ responde 593 — e, do nosso lado, seria a brecha para
 * uma empresa tentar puxar documentos de outro CNPJ.
 */
export function mesmaRaizCnpj(cnpjConsultado: string, cnpjCertificado: string): boolean {
  const a = (cnpjConsultado ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  const b = (cnpjCertificado ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return a.length >= 8 && b.length >= 8 && a.slice(0, 8) === b.slice(0, 8)
}

export interface ResultadoSincronizacao {
  empresaId: string
  executou: boolean
  motivo?: string
  nsuInicial: string
  nsuFinal: string
  maxNsu: string
  lotes: number
  documentosEncontrados: number
  documentosProcessados: number
  notasNovas: number
  notasAtualizadas: number
  eventos: number
  erros: number
  codigoRetorno?: string
  mensagemRetorno?: string
  duracaoMs: number
}

// ---------- credenciais ----------

export interface CredenciaisResolvidas {
  provider: DistribuicaoDFeProvider & { encerrar(): void }
  config: ConfiguracaoFiscal
  cnpj: string
  ambiente: AmbienteFiscal
}

/**
 * Monta o provedor da SEFAZ com o certificado da empresa.
 * A senha e o .pfx só existem decifrados dentro desta função e do agente TLS.
 */
export async function resolverCredenciais(empresaId: string, chaveMestra: string): Promise<CredenciaisResolvidas> {
  const [confSnap, privSnap] = await Promise.all([configFiscalRef(empresaId).get(), privadoFiscalRef(empresaId).get()])
  const config = confSnap.data() as ConfiguracaoFiscal | undefined
  const privado = privSnap.data() as PrivadoFiscal | undefined
  if (!config || !privado?.certificado) throw new Error('Integração fiscal sem certificado cadastrado.')

  const cert = privado.certificado
  const validoAte = cert.validoAte.toDate()
  if (validoAte.getTime() < Date.now()) {
    throw new Error(`Certificado digital vencido em ${validoAte.toLocaleDateString('pt-BR')}. Envie um certificado novo.`)
  }

  const cnpj = (config.cnpj || cert.documento).replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (cert.tipo === 'e-CNPJ' && !mesmaRaizCnpj(cnpj, cert.documento)) {
    throw new Error('O CNPJ configurado não tem a mesma raiz do CNPJ do certificado digital (a SEFAZ rejeita com o código 593).')
  }

  const provider = new SefazDistribuicaoProvider({
    cnpj,
    pfxBase64: decifrar(cert.arquivoCifrado, chaveMestra),
    senha: decifrar(cert.senhaCifrada, chaveMestra),
    ambiente: config.ambiente,
    cUFAutor: config.uf ? UF_IBGE[config.uf.toUpperCase()] : undefined,
  })

  return { provider, config, cnpj, ambiente: config.ambiente }
}

// ---------- trava de concorrência ----------

/**
 * Só uma sincronização por empresa de cada vez. A trava vive no próprio documento de
 * configuração e é tomada dentro de uma transação, então duas execuções simultâneas
 * (agendada + manual, ou duas instâncias da function) nunca passam juntas.
 */
async function tomarTrava(ref: DocumentReference, execucaoId: string, ignorarJanela: boolean): Promise<string | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const config = snap.data() as ConfiguracaoFiscal | undefined
    if (!config) return 'Integração fiscal não configurada.'
    if (!config.ativo) return 'Integração fiscal desativada.'

    const sync = config.sincronizacao
    const lockEm = sync?.lockEm?.toMillis?.()
    if (sync?.status === 'executando' && lockEm && Date.now() - lockEm < LOCK_EXPIRA_MS) {
      return 'Já existe uma sincronização em andamento para esta empresa.'
    }
    const proxima = sync?.proximaPermitidaEm?.toMillis?.()
    if (!ignorarJanela && proxima && proxima > Date.now()) {
      return `A SEFAZ só permite nova consulta a partir de ${new Date(proxima).toLocaleString('pt-BR')}.`
    }

    tx.update(ref, {
      'sincronizacao.status': 'executando',
      'sincronizacao.lockEm': FieldValue.serverTimestamp(),
      'sincronizacao.lockPor': execucaoId,
      atualizadoEm: FieldValue.serverTimestamp(),
    })
    return null
  })
}

/** Devolve a trava. Só mexe se ela ainda for nossa (evita apagar a trava de outra execução). */
async function soltarTrava(ref: DocumentReference, execucaoId: string, estado: Record<string, unknown>): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const config = snap.data() as ConfiguracaoFiscal | undefined
    if (config?.sincronizacao?.lockPor && config.sincronizacao.lockPor !== execucaoId) return
    tx.update(ref, {
      ...estado,
      'sincronizacao.lockEm': FieldValue.delete(),
      'sincronizacao.lockPor': FieldValue.delete(),
      atualizadoEm: FieldValue.serverTimestamp(),
    })
  })
}

// ---------- gravação dos documentos ----------

const hashDe = (xml: string) => createHash('sha256').update(xml, 'utf8').digest('hex')

async function guardarXml(empresaId: string, chave: string, sufixo: string, xml: string): Promise<string> {
  const caminho = caminhoXml(empresaId, chave, sufixo)
  await storage
    .bucket()
    .file(caminho)
    .save(Buffer.from(xml, 'utf8'), {
      contentType: 'application/xml; charset=utf-8',
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0' },
    })
  return caminho
}

interface Contadores {
  notasNovas: number
  notasAtualizadas: number
  eventos: number
  erros: number
  processados: number
}

/**
 * Grava um documento do lote. Idempotente: o id é a chave de acesso, o XML só sobe quando o
 * hash muda e um resumo que chega depois do XML completo não apaga o que já temos.
 */
async function gravarDocumento(
  empresaId: string,
  ambiente: AmbienteFiscal,
  doc: { nsu?: string; schema: string; xml: string },
  contadores: Contadores,
): Promise<void> {
  const raiz = analisarXml(doc.xml)
  const lido = lerDocumento(doc.xml, doc.schema, raiz)
  if (!lido.chaveAcesso) {
    logger.info('fiscal: documento ignorado (sem chave de acesso)', { empresaId, nsu: doc.nsu, schema: doc.schema })
    return
  }

  const ref = notasRef(empresaId).doc(lido.chaveAcesso)
  const atual = (await ref.get()).data() as NotaFiscal | undefined
  const agora = FieldValue.serverTimestamp()

  if (lido.evento) {
    const e = lido.evento
    const eventos = [...(atual?.eventos ?? [])]
    const chaveEvento = `${e.tpEvento}_${e.nSeqEvento}`
    const jaTem = eventos.some((x) => `${x.tpEvento}_${x.nSeqEvento}` === chaveEvento)
    const storagePath = await guardarXml(empresaId, e.chaveAcesso, `evento-${e.tpEvento}-${e.nSeqEvento}`, doc.xml)
    const novo: EventoNota = {
      tpEvento: e.tpEvento,
      descricao: e.descricao,
      nSeqEvento: e.nSeqEvento,
      dataEvento: e.dataEvento ? Timestamp.fromDate(e.dataEvento) : undefined,
      protocolo: e.protocolo,
      nsu: doc.nsu,
      storagePath,
    }
    if (jaTem) {
      const i = eventos.findIndex((x) => `${x.tpEvento}_${x.nSeqEvento}` === chaveEvento)
      eventos[i] = { ...eventos[i], ...limpar(novo) }
    } else {
      eventos.push(limpar(novo))
      contadores.eventos++
    }

    const patch: Record<string, unknown> = { eventos, atualizadoEm: agora }
    if (eventoCancelaNota(e.tpEvento)) patch.status = 'cancelada'
    if (!atual) {
      // evento de uma nota que ainda não recebemos: cria o registro só com a chave
      await ref.set(
        limpar({
          chaveAcesso: e.chaveAcesso,
          status: 'resumo',
          xmlCompleto: false,
          ambiente,
          nsu: doc.nsu,
          eventos,
          importadoEm: agora,
          criadoEm: agora,
          atualizadoEm: agora,
        }),
      )
      contadores.notasNovas++
    } else {
      await ref.set(limpar(patch), { merge: true })
      contadores.notasAtualizadas++
    }
    contadores.processados++
    return
  }

  const n = lido.nota
  if (!n) return

  const completo = lido.tipo === 'nfe'
  // um resumo que chega depois do XML completo não rebaixa o registro
  if (!completo && atual?.xmlCompleto) {
    await ref.set(limpar({ nsuResumo: doc.nsu, atualizadoEm: agora }), { merge: true })
    contadores.processados++
    contadores.notasAtualizadas++
    return
  }

  const hash = hashDe(doc.xml)
  const storagePath =
    atual?.hashXml === hash && atual.storagePath
      ? atual.storagePath
      : await guardarXml(empresaId, n.chaveAcesso, completo ? 'nfe' : 'resumo', doc.xml)

  const dados = limpar({
    chaveAcesso: n.chaveAcesso,
    numero: n.numero,
    serie: n.serie,
    modelo: n.modelo,
    naturezaOperacao: n.naturezaOperacao,
    tipoOperacao: n.tipoOperacao,
    dataEmissao: n.dataEmissao ? Timestamp.fromDate(n.dataEmissao) : undefined,
    cnpjEmitente: n.cnpjEmitente,
    razaoSocialEmitente: n.razaoSocialEmitente,
    ieEmitente: n.ieEmitente,
    ufEmitente: n.ufEmitente,
    cnpjDestinatario: n.cnpjDestinatario,
    razaoSocialDestinatario: n.razaoSocialDestinatario,
    valorTotal: n.valorTotal,
    protocolo: n.protocolo,
    dataAutorizacao: n.dataAutorizacao ? Timestamp.fromDate(n.dataAutorizacao) : undefined,
    // nota cancelada por evento continua cancelada mesmo se o XML vier depois
    status: atual?.status === 'cancelada' ? 'cancelada' : n.status,
    xmlCompleto: completo || Boolean(atual?.xmlCompleto),
    storagePath,
    hashXml: hash,
    produtos: n.produtos,
    ambiente,
    ...(completo ? { nsu: doc.nsu } : { nsuResumo: doc.nsu, nsu: atual?.nsu ?? doc.nsu }),
    importadoEm: atual?.importadoEm ?? agora,
    criadoEm: atual?.criadoEm ?? agora,
    atualizadoEm: agora,
  })

  await ref.set(dados, { merge: true })
  if (atual) contadores.notasAtualizadas++
  else contadores.notasNovas++
  contadores.processados++
}

/**
 * Firestore do Admin SDK recusa `undefined` (o `ignoreUndefinedProperties` do projeto é do SDK web).
 * Tira as chaves vazias em profundidade, preservando Timestamp, FieldValue e afins.
 */
function limpar<T extends object>(objeto: T): T {
  const podar = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.filter((v) => v !== undefined).map(podar)
    if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
      const saida: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(valor)) if (v !== undefined) saida[k] = podar(v)
      return saida
    }
    return valor
  }
  return podar(objeto) as T
}

// ---------- execução ----------

interface OpcoesSincronizacao {
  origem: 'agendada' | 'manual'
  /** Execução manual pode ignorar a janela de 1 h? Não: a SEFAZ bloqueia o CNPJ por consumo indevido. */
  ignorarJanela?: boolean
  maxLotes?: number
}

/**
 * Executa a sincronização de uma empresa de ponta a ponta.
 * Nunca lança por causa da SEFAZ: devolve o resultado com o código de retorno.
 */
export async function sincronizarEmpresa(
  empresaId: string,
  chaveMestra: string,
  opcoes: OpcoesSincronizacao,
): Promise<ResultadoSincronizacao> {
  const inicio = Date.now()
  const execucaoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const ref = configFiscalRef(empresaId)
  const vazio: ResultadoSincronizacao = {
    empresaId,
    executou: false,
    nsuInicial: '000000000000000',
    nsuFinal: '000000000000000',
    maxNsu: '000000000000000',
    lotes: 0,
    documentosEncontrados: 0,
    documentosProcessados: 0,
    notasNovas: 0,
    notasAtualizadas: 0,
    eventos: 0,
    erros: 0,
    duracaoMs: 0,
  }

  const impedimento = await tomarTrava(ref, execucaoId, opcoes.ignorarJanela === true)
  if (impedimento) {
    return { ...vazio, motivo: impedimento, duracaoMs: Date.now() - inicio }
  }

  let credenciais: CredenciaisResolvidas | undefined
  const contadores: Contadores = { notasNovas: 0, notasAtualizadas: 0, eventos: 0, erros: 0, processados: 0 }
  let nsuInicial = '000000000000000'
  let nsu = nsuInicial
  let maxNsu = '000000000000000'
  let lotes = 0
  let encontrados = 0
  let ultimaResposta: RespostaDistribuicao | undefined
  let esperaMs = ESPERA_SEM_DOCUMENTOS_MS
  let situacao: ConfiguracaoFiscal['sincronizacao']['status'] = 'aguardando'
  let detalheErro: string | undefined

  try {
    credenciais = await resolverCredenciais(empresaId, chaveMestra)
    nsuInicial = formatarNsu(credenciais.config.sincronizacao?.ultimoNsu ?? '0')
    nsu = nsuInicial
    maxNsu = formatarNsu(credenciais.config.sincronizacao?.maxNsu ?? '0')

    const limite = Math.max(1, opcoes.maxLotes ?? FISCAL_MAX_LOTES.value())
    logger.info('fiscal: sincronização iniciada', {
      empresaId,
      operacao: 'sincronizar',
      origem: opcoes.origem,
      ambiente: credenciais.ambiente,
      nsuInicial,
      execucaoId,
      // projetos novos usam <projeto>.firebasestorage.app; se vier o nome errado,
      // a falha só apareceria ao gravar o primeiro XML — melhor deixar registrado aqui
      bucket: storage.bucket().name,
    })

    while (lotes < limite) {
      const resposta = await credenciais.provider.distribuirPorNsu(nsu)
      ultimaResposta = resposta
      lotes++
      if (resposta.maxNSU) maxNsu = formatarNsu(resposta.maxNSU)

      const passo = avaliarResposta(resposta, nsu)

      if (passo.temDocumentos) {
        encontrados += resposta.documentos.length
        for (const documento of resposta.documentos) {
          try {
            await gravarDocumento(empresaId, credenciais.ambiente, documento, contadores)
          } catch (e) {
            contadores.erros++
            logger.error('fiscal: falha ao gravar documento', {
              empresaId,
              nsu: documento.nsu,
              schema: documento.schema,
              erro: (e as Error).message,
            })
          }
        }
      }

      // o NSU só avança depois dos documentos gravados: se a execução morrer aqui, o lote se repete
      nsu = passo.nsu
      situacao = passo.situacao
      esperaMs = passo.esperaMs
      if (passo.motivo === 'rejeicao') detalheErro = explicarRetorno(resposta.cStat, resposta.xMotivo)

      if (passo.temDocumentos) {
        await ref.update({
          'sincronizacao.ultimoNsu': nsu,
          'sincronizacao.maxNsu': maxNsu,
          'sincronizacao.ultimoNsuConsultado': nsu,
          'sincronizacao.documentosEncontrados': encontrados,
          'sincronizacao.documentosProcessados': contadores.processados,
          // renova a trava a cada lote para uma varredura longa não parecer órfã
          'sincronizacao.lockEm': FieldValue.serverTimestamp(),
          atualizadoEm: FieldValue.serverTimestamp(),
        })
      }

      if (passo.acao === 'parar') break
    }
  } catch (e) {
    situacao = 'erro'
    detalheErro = (e as Error).message
    contadores.erros++
    logger.error('fiscal: sincronização falhou', { empresaId, execucaoId, erro: detalheErro })
  } finally {
    credenciais?.provider.encerrar()
  }

  const duracaoMs = Date.now() - inicio
  const proxima = Timestamp.fromMillis(Date.now() + esperaMs)
  const codigoRetorno = ultimaResposta?.cStat
  const mensagemRetorno = detalheErro ?? (ultimaResposta ? explicarRetorno(ultimaResposta.cStat, ultimaResposta.xMotivo) : undefined)

  await soltarTrava(ref, execucaoId, {
    'sincronizacao.status': situacao,
    'sincronizacao.ultimoNsu': nsu,
    'sincronizacao.maxNsu': maxNsu,
    'sincronizacao.ultimoNsuConsultado': nsu,
    'sincronizacao.ultimaSincronizacao': FieldValue.serverTimestamp(),
    'sincronizacao.proximaPermitidaEm': proxima,
    'sincronizacao.documentosEncontrados': encontrados,
    'sincronizacao.documentosProcessados': contadores.processados,
    'sincronizacao.erros': contadores.erros,
    ...(codigoRetorno ? { 'sincronizacao.codigoRetorno': codigoRetorno } : {}),
    ...(mensagemRetorno ? { 'sincronizacao.mensagemRetorno': mensagemRetorno } : {}),
  }).catch((e) => logger.error('fiscal: falha ao liberar a trava', { empresaId, erro: (e as Error).message }))

  const historico: Sincronizacao = {
    empresaId,
    origem: opcoes.origem,
    iniciadoEm: Timestamp.fromMillis(inicio),
    concluidoEm: Timestamp.now(),
    duracaoMs,
    nsuInicial,
    nsuFinal: nsu,
    maxNsu,
    lotes,
    documentosEncontrados: encontrados,
    documentosProcessados: contadores.processados,
    notasNovas: contadores.notasNovas,
    notasAtualizadas: contadores.notasAtualizadas,
    eventos: contadores.eventos,
    erros: contadores.erros,
    status: situacao === 'erro' ? 'erro' : situacao === 'bloqueado' ? 'bloqueada' : 'concluida',
    ...(codigoRetorno ? { codigoRetorno } : {}),
    ...(mensagemRetorno ? { mensagemRetorno } : {}),
    ...(detalheErro ? { detalheErro } : {}),
  }
  await sincronizacoesRef(empresaId)
    .add(historico)
    .catch((e) => logger.error('fiscal: falha ao gravar histórico', { empresaId, erro: (e as Error).message }))

  // log estruturado exigido pela observabilidade: nada de senha, certificado ou token aqui
  logger.info('fiscal: sincronização concluída', {
    empresaId,
    operacao: 'sincronizar',
    origem: opcoes.origem,
    execucaoId,
    duracaoMs,
    lotes,
    nsuInicial,
    nsuFinal: nsu,
    maxNsu,
    documentosEncontrados: encontrados,
    documentosProcessados: contadores.processados,
    erros: contadores.erros,
    codigoRetorno,
  })

  return {
    empresaId,
    executou: true,
    nsuInicial,
    nsuFinal: nsu,
    maxNsu,
    lotes,
    documentosEncontrados: encontrados,
    documentosProcessados: contadores.processados,
    notasNovas: contadores.notasNovas,
    notasAtualizadas: contadores.notasAtualizadas,
    eventos: contadores.eventos,
    erros: contadores.erros,
    codigoRetorno,
    mensagemRetorno,
    duracaoMs,
  }
}
