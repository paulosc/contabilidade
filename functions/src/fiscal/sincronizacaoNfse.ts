/**
 * Sincronização das NFS-e da empresa com o ADN (Ambiente de Dados Nacional).
 *
 * Mesmo desenho da sincronização de NF-e — NSU por empresa, janela de 1 hora, trava de
 * concorrência, idempotência pela chave de acesso e retomada por lote — porque o manual do ADN
 * define exatamente as mesmas regras: lote de até 50 documentos, `ultNSU`/`maxNSU` e espera
 * mínima de uma hora quando não há mais o que buscar.
 *
 * A diferença de fundo é quem recebe o quê: na NF-e o emitente não recebe as próprias notas;
 * no ADN o prestador recebe as NFS-e que emitiu. Por isso cada nota guarda o `papel` da empresa
 * (prestador = receita, tomador = despesa).
 */
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { logger } from 'firebase-functions'
import { db, storage } from '../lib/admin'
import { FISCAL_MAX_LOTES } from '../lib/config'
import { AdnNacionalProvider, nsuAdn } from '../providers/fiscal/adnNacional'
import {
  mesmaRaiz,
  type AdnContribuintesProvider,
  type AmbienteFiscal,
  type RespostaDistribuicaoAdn,
} from '../providers/fiscal/AdnContribuintesProvider'
import { decifrar } from './certificado'
import { eventoCancelaNfse, lerDocumentoServico } from './documentoServico'
import {
  caminhoXmlServico,
  configFiscalRef,
  notasServicoRef,
  privadoFiscalRef,
  sincronizacoesRef,
  type ConfiguracaoFiscal,
  type EventoNotaServico,
  type NotaServico,
  type PrivadoFiscal,
  type SituacaoSync,
} from './modelo'
import { analisarXml } from './xml'

const LOCK_EXPIRA_MS = 10 * 60 * 1000
/** Mesma janela da NF-e: o manual do ADN também manda esperar 1 hora. */
export const ESPERA_NFSE_MS = 60 * 60 * 1000

export interface PassoNfse {
  acao: 'continuar' | 'parar'
  nsu: string
  situacao: SituacaoSync
  temDocumentos: boolean
  /** 'sem-nsu' = vieram documentos mas o NSU não avançou; repetir seria buscar o mesmo lote */
  motivo?: 'sem-nsu'
}

/**
 * Próximo passo a partir da resposta do ADN.
 *
 * Encerra a varredura quando o lote vem vazio ou quando o NSU alcança o maxNSU. E encerra
 * também — isto é proteção, não regra do manual — quando vieram documentos mas o NSU **não
 * avançou**: sem avanço, a consulta seguinte traria exatamente o mesmo lote, e o laço só
 * gastaria chamada até bater no limite de lotes.
 */
export function avaliarRespostaNfse(
  resposta: Pick<RespostaDistribuicaoAdn, 'ultNSU' | 'maxNSU' | 'documentos'>,
  nsuAtual: string,
): PassoNfse {
  const temDocumentos = (resposta.documentos?.length ?? 0) > 0
  const nsu = resposta.ultNSU ? nsuAdn(resposta.ultNSU) : nsuAtual
  if (!temDocumentos) return { acao: 'parar', nsu, situacao: 'aguardando', temDocumentos: false }
  if (Number(nsu) <= Number(nsuAdn(nsuAtual))) {
    return { acao: 'parar', nsu, situacao: 'aguardando', temDocumentos: true, motivo: 'sem-nsu' }
  }
  const acabou = resposta.maxNSU !== undefined && Number(nsu) >= Number(nsuAdn(resposta.maxNSU))
  return { acao: acabou ? 'parar' : 'continuar', nsu, situacao: 'aguardando', temDocumentos: true }
}

/** A empresa é prestadora (receita) ou tomadora (despesa) desta nota? */
export function papelNaNota(
  documentoEmpresa: string,
  nota: { cnpjPrestador?: string; cnpjTomador?: string },
): NotaServico['papel'] {
  const meu = (documentoEmpresa ?? '').replace(/\D/g, '')
  if (meu && nota.cnpjPrestador && nota.cnpjPrestador.replace(/\D/g, '') === meu) return 'prestador'
  if (meu && nota.cnpjTomador && nota.cnpjTomador.replace(/\D/g, '') === meu) return 'tomador'
  return 'outro'
}

// ---------- credenciais ----------

interface CredenciaisNfse {
  provider: AdnContribuintesProvider
  documento: string
  ambiente: AmbienteFiscal
}

export async function resolverCredenciaisNfse(empresaId: string, chaveMestra: string): Promise<CredenciaisNfse> {
  const [confSnap, privSnap] = await Promise.all([configFiscalRef(empresaId).get(), privadoFiscalRef(empresaId).get()])
  const config = confSnap.data() as ConfiguracaoFiscal | undefined
  const privado = privSnap.data() as PrivadoFiscal | undefined
  if (!config || !privado?.certificado) throw new Error('Integração fiscal sem certificado cadastrado.')

  const cert = privado.certificado
  if (cert.validoAte.toDate().getTime() < Date.now()) {
    throw new Error(`Certificado digital vencido em ${cert.validoAte.toDate().toLocaleDateString('pt-BR')}. Envie um certificado novo.`)
  }

  const documento = (config.cnpj || cert.documento).replace(/\D/g, '')
  if (!mesmaRaiz(documento, cert.documento)) {
    throw new Error('O CNPJ configurado não tem a mesma raiz do CNPJ do certificado digital.')
  }

  return {
    provider: new AdnNacionalProvider({
      documento,
      pfxBase64: decifrar(cert.arquivoCifrado, chaveMestra),
      senha: decifrar(cert.senhaCifrada, chaveMestra),
      ambiente: config.ambiente,
    }),
    documento,
    ambiente: config.ambiente,
  }
}

// ---------- trava ----------

async function tomarTrava(ref: DocumentReference, execucaoId: string): Promise<string | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const config = snap.data() as ConfiguracaoFiscal | undefined
    if (!config) return 'Integração fiscal não configurada.'
    if (!config.nfseAtivo) return 'Busca de NFS-e desativada.'

    const sync = config.sincronizacaoNfse
    const lockEm = sync?.lockEm?.toMillis?.()
    if (sync?.status === 'executando' && lockEm && Date.now() - lockEm < LOCK_EXPIRA_MS) {
      return 'Já existe uma busca de NFS-e em andamento para esta empresa.'
    }
    const proxima = sync?.proximaPermitidaEm?.toMillis?.()
    if (proxima && proxima > Date.now()) {
      return `O ADN só permite nova consulta a partir de ${new Date(proxima).toLocaleString('pt-BR')}.`
    }

    tx.set(
      ref,
      {
        sincronizacaoNfse: { status: 'executando', lockEm: FieldValue.serverTimestamp(), lockPor: execucaoId },
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return null
  })
}

async function soltarTrava(ref: DocumentReference, execucaoId: string, estado: Record<string, unknown>): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const config = snap.data() as ConfiguracaoFiscal | undefined
    if (config?.sincronizacaoNfse?.lockPor && config.sincronizacaoNfse.lockPor !== execucaoId) return
    tx.update(ref, {
      ...estado,
      'sincronizacaoNfse.lockEm': FieldValue.delete(),
      'sincronizacaoNfse.lockPor': FieldValue.delete(),
      atualizadoEm: FieldValue.serverTimestamp(),
    })
  })
}

// ---------- gravação ----------

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

export async function guardarXml(empresaId: string, chave: string, sufixo: string, xml: string): Promise<string> {
  const caminho = caminhoXmlServico(empresaId, chave, sufixo)
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

export interface Contadores {
  novas: number
  atualizadas: number
  eventos: number
  erros: number
  processados: number
}

export async function gravarDocumento(
  empresaId: string,
  documentoEmpresa: string,
  ambiente: AmbienteFiscal,
  doc: { nsu?: string; xml: string },
  contadores: Contadores,
): Promise<void> {
  const raiz = analisarXml(doc.xml)
  const lido = lerDocumentoServico(raiz)
  if (!lido.chaveAcesso) {
    logger.info('nfse: documento ignorado (sem chave de acesso)', { empresaId, nsu: doc.nsu })
    return
  }

  const ref = notasServicoRef(empresaId).doc(lido.chaveAcesso)
  const atual = (await ref.get()).data() as NotaServico | undefined
  const agora = FieldValue.serverTimestamp()

  if (lido.evento) {
    const e = lido.evento
    const eventos = [...(atual?.eventos ?? [])]
    const chaveEvento = `${e.tipoEvento}_${e.numeroSequencial}`
    const indice = eventos.findIndex((x) => `${x.tipoEvento}_${x.numeroSequencial}` === chaveEvento)
    const storagePath = await guardarXml(empresaId, e.chaveAcesso, `evento-${e.tipoEvento}-${e.numeroSequencial}`, doc.xml)
    const novo: EventoNotaServico = {
      tipoEvento: e.tipoEvento,
      descricao: e.descricao,
      numeroSequencial: e.numeroSequencial,
      dataEvento: e.dataEvento ? Timestamp.fromDate(e.dataEvento) : undefined,
      nsu: doc.nsu,
      storagePath,
    }
    if (indice >= 0) eventos[indice] = { ...eventos[indice], ...limpar(novo) }
    else {
      eventos.push(limpar(novo))
      contadores.eventos++
    }

    const patch: Record<string, unknown> = { eventos, atualizadoEm: agora }
    if (eventoCancelaNfse(e.tipoEvento)) patch.status = 'cancelada'
    if (!atual) {
      await ref.set(
        limpar({
          chaveAcesso: e.chaveAcesso,
          papel: 'outro' as const,
          status: eventoCancelaNfse(e.tipoEvento) ? ('cancelada' as const) : ('gerada' as const),
          ambiente,
          nsu: doc.nsu,
          eventos,
          importadoEm: agora,
          criadoEm: agora,
          atualizadoEm: agora,
        }),
      )
      contadores.novas++
    } else {
      await ref.set(limpar(patch), { merge: true })
      contadores.atualizadas++
    }
    contadores.processados++
    return
  }

  const n = lido.nota
  if (!n) return

  const hash = createHash('sha256').update(doc.xml, 'utf8').digest('hex')
  const storagePath =
    atual?.hashXml === hash && atual.storagePath ? atual.storagePath : await guardarXml(empresaId, n.chaveAcesso, 'nfse', doc.xml)

  const dados = limpar({
    chaveAcesso: n.chaveAcesso,
    numero: n.numero,
    serieDps: n.serieDps,
    numeroDps: n.numeroDps,
    dataEmissao: n.dataEmissao ? Timestamp.fromDate(n.dataEmissao) : undefined,
    dataProcessamento: n.dataProcessamento ? Timestamp.fromDate(n.dataProcessamento) : undefined,
    competencia: n.competencia,
    situacao: n.situacao,
    ambienteGerador: n.ambienteGerador,
    municipioEmissao: n.municipioEmissao,
    municipioPrestacao: n.municipioPrestacao,
    codigoMunicipio: n.codigoMunicipio,
    cnpjPrestador: n.cnpjPrestador,
    razaoSocialPrestador: n.razaoSocialPrestador,
    inscricaoMunicipalPrestador: n.inscricaoMunicipalPrestador,
    cnpjTomador: n.cnpjTomador,
    razaoSocialTomador: n.razaoSocialTomador,
    descricaoServico: n.descricaoServico,
    codigoTributacaoNacional: n.codigoTributacaoNacional,
    codigoTributacaoMunicipal: n.codigoTributacaoMunicipal,
    valorServico: n.valorServico,
    baseCalculo: n.baseCalculo,
    aliquota: n.aliquota,
    valorIss: n.valorIss,
    valorRetencoes: n.valorRetencoes,
    valorLiquido: n.valorLiquido,
    papel: papelNaNota(documentoEmpresa, n),
    // um evento de cancelamento que já chegou não é desfeito pela nota
    status: atual?.status === 'cancelada' ? ('cancelada' as const) : ('gerada' as const),
    nsu: doc.nsu,
    storagePath,
    hashXml: hash,
    ambiente,
    importadoEm: atual?.importadoEm ?? agora,
    criadoEm: atual?.criadoEm ?? agora,
    atualizadoEm: agora,
  })

  await ref.set(dados, { merge: true })
  if (atual) contadores.atualizadas++
  else contadores.novas++
  contadores.processados++
}

// ---------- execução ----------

export interface ResultadoSincronizacaoNfse {
  empresaId: string
  executou: boolean
  motivo?: string
  nsuInicial: string
  nsuFinal: string
  maxNsu: string
  lotes: number
  documentosProcessados: number
  notasNovas: number
  notasAtualizadas: number
  eventos: number
  erros: number
  mensagemRetorno?: string
  duracaoMs: number
}

/** Busca as NFS-e de uma empresa no ADN. Nunca lança por causa do ADN. */
export async function sincronizarNfseDaEmpresa(
  empresaId: string,
  chaveMestra: string,
  opcoes: { origem: 'agendada' | 'manual'; maxLotes?: number },
): Promise<ResultadoSincronizacaoNfse> {
  const inicio = Date.now()
  const execucaoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const ref = configFiscalRef(empresaId)
  const vazio: ResultadoSincronizacaoNfse = {
    empresaId,
    executou: false,
    nsuInicial: '0',
    nsuFinal: '0',
    maxNsu: '0',
    lotes: 0,
    documentosProcessados: 0,
    notasNovas: 0,
    notasAtualizadas: 0,
    eventos: 0,
    erros: 0,
    duracaoMs: 0,
  }

  const impedimento = await tomarTrava(ref, execucaoId)
  if (impedimento) return { ...vazio, motivo: impedimento, duracaoMs: Date.now() - inicio }

  let credenciais: CredenciaisNfse | undefined
  const contadores: Contadores = { novas: 0, atualizadas: 0, eventos: 0, erros: 0, processados: 0 }
  let nsuInicial = '0'
  let nsu = '0'
  let maxNsu = '0'
  let lotes = 0
  let situacao: SituacaoSync = 'aguardando'
  let detalheErro: string | undefined
  let formatoRecebido: string[] | undefined

  try {
    credenciais = await resolverCredenciaisNfse(empresaId, chaveMestra)
    const config = (await ref.get()).data() as ConfiguracaoFiscal | undefined
    nsuInicial = nsuAdn(config?.sincronizacaoNfse?.ultimoNsu ?? '0')
    nsu = nsuInicial
    maxNsu = nsuAdn(config?.sincronizacaoNfse?.maxNsu ?? '0')

    const limite = Math.max(1, opcoes.maxLotes ?? FISCAL_MAX_LOTES.value())
    logger.info('nfse: sincronização iniciada', {
      empresaId,
      operacao: 'sincronizarNfse',
      origem: opcoes.origem,
      ambiente: credenciais.ambiente,
      nsuInicial,
      execucaoId,
      bucket: storage.bucket().name,
    })

    while (lotes < limite) {
      const resposta = await credenciais.provider.distribuirPorNsu(nsu)
      lotes++
      // o ADN não devolve maxNSU; mostramos o maior NSU já visto, que é o que temos
      maxNsu = resposta.maxNSU ? nsuAdn(resposta.maxNSU) : maxNsu
      if (resposta.formatoRecebido) formatoRecebido = resposta.formatoRecebido

      const passo = avaliarRespostaNfse(resposta, nsu)
      if (passo.motivo === 'sem-nsu') {
        logger.warn('nfse: lote sem NSU utilizável, varredura encerrada para não repetir', {
          empresaId,
          nsu,
          documentos: resposta.documentos.length,
          formatoRecebido: resposta.formatoRecebido,
        })
      }
      if (passo.temDocumentos) {
        for (const documento of resposta.documentos) {
          try {
            await gravarDocumento(empresaId, credenciais.documento, credenciais.ambiente, documento, contadores)
          } catch (e) {
            contadores.erros++
            logger.error('nfse: falha ao gravar documento', { empresaId, nsu: documento.nsu, erro: (e as Error).message })
          }
        }
        // o NSU só avança depois de gravar: execução interrompida repete o lote
        nsu = passo.nsu
        if (Number(nsu) > Number(maxNsu)) maxNsu = nsu
        await ref.set(
          limpar({
            sincronizacaoNfse: {
              ultimoNsu: nsu,
              maxNsu,
              documentosEncontrados: contadores.processados,
              documentosProcessados: contadores.processados,
              lockEm: FieldValue.serverTimestamp(),
            },
            atualizadoEm: FieldValue.serverTimestamp(),
          }),
          { merge: true },
        )
      } else {
        nsu = passo.nsu
      }
      situacao = passo.situacao
      if (passo.acao === 'parar') break
    }
  } catch (e) {
    situacao = 'erro'
    detalheErro = (e as Error).message
    contadores.erros++
    logger.error('nfse: sincronização falhou', { empresaId, execucaoId, erro: detalheErro })
  } finally {
    credenciais?.provider.encerrar()
  }

  const duracaoMs = Date.now() - inicio
  await soltarTrava(ref, execucaoId, {
    'sincronizacaoNfse.status': situacao,
    'sincronizacaoNfse.ultimoNsu': nsu,
    'sincronizacaoNfse.maxNsu': maxNsu,
    'sincronizacaoNfse.ultimaSincronizacao': FieldValue.serverTimestamp(),
    'sincronizacaoNfse.proximaPermitidaEm': Timestamp.fromMillis(Date.now() + ESPERA_NFSE_MS),
    'sincronizacaoNfse.documentosProcessados': contadores.processados,
    'sincronizacaoNfse.erros': contadores.erros,
    ...(detalheErro ? { 'sincronizacaoNfse.mensagemRetorno': detalheErro } : {}),
    ...(formatoRecebido ? { 'sincronizacaoNfse.formatoRecebido': formatoRecebido } : {}),
  }).catch((e) => logger.error('nfse: falha ao liberar a trava', { empresaId, erro: (e as Error).message }))

  await sincronizacoesRef(empresaId)
    .add(
      limpar({
        empresaId,
        servico: 'nfse',
        origem: opcoes.origem,
        iniciadoEm: Timestamp.fromMillis(inicio),
        concluidoEm: Timestamp.now(),
        duracaoMs,
        nsuInicial,
        nsuFinal: nsu,
        maxNsu,
        lotes,
        documentosEncontrados: contadores.processados,
        documentosProcessados: contadores.processados,
        notasNovas: contadores.novas,
        notasAtualizadas: contadores.atualizadas,
        eventos: contadores.eventos,
        erros: contadores.erros,
        status: situacao === 'erro' ? 'erro' : 'concluida',
        detalheErro,
      }),
    )
    .catch((e) => logger.error('nfse: falha ao gravar histórico', { empresaId, erro: (e as Error).message }))

  logger.info('nfse: sincronização concluída', {
    empresaId,
    operacao: 'sincronizarNfse',
    origem: opcoes.origem,
    execucaoId,
    duracaoMs,
    lotes,
    nsuInicial,
    nsuFinal: nsu,
    maxNsu,
    documentosProcessados: contadores.processados,
    erros: contadores.erros,
    formatoRecebido,
  })

  return {
    empresaId,
    executou: true,
    nsuInicial,
    nsuFinal: nsu,
    maxNsu,
    lotes,
    documentosProcessados: contadores.processados,
    notasNovas: contadores.novas,
    notasAtualizadas: contadores.atualizadas,
    eventos: contadores.eventos,
    erros: contadores.erros,
    mensagemRetorno: detalheErro,
    duracaoMs,
  }
}
