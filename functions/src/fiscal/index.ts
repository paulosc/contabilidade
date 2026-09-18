/**
 * Integração fiscal (NF-e) — callables da tela e worker agendado.
 *
 * Nenhuma dessas funções confia no `empresaId` que vier do cliente: o tenant é sempre
 * derivado do uid autenticado (/usuarios/{uid}.empresaId + /empresas/{id}/membros/{uid}),
 * do mesmo jeito que o módulo de integrações já faz. É isso que garante que a empresa A
 * não alcance documento nenhum da empresa B.
 */
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { gerarDanfse } from './danfse'
import {
  ErroFolha,
  ErroTabela,
  calcularFolha,
  calcularHoleriteDoFuncionario,
  fecharFolha,
  garantirRubricas,
  pdfDoHolerite,
  reabrirFolha,
  removerHolerite,
} from '../folha/folhaServico'
import {
  ErroSerpro,
  declaracaoDoPeriodo,
  gerarDarf as gerarDarfNaReceita,
  gerarDas as gerarDasNaReceita,
  removerCredenciais as removerCredenciaisDoSerpro,
  salvarCredenciais as salvarCredenciaisDoSerpro,
  testar as testarSerproDaEmpresa,
} from './serproServico'
import { conferirPagamentos, consultarCaixaPostal, emitirSituacaoFiscal, pdfSituacaoFiscal } from './serproMonitor'
import { abrirLinkDaGuia, criarLinkDaGuia } from './guiasServico'
import { ErroGuia, excluirGuia as excluirGuiaDaEmpresa, gerarRecibo, importarGuia as importarGuiaDaEmpresa, marcarPagamento, pdfDaGuia } from './guiasServico'
import { ErroDps, type AmbienteNfse, type DadosDps, type MotivoCancelamento } from './dps'
import { ErroEmissao, cancelarNfse as cancelarNfseNoSefin, emitirNfse as emitirNfseNoSefin, modeloDeNota, numeracaoAtual } from './emissao'
import { logger } from 'firebase-functions'
import { db, storage } from '../lib/admin'
import { FISCAL_CRYPTO_KEY, FISCAL_MAX_EMPRESAS, REGIAO, SEFAZ_AMBIENTE } from '../lib/config'
import { ErroCertificado, certificadoVigente, cifrar, lerCertificadoPfx } from './certificado'
import {
  auditoriaRef,
  configFiscalRef,
  notasRef,
  notasServicoRef,
  privadoFiscalRef,
  resolverCaminhoXml,
  resolverCaminhoXmlServico,
  type ConfiguracaoFiscal,
  type NotaFiscal,
  type NotaServico,
  type OperacaoAuditada,
  type PrivadoFiscal,
} from './modelo'
import { ESPERA_SEM_DOCUMENTOS_MS, mesmaRaizCnpj, resolverCredenciais, sincronizarEmpresa } from './sincronizacao'
import { ESPERA_NFSE_MS, resolverCredenciaisNfse, sincronizarNfseDaEmpresa } from './sincronizacaoNfse'
import { importarDoMunicipio } from './importacaoMunicipal'
import { avaliarTesteDeConexao, explicarTesteDeConexao, type AmbienteFiscal } from '../providers/fiscal/DistribuicaoDFeProvider'
import { UF_IBGE } from '../providers/fiscal/sefazNacional'

export const SEGREDOS_FISCAIS = [FISCAL_CRYPTO_KEY]

/** Tamanho máximo do .pfx aceito (certificado A1 tem alguns KB; o limite evita abuso). */
const MAX_PFX_BASE64 = 400_000
/** XML de NF-e tem ~10 KB; o teto protege a memória da function ao devolver o arquivo. */
const MAX_XML_BYTES = 5 * 1024 * 1024

// ---------- autorização ----------

/**
 * Um usuário pode administrar várias empresas (é um sistema de escritório de contabilidade),
 * então a empresa vem no pedido — mas o vínculo é SEMPRE conferido aqui, em
 * /empresas/{id}/membros/{uid}. O `empresaId` do cliente não autoriza nada por si só: ele só
 * diz de qual empresa se trata, e o backend decide se aquele uid pode.
 *
 * Sem `empresaId` no pedido, vale a última empresa aberta (usuarios/{uid}.empresaId), que é o
 * caso de quem administra uma só.
 */
async function vinculoDoUsuario(
  uid: string | undefined,
  empresaId: unknown,
): Promise<{ id: string; papel: string; email?: string }> {
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login')

  let id = typeof empresaId === 'string' && empresaId.trim() ? empresaId.trim() : undefined
  if (!id) {
    const usuario = await db.collection('usuarios').doc(uid).get()
    id = usuario.data()?.empresaId as string | undefined
  }
  if (!id) throw new HttpsError('failed-precondition', 'Informe a empresa')

  const membro = await db.collection('empresas').doc(id).collection('membros').doc(uid).get()
  if (!membro.exists) throw new HttpsError('permission-denied', 'Sem acesso a esta empresa')
  return { id, papel: (membro.data()?.papel as string) ?? '', email: membro.data()?.email as string | undefined }
}

const empresaDoPedido = (dados: unknown): unknown => (dados as { empresaId?: unknown } | undefined)?.empresaId

export async function exigirMembro(uid: string | undefined, dados?: unknown): Promise<{ id: string; email?: string }> {
  const { id, email } = await vinculoDoUsuario(uid, empresaDoPedido(dados))
  return { id, email }
}

export async function exigirAdmin(uid: string | undefined, dados?: unknown): Promise<{ id: string; email?: string }> {
  const { id, papel, email } = await vinculoDoUsuario(uid, empresaDoPedido(dados))
  if (papel !== 'admin') throw new HttpsError('permission-denied', 'Apenas administradores')
  return { id, email }
}

export async function auditar(
  empresaId: string,
  operacao: OperacaoAuditada,
  uid: string,
  extras: { email?: string; detalhe?: string; chaveAcesso?: string } = {},
): Promise<void> {
  await auditoriaRef(empresaId)
    .add({
      operacao,
      uid,
      ...(extras.email ? { email: extras.email } : {}),
      ...(extras.detalhe ? { detalhe: extras.detalhe } : {}),
      ...(extras.chaveAcesso ? { chaveAcesso: extras.chaveAcesso } : {}),
      criadoEm: FieldValue.serverTimestamp(),
    })
    .catch((e) => logger.error('fiscal: falha ao auditar', { empresaId, operacao, erro: (e as Error).message }))
}

const ambientePadrao = (): AmbienteFiscal => (SEFAZ_AMBIENTE.value() === 'producao' ? 'producao' : 'homologacao')

const soCnpj = (v: string) => (v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()

async function lerConfig(empresaId: string): Promise<ConfiguracaoFiscal | undefined> {
  return (await configFiscalRef(empresaId).get()).data() as ConfiguracaoFiscal | undefined
}

// ---------- certificado ----------

/**
 * Cadastra ou troca o certificado A1 da empresa.
 * O arquivo e a senha chegam por HTTPS, são validados, cifrados com a chave do Secret Manager
 * e gravados em /empresas/{id}/privado/fiscal — que as Rules negam para qualquer cliente.
 * A senha não volta para a tela, não é gravada em claro e não entra em log.
 */
export const salvarCertificadoFiscal = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 60, memory: '512MiB' },
  async (req) => {
    const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
    const { pfxBase64, senha, cnpj, uf, ambiente } = (req.data ?? {}) as {
      pfxBase64?: string
      senha?: string
      cnpj?: string
      uf?: string
      ambiente?: string
    }
    if (!pfxBase64 || !senha) throw new HttpsError('invalid-argument', 'Envie o arquivo do certificado e a senha')
    if (pfxBase64.length > MAX_PFX_BASE64) throw new HttpsError('invalid-argument', 'Certificado muito grande')
    if (uf && !UF_IBGE[uf.toUpperCase()]) throw new HttpsError('invalid-argument', 'UF inválida')

    let dados
    try {
      dados = lerCertificadoPfx(pfxBase64, senha)
    } catch (e) {
      if (e instanceof ErroCertificado) throw new HttpsError('invalid-argument', e.message)
      throw new HttpsError('invalid-argument', 'Não foi possível ler o certificado.')
    }
    if (!certificadoVigente(dados)) {
      throw new HttpsError(
        'failed-precondition',
        `Certificado fora do prazo de validade (${dados.validoDe.toLocaleDateString('pt-BR')} a ${dados.validoAte.toLocaleDateString('pt-BR')}).`,
      )
    }

    const cnpjConsulta = soCnpj(cnpj || dados.documento)
    if (dados.tipo === 'e-CNPJ' && !mesmaRaizCnpj(cnpjConsulta, dados.documento)) {
      throw new HttpsError(
        'invalid-argument',
        'O CNPJ informado não tem a mesma raiz do CNPJ do certificado. A SEFAZ rejeita a consulta (código 593).',
      )
    }

    const chave = FISCAL_CRYPTO_KEY.value()
    const certificado = {
      arquivoCifrado: cifrar(pfxBase64, chave),
      senhaCifrada: cifrar(senha, chave),
      documento: dados.documento,
      tipo: dados.tipo,
      titular: dados.titular,
      emissor: dados.emissor,
      validoDe: Timestamp.fromDate(dados.validoDe),
      validoAte: Timestamp.fromDate(dados.validoAte),
      impressaoDigital: dados.impressaoDigital,
      enviadoEm: Timestamp.now(),
      enviadoPor: req.auth!.uid,
    }
    await privadoFiscalRef(id).set({ certificado }, { merge: true })

    const atual = await lerConfig(id)
    const resumo = {
      documento: certificado.documento,
      tipo: certificado.tipo,
      titular: certificado.titular,
      emissor: certificado.emissor,
      validoDe: certificado.validoDe,
      validoAte: certificado.validoAte,
      impressaoDigital: certificado.impressaoDigital,
      enviadoEm: certificado.enviadoEm,
    }
    await configFiscalRef(id).set(
      {
        tipo: 'fiscal',
        ativo: atual?.ativo ?? false,
        ambiente: (ambiente === 'producao' || ambiente === 'homologacao' ? ambiente : atual?.ambiente) ?? ambientePadrao(),
        cnpj: cnpjConsulta,
        ...(uf ? { uf: uf.toUpperCase() } : {}),
        certificado: resumo,
        sincronizacao: atual?.sincronizacao ?? {
          ultimoNsu: '000000000000000',
          maxNsu: '000000000000000',
          status: 'ocioso',
          documentosEncontrados: 0,
          documentosProcessados: 0,
          erros: 0,
        },
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    await auditar(id, 'certificado_cadastrado', req.auth!.uid, {
      email,
      detalhe: `${certificado.tipo} ${certificado.titular} · válido até ${dados.validoAte.toLocaleDateString('pt-BR')}`,
    })
    logger.info('fiscal: certificado cadastrado', {
      empresaId: id,
      operacao: 'certificado_cadastrado',
      tipo: certificado.tipo,
      validoAte: dados.validoAte.toISOString(),
    })

    return { ok: true, certificado: { ...resumo, validoDe: dados.validoDe.toISOString(), validoAte: dados.validoAte.toISOString() } }
  },
)

/** Remove o certificado e desliga a integração. Os documentos já baixados continuam no sistema. */
export const removerCertificadoFiscal = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  await privadoFiscalRef(id).set({ certificado: FieldValue.delete() }, { merge: true })
  // set+merge exige mapa aninhado; caminho com ponto só vale em update()
  await configFiscalRef(id).set(
    {
      ativo: false,
      certificado: FieldValue.delete(),
      sincronizacao: { status: 'ocioso' },
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  await auditar(id, 'certificado_removido', req.auth!.uid, { email })
  return { ok: true }
})

/** Liga/desliga a busca automática. */
export const ativarIntegracaoFiscal = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { ativo } = (req.data ?? {}) as { ativo?: boolean }
  const config = await lerConfig(id)
  if (ativo && !config?.certificado) {
    throw new HttpsError('failed-precondition', 'Cadastre o certificado digital antes de ativar a integração.')
  }
  await configFiscalRef(id).set(
    {
      tipo: 'fiscal',
      ativo: Boolean(ativo),
      sincronizacao: {
        // entra na fila do worker imediatamente; ao desativar, o campo deixa de ser lido
        proximaPermitidaEm: config?.sincronizacao?.proximaPermitidaEm ?? Timestamp.now(),
        status: ativo ? (config?.sincronizacao?.status ?? 'ocioso') : 'ocioso',
      },
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  await auditar(id, ativo ? 'integracao_ativada' : 'integracao_desativada', req.auth!.uid, { email })
  return { ok: true }
})

// ---------- conexão e sincronização ----------

/**
 * Testa a conexão com a SEFAZ usando o certificado da empresa.
 *
 * Usa a consulta pontual `consNSU` (e não `distNSU`) de propósito: `distNSU` fora de sequência
 * é exatamente o que a NT 2014.002 classifica como consumo indevido e bloqueia o CNPJ por 1 h.
 * A consulta pontual tem limite de 20 por hora, o que é de sobra para um teste manual.
 */
export const testarConexaoFiscal = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
    let credenciais
    try {
      credenciais = await resolverCredenciais(id, FISCAL_CRYPTO_KEY.value())
    } catch (e) {
      return { ok: false, situacao: 'erro' as const, mensagem: (e as Error).message }
    }
    try {
      const r = await credenciais.provider.consultarNsu('1')
      await auditar(id, 'conexao_testada', req.auth!.uid, { email, detalhe: `cStat ${r.cStat}` })
      const situacao = avaliarTesteDeConexao(r.cStat)
      return {
        ok: situacao !== 'erro',
        situacao,
        cStat: r.cStat,
        mensagem: explicarTesteDeConexao(r.cStat, r.xMotivo, credenciais.ambiente, r.maxNSU),
        maxNsu: r.maxNSU,
      }
    } catch (e) {
      return { ok: false, situacao: 'erro' as const, mensagem: (e as Error).message }
    } finally {
      credenciais.provider.encerrar()
    }
  },
)

/** Sincroniza agora, só desta empresa. Respeita a janela de 1 h exigida pela SEFAZ. */
export const sincronizarFiscalAgora = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    const { id, email } = await exigirMembro(req.auth?.uid, req.data)
    const resultado = await sincronizarEmpresa(id, FISCAL_CRYPTO_KEY.value(), { origem: 'manual' })
    await auditar(id, 'sincronizacao_manual', req.auth!.uid, {
      email,
      detalhe: resultado.executou
        ? `${resultado.documentosProcessados} documento(s), NSU ${resultado.nsuInicial} → ${resultado.nsuFinal}`
        : (resultado.motivo ?? 'não executada'),
    })
    return resultado
  },
)

/** Resumo para a tela (o mesmo documento que o onSnapshot acompanha). */
export const statusFiscal = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirMembro(req.auth?.uid, req.data)
  const config = await lerConfig(id)
  return config ?? { tipo: 'fiscal', ativo: false, ambiente: ambientePadrao() }
})

/**
 * Devolve o XML de uma nota da própria empresa.
 * Passa pelo backend (em vez de link direto no Storage) para registrar quem baixou o quê.
 */
export const xmlNotaFiscal = onCall({ region: REGIAO, timeoutSeconds: 60 }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const { chaveAcesso, storagePath } = (req.data ?? {}) as { chaveAcesso?: string; storagePath?: string }
  if (!chaveAcesso) throw new HttpsError('invalid-argument', 'Informe a chave de acesso')

  const snap = await notasRef(id).doc(chaveAcesso).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Nota não encontrada nesta empresa')
  const nota = snap.data() as NotaFiscal

  // o caminho vem sempre do documento do tenant; nada de caminho arbitrário do cliente
  const caminho = resolverCaminhoXml(id, nota, storagePath)
  if (!caminho) throw new HttpsError('not-found', 'Esta nota não tem esse XML guardado')

  const arquivo = storage.bucket().file(caminho)
  const [existe] = await arquivo.exists()
  if (!existe) throw new HttpsError('not-found', 'Arquivo não encontrado no armazenamento')
  const [meta] = await arquivo.getMetadata()
  if (Number(meta.size ?? 0) > MAX_XML_BYTES) throw new HttpsError('failed-precondition', 'Arquivo grande demais para download direto')

  const [conteudo] = await arquivo.download()
  await auditar(id, 'xml_baixado', req.auth!.uid, { email, chaveAcesso })
  return { chaveAcesso, nomeArquivo: `${chaveAcesso}.xml`, xml: conteudo.toString('utf8') }
})

// ---------- worker agendado ----------

/**
 * Roda de hora em hora (o mesmo passo da janela mínima que a SEFAZ exige) e sincroniza as
 * empresas cuja janela já venceu, no máximo FISCAL_MAX_EMPRESAS por execução — nada de
 * varrer a base inteira numa chamada só. Quem sobrar entra na execução seguinte, porque a
 * fila é ordenada pela janela mais antiga.
 */
export const sincronizarFiscalPeriodico = onSchedule(
  {
    region: REGIAO,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    secrets: SEGREDOS_FISCAIS,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const agora = Timestamp.now()
    const limite = Math.max(1, FISCAL_MAX_EMPRESAS.value())
    const fila = await db
      .collectionGroup('configuracoes')
      .where('tipo', '==', 'fiscal')
      .where('ativo', '==', true)
      .where('sincronizacao.proximaPermitidaEm', '<=', agora)
      .orderBy('sincronizacao.proximaPermitidaEm', 'asc')
      .limit(limite)
      .get()

    logger.info('fiscal: worker iniciado', { operacao: 'worker', empresas: fila.size, limite })

    let total = 0
    for (const doc of fila.docs) {
      const empresaId = doc.ref.parent.parent?.id
      if (!empresaId) continue
      try {
        const r = await sincronizarEmpresa(empresaId, FISCAL_CRYPTO_KEY.value(), { origem: 'agendada' })
        total += r.documentosProcessados
      } catch (e) {
        // uma empresa com problema não pode derrubar a execução das outras
        logger.error('fiscal: worker falhou para a empresa', { empresaId, erro: (e as Error).message })
        await configFiscalRef(empresaId)
          .set(
            {
              sincronizacao: {
                status: 'erro',
                mensagemRetorno: (e as Error).message,
                proximaPermitidaEm: Timestamp.fromMillis(Date.now() + ESPERA_SEM_DOCUMENTOS_MS),
              },
              atualizadoEm: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => undefined)
      }
    }

    logger.info('fiscal: worker concluído', { operacao: 'worker', empresas: fila.size, documentosProcessados: total })
  },
)

/** Usado pelos testes e pelo painel do sistema. */
export const estadoInicialSincronizacao = () => ({
  ultimoNsu: '000000000000000',
  maxNsu: '000000000000000',
  status: 'ocioso' as const,
  documentosEncontrados: 0,
  documentosProcessados: 0,
  erros: 0,
})

export type { ConfiguracaoFiscal, PrivadoFiscal }

// ---------- NFS-e (ADN nacional) ----------

/**
 * Liga/desliga a busca de NFS-e. É separada da NF-e de propósito: são serviços diferentes
 * (NF-e de mercadoria na SEFAZ, NFS-e de serviço no ADN) e nem toda empresa usa os dois.
 */
export const ativarNfse = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { ativo } = (req.data ?? {}) as { ativo?: boolean }
  const config = await lerConfig(id)
  if (ativo && !config?.certificado) {
    throw new HttpsError('failed-precondition', 'Cadastre o certificado digital antes de ativar a busca de NFS-e.')
  }
  await configFiscalRef(id).set(
    {
      tipo: 'fiscal',
      nfseAtivo: Boolean(ativo),
      sincronizacaoNfse: {
        ultimoNsu: config?.sincronizacaoNfse?.ultimoNsu ?? '0',
        maxNsu: config?.sincronizacaoNfse?.maxNsu ?? '0',
        proximaPermitidaEm: config?.sincronizacaoNfse?.proximaPermitidaEm ?? Timestamp.now(),
        status: ativo ? (config?.sincronizacaoNfse?.status ?? 'ocioso') : 'ocioso',
        documentosEncontrados: config?.sincronizacaoNfse?.documentosEncontrados ?? 0,
        documentosProcessados: config?.sincronizacaoNfse?.documentosProcessados ?? 0,
        erros: config?.sincronizacaoNfse?.erros ?? 0,
      },
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  await auditar(id, ativo ? 'integracao_ativada' : 'integracao_desativada', req.auth!.uid, { email, detalhe: 'NFS-e' })
  return { ok: true }
})

/** Busca as NFS-e agora, só desta empresa. Respeita a janela de 1 h exigida pelo ADN. */
export const sincronizarNfseAgora = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    const { id, email } = await exigirMembro(req.auth?.uid, req.data)
    const resultado = await sincronizarNfseDaEmpresa(id, FISCAL_CRYPTO_KEY.value(), { origem: 'manual' })
    await auditar(id, 'sincronizacao_manual', req.auth!.uid, {
      email,
      detalhe: resultado.executou
        ? `NFS-e · ${resultado.documentosProcessados} documento(s), NSU ${resultado.nsuInicial} → ${resultado.nsuFinal}`
        : (resultado.motivo ?? 'não executada'),
    })
    return resultado
  },
)

/** Devolve o XML de uma NFS-e da própria empresa, registrando quem baixou. */
export const xmlNotaServico = onCall({ region: REGIAO, timeoutSeconds: 60 }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const { chaveAcesso, storagePath } = (req.data ?? {}) as { chaveAcesso?: string; storagePath?: string }
  if (!chaveAcesso) throw new HttpsError('invalid-argument', 'Informe a chave de acesso')

  const snap = await notasServicoRef(id).doc(chaveAcesso).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Nota de serviço não encontrada nesta empresa')
  const nota = snap.data() as NotaServico

  const caminho = resolverCaminhoXmlServico(id, nota, storagePath)
  if (!caminho) throw new HttpsError('not-found', 'Esta nota não tem esse XML guardado')

  const arquivo = storage.bucket().file(caminho)
  const [existe] = await arquivo.exists()
  if (!existe) throw new HttpsError('not-found', 'Arquivo não encontrado no armazenamento')
  const [meta] = await arquivo.getMetadata()
  if (Number(meta.size ?? 0) > MAX_XML_BYTES) throw new HttpsError('failed-precondition', 'Arquivo grande demais para download direto')

  const [conteudo] = await arquivo.download()
  await auditar(id, 'xml_baixado', req.auth!.uid, { email, chaveAcesso })
  return { chaveAcesso, nomeArquivo: `${chaveAcesso}.xml`, xml: conteudo.toString('utf8') }
})

/**
 * Worker das NFS-e. Separado do da NF-e porque o NSU e a janela de 1 hora são de cada serviço:
 * uma empresa pode estar em dia num e bloqueada no outro.
 */
export const sincronizarNfsePeriodico = onSchedule(
  {
    region: REGIAO,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    secrets: SEGREDOS_FISCAIS,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const agora = Timestamp.now()
    const limite = Math.max(1, FISCAL_MAX_EMPRESAS.value())
    const fila = await db
      .collectionGroup('configuracoes')
      .where('tipo', '==', 'fiscal')
      .where('nfseAtivo', '==', true)
      .where('sincronizacaoNfse.proximaPermitidaEm', '<=', agora)
      .orderBy('sincronizacaoNfse.proximaPermitidaEm', 'asc')
      .limit(limite)
      .get()

    logger.info('nfse: worker iniciado', { operacao: 'workerNfse', empresas: fila.size, limite })

    let total = 0
    for (const doc of fila.docs) {
      const empresaId = doc.ref.parent.parent?.id
      if (!empresaId) continue
      try {
        const r = await sincronizarNfseDaEmpresa(empresaId, FISCAL_CRYPTO_KEY.value(), { origem: 'agendada' })
        total += r.documentosProcessados
      } catch (e) {
        logger.error('nfse: worker falhou para a empresa', { empresaId, erro: (e as Error).message })
        await configFiscalRef(empresaId)
          .set(
            {
              sincronizacaoNfse: {
                status: 'erro',
                mensagemRetorno: (e as Error).message,
                proximaPermitidaEm: Timestamp.fromMillis(Date.now() + ESPERA_NFSE_MS),
              },
              atualizadoEm: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => undefined)
      }
    }

    logger.info('nfse: worker concluído', { operacao: 'workerNfse', empresas: fila.size, documentosProcessados: total })
  },
)

/**
 * PDF (DANFSe) de uma NFS-e da própria empresa.
 * O ADN gera o documento auxiliar a partir do XML que ele já tem, então não guardamos o PDF:
 * ele é buscado na hora, com o certificado da empresa.
 */
export const pdfNotaServico = onCall({ region: REGIAO, timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const { chaveAcesso } = (req.data ?? {}) as { chaveAcesso?: string }
  if (!chaveAcesso) throw new HttpsError('invalid-argument', 'Informe a chave de acesso')

  // a nota precisa ser desta empresa: nada de gerar PDF de chave arbitrária
  const snap = await notasServicoRef(id).doc(chaveAcesso).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Nota de serviço não encontrada nesta empresa')
  const nota = snap.data() as { storagePath?: string; origem?: string; status?: string; situacao?: string }
  if (nota.origem === 'municipal') {
    throw new HttpsError('failed-precondition', 'Nota do sistema municipal: não tem DANFSe do padrão nacional. Baixe o XML.')
  }
  if (!nota.storagePath) throw new HttpsError('failed-precondition', 'O XML desta nota ainda não foi guardado.')

  // A API nacional do DANFSe foi suspensa em 03/08/2026 (NT 008/2026): o PDF é gerado aqui,
  // a partir do XML da própria nota, no leiaute que a NT fixa.
  try {
    const [xml] = await storage.bucket().file(nota.storagePath).download()
    const marcaDagua = nota.status === 'cancelada' ? 'CANCELADA' : /substitu/i.test(nota.situacao ?? '') ? 'SUBSTITUÍDA' : undefined
    const pdf = await gerarDanfse(xml.toString('utf8'), { marcaDagua })
    await auditar(id, 'xml_baixado', req.auth!.uid, { email, chaveAcesso, detalhe: 'PDF (DANFSe)' })
    return { chaveAcesso, nomeArquivo: `${chaveAcesso}.pdf`, pdfBase64: pdf.toString('base64') }
  } catch (e) {
    const erro = (e as Error).message
    logger.error('nfse: falha ao gerar o DANFSe', { empresaId: id, chaveAcesso, erro })
    throw new HttpsError('internal', `Não foi possível gerar o DANFSe: ${erro}`)
  }
})

/**
 * Lê o Swagger oficial das APIs nacionais usando o certificado da empresa.
 *
 * O Swagger do SEFIN e do ADN exige mTLS, então não abre no navegador — e sem ele o caminho do
 * DANFSe e o da emissão ficariam no chute. Os endereços são fixos aqui: o cliente não escolhe
 * URL, para o certificado não virar um proxy de saída.
 */
export const diagnosticoNfseNacional = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' },
  async (req) => {
    const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
    const credenciais = await resolverCredenciaisNfse(id, FISCAL_CRYPTO_KEY.value())
    // O SEFIN respondeu que o /DANFSe "foi movido" (501) e apontou para o módulo danfse do ADN.
    // Lá tudo dá 503, até a página de docs — então falta saber se o módulo responde em algum
    // lugar. Sondamos os dois ambientes e as duas convenções de Swagger dessa plataforma.
    const fila = [
      'https://adn.producaorestrita.nfse.gov.br/danfse/swagger/v1/swagger.json',
      'https://adn.producaorestrita.nfse.gov.br/danfse/docs/index.html',
      'https://adn.nfse.gov.br/danfse/swagger/docs/v1',
      'https://adn.nfse.gov.br/danfse/',
    ]
    const vistos = new Set<string>()
    const resumo: string[] = []

    /** Extrai método+caminho de um Swagger/OpenAPI, para o log ficar legível. */
    const rotasDoSwagger = (corpo: string): string[] => {
      try {
        const spec = JSON.parse(corpo) as { paths?: Record<string, Record<string, unknown>> }
        return Object.entries(spec.paths ?? {}).flatMap(([caminho, ops]) =>
          Object.keys(ops).map((m) => `${m.toUpperCase()} ${caminho}`),
        )
      } catch {
        return []
      }
    }

    try {
      while (fila.length) {
        const alvo = fila.shift()!
        if (vistos.has(alvo)) continue
        vistos.add(alvo)
        let r
        try {
          r = await credenciais.provider.sondar(alvo)
        } catch (e) {
          resumo.push(`${alvo} → ERRO ${(e as Error).message}`)
          continue
        }
        const rotas = rotasDoSwagger(r.corpo)
        resumo.push(`${alvo} → ${r.status}${rotas.length ? ` (${rotas.length} rotas)` : ''}`)
        // um registro por endereço: o corpo do swagger é grande demais para caber num só
        logger.info('nfse: diagnóstico — resposta', { empresaId: id, url: alvo, status: r.status, rotas, tamanho: r.corpo.length })
        for (let i = 0; i < r.corpo.length; i += 60_000) {
          logger.info('nfse: diagnóstico — corpo', { url: alvo, parte: i / 60_000 + 1, trecho: r.corpo.slice(i, i + 60_000) })
        }
        // a página de docs aponta para o JSON da especificação: segue o link, no mesmo host
        if (r.status === 200 && !rotas.length) {
          const achados = [
            ...r.corpo.matchAll(/["'\s(]([^"'\s()]+?\.json)["'\s)]/g),
            ...r.corpo.matchAll(/openApi\s*:\s*["']([^"']+)["']/g),
          ]
          for (const m of achados) {
            try {
              const ligado = new URL(m[1], alvo).toString()
              if (new URL(ligado).hostname === new URL(alvo).hostname && !vistos.has(ligado)) fila.push(ligado)
            } catch {
              // não era URL
            }
          }
        }
      }
    } finally {
      credenciais.provider.encerrar()
    }
    // O XML da última NFS-e emitida traz o DPS original como o Emissor Web o montou (regime,
    // inscrição, endereço do tomador): é o molde para a emissão. Sem assinatura nem certificado.
    try {
      // filtra em memória para não depender de índice composto (papel + dataEmissao)
      const recentes = await notasServicoRef(id).orderBy('dataEmissao', 'desc').limit(30).get()
      const doc = recentes.docs.map((d) => d.data() as { papel?: string; storagePath?: string; origem?: string }).find((n) => n.papel === 'prestador')
      if (doc?.storagePath && doc.origem !== 'municipal') {
        const [bytes] = await storage.bucket().file(doc.storagePath).download()
        const semAssinatura = bytes
          .toString('utf8')
          .replace(/<(\w+:)?Signature[\s\S]*?<\/(\w+:)?Signature>/g, '<!-- assinatura omitida -->')
        logger.info('nfse: diagnóstico — última nota emitida', { empresaId: id, storagePath: doc.storagePath, xml: semAssinatura.slice(0, 60_000) })
        resumo.push(`última nota emitida: ${doc.storagePath} (${semAssinatura.length} chars)`)
      }
    } catch (e) {
      resumo.push(`última nota emitida: ERRO ${(e as Error).message}`)
    }
    await auditar(id, 'xml_baixado', req.auth!.uid, { email, detalhe: 'diagnóstico das APIs nacionais' })
    logger.info('nfse: diagnóstico das APIs nacionais', { empresaId: id, resumo })
    return { resumo }
  },
)

// ---------- emissão, substituição e cancelamento (SEFIN Nacional) ----------

const ambienteDoPedido = (dados: unknown): AmbienteNfse => {
  const a = (dados as { ambiente?: unknown })?.ambiente
  return a === 'producao' ? 'producao' : 'homologacao'
}

/** Produção só com a palavra de confirmação: nota emitida tem efeito fiscal e não volta. */
function exigirConfirmacaoDeProducao(dados: unknown, ambiente: AmbienteNfse) {
  if (ambiente === 'producao' && (dados as { confirmacao?: unknown })?.confirmacao !== 'PRODUCAO') {
    throw new HttpsError('failed-precondition', 'Para emitir em produção, confirme digitando PRODUCAO.')
  }
}

const traduzirErroEmissao = (e: unknown): never => {
  if (e instanceof ErroEmissao || e instanceof ErroDps) throw new HttpsError('failed-precondition', e.message, { mensagens: (e as ErroEmissao).mensagens ?? [] })
  throw new HttpsError('internal', (e as Error).message)
}

/** O DPS de uma nota emitida pela empresa, para servir de modelo a uma nova ("gerar igual"). */
export const modeloEmissaoNfse = onCall({ region: REGIAO, timeoutSeconds: 60 }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  const { chaveAcesso } = (req.data ?? {}) as { chaveAcesso?: string }
  if (!chaveAcesso) throw new HttpsError('invalid-argument', 'Informe a chave da nota-modelo')
  try {
    const [modelo, numeracao] = await Promise.all([modeloDeNota(id, chaveAcesso), numeracaoAtual(id)])
    return { ...modelo, numeracao }
  } catch (e) {
    return traduzirErroEmissao(e)
  }
})

/** Numeração atual da emissão (série e próximo número), para a tela. */
export const numeracaoEmissaoNfse = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirMembro(req.auth?.uid, req.data)
  return numeracaoAtual(id)
})

/**
 * Emite (ou substitui, se `dados.substituicao` vier) uma NFS-e no SEFIN Nacional.
 * O DPS chega revisado da tela; numeração, data/hora e assinatura são do servidor.
 */
export const emitirNfse = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' },
  async (req) => {
    const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
    const ambiente = ambienteDoPedido(req.data)
    exigirConfirmacaoDeProducao(req.data, ambiente)
    const dados = (req.data as { dados?: DadosDps })?.dados
    if (!dados || typeof dados !== 'object') throw new HttpsError('invalid-argument', 'Informe os dados do DPS')
    try {
      const r = await emitirNfseNoSefin(id, FISCAL_CRYPTO_KEY.value(), dados, ambiente, req.auth!.uid)
      await auditar(id, 'nfse_emitida', req.auth!.uid, {
        email,
        chaveAcesso: r.chaveAcesso,
        detalhe: `${ambiente === 'producao' ? 'PRODUÇÃO' : 'produção restrita'} · DPS ${r.serie}/${r.numeroDps}${dados.substituicao ? ` · substitui ${dados.substituicao.chaveSubstituida}` : ''}`,
      })
      return r
    } catch (e) {
      return traduzirErroEmissao(e)
    }
  },
)

/** Registra o cancelamento (evento e101101) de uma NFS-e emitida pela empresa. */
export const cancelarNfse = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
    const { chaveAcesso, motivo, descricao } = (req.data ?? {}) as { chaveAcesso?: string; motivo?: string; descricao?: string }
    if (!chaveAcesso || !motivo || !descricao) throw new HttpsError('invalid-argument', 'Informe a chave, o motivo e a justificativa')
    if (!['1', '2', '9'].includes(motivo)) throw new HttpsError('invalid-argument', 'Motivo inválido')
    const nota = (await notasServicoRef(id).doc(chaveAcesso).get()).data() as { ambiente?: string } | undefined
    if (nota?.ambiente !== 'homologacao') exigirConfirmacaoDeProducao(req.data, 'producao')
    try {
      const r = await cancelarNfseNoSefin(id, FISCAL_CRYPTO_KEY.value(), chaveAcesso, motivo as MotivoCancelamento, descricao, req.auth!.uid)
      await auditar(id, 'nfse_cancelada', req.auth!.uid, { email, chaveAcesso: r.chaveAcesso, detalhe: `motivo ${motivo}: ${descricao}` })
      return r
    } catch (e) {
      return traduzirErroEmissao(e)
    }
  },
)

// ---------- guias a pagar (DAS, DARF, recibo de honorários) ----------

const traduzirErroGuia = (e: unknown): never => {
  if (e instanceof ErroGuia) throw new HttpsError('failed-precondition', e.message)
  throw new HttpsError('internal', (e as Error).message)
}

/** Importa o PDF oficial de uma guia. O sistema lê a guia; quem a emite é a Receita. */
export const importarGuia = onCall({ region: REGIAO, timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { nomeArquivo, pdfBase64 } = (req.data ?? {}) as { nomeArquivo?: string; pdfBase64?: string }
  if (!pdfBase64) throw new HttpsError('invalid-argument', 'Envie o PDF da guia')
  try {
    const r = await importarGuiaDaEmpresa(id, req.auth!.uid, nomeArquivo ?? 'guia.pdf', Buffer.from(pdfBase64, 'base64'))
    await auditar(id, 'guia_importada', req.auth!.uid, { email, detalhe: `${r.guia.tipo.toUpperCase()} ${r.guia.numeroDocumento ?? r.id}` })
    return { id: r.id, nova: r.nova, tipo: r.guia.tipo, valor: r.guia.valor ?? null, vencimento: r.guia.vencimento ?? null, avisos: r.guia.avisos }
  } catch (e) {
    return traduzirErroGuia(e)
  }
})

export const pdfGuia = onCall({ region: REGIAO, timeoutSeconds: 60 }, async (req) => {
  const { id } = await exigirMembro(req.auth?.uid, req.data)
  const { guiaId } = (req.data ?? {}) as { guiaId?: string }
  if (!guiaId) throw new HttpsError('invalid-argument', 'Informe a guia')
  try {
    const { pdf, nomeArquivo } = await pdfDaGuia(id, guiaId)
    return { nomeArquivo, pdfBase64: pdf.toString('base64') }
  } catch (e) {
    return traduzirErroGuia(e)
  }
})

/** Cria um link de 7 dias para a guia, para mandar a quem vai pagar. */
export const linkGuia = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const { guiaId } = (req.data ?? {}) as { guiaId?: string }
  if (!guiaId) throw new HttpsError('invalid-argument', 'Informe a guia')
  try {
    const { token, expiraEm } = await criarLinkDaGuia(id, req.auth!.uid, guiaId)
    await auditar(id, 'guia_compartilhada', req.auth!.uid, { email, detalhe: `${guiaId} · link até ${expiraEm.toLocaleDateString('pt-BR')}` })
    return { url: `https://${process.env.GCLOUD_PROJECT}.web.app/g/${token}`, expiraEm: expiraEm.toISOString() }
  } catch (e) {
    return traduzirErroGuia(e)
  }
})

const paginaDeAviso = (titulo: string, texto: string) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
  `<title>${titulo}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#0f172a">` +
  `<h1 style="font-size:1.25rem">${titulo}</h1><p style="color:#475569;line-height:1.5">${texto}</p></body></html>`

/**
 * Entrega o PDF de uma guia compartilhada. Aberta ao público por desenho — quem recebe o link no
 * WhatsApp não tem login — mas só responde a um token válido e dentro do prazo.
 */
export const guiaCompartilhada = onRequest({ region: REGIAO, invoker: 'public', memory: '256MiB' }, async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow')
  res.set('Cache-Control', 'private, no-store')
  res.set('Referrer-Policy', 'no-referrer')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Método não permitido')
    return
  }
  const token = req.path.split('/').filter(Boolean).pop() ?? ''
  const r = await abrirLinkDaGuia(token)
  if (r.situacao === 'expirado') {
    res.status(410).type('html').send(paginaDeAviso('Este link expirou', 'Os links de guia valem por 7 dias. Peça a quem enviou para compartilhar de novo.'))
    return
  }
  if (r.situacao !== 'ok') {
    res.status(404).type('html').send(paginaDeAviso('Link inválido', 'Este endereço não corresponde a nenhuma guia compartilhada.'))
    return
  }
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `inline; filename="${r.nomeArquivo.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
  res.status(200).send(r.pdf)
})

/** Baixa de pagamento: qualquer membro da empresa marca (é o cliente quem paga). */
export const marcarGuiaPaga = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const { guiaId, paga, dataPagamento } = (req.data ?? {}) as { guiaId?: string; paga?: boolean; dataPagamento?: string }
  if (!guiaId || typeof paga !== 'boolean') throw new HttpsError('invalid-argument', 'Informe a guia e a situação')
  try {
    await marcarPagamento(id, req.auth!.uid, guiaId, paga, dataPagamento)
    await auditar(id, 'guia_paga', req.auth!.uid, { email, detalhe: `${guiaId} → ${paga ? 'paga' : 'pendente'}` })
    return { ok: true }
  } catch (e) {
    return traduzirErroGuia(e)
  }
})

export const excluirGuia = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { guiaId } = (req.data ?? {}) as { guiaId?: string }
  if (!guiaId) throw new HttpsError('invalid-argument', 'Informe a guia')
  try {
    await excluirGuiaDaEmpresa(id, guiaId)
    await auditar(id, 'guia_excluida', req.auth!.uid, { email, detalhe: guiaId })
    return { ok: true }
  } catch (e) {
    return traduzirErroGuia(e)
  }
})

/** Gera o recibo de honorários do escritório — este o sistema emite, é documento próprio. */
export const gerarReciboDeHonorarios = onCall({ region: REGIAO, timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { competencia, valor, vencimento, descricao, comPix } = (req.data ?? {}) as { competencia?: string; valor?: number; vencimento?: string; descricao?: string; comPix?: boolean | null }
  if (!competencia || !vencimento || typeof valor !== 'number') throw new HttpsError('invalid-argument', 'Informe competência, valor e vencimento')
  try {
    const r = await gerarRecibo(id, req.auth!.uid, { competencia, valor, vencimento, descricao, comPix: comPix !== false })
    await auditar(id, 'recibo_gerado', req.auth!.uid, { email, detalhe: `nº ${r.numero} · ${competencia}${r.comPix ? ' · com PIX' : ''}` })
    return r
  } catch (e) {
    return traduzirErroGuia(e)
  }
})

// ---------- geração oficial de guias: Integra Contador (Serpro) ----------

const traduzirErroSerpro = (e: unknown): never => {
  if (e instanceof ErroSerpro || e instanceof ErroGuia) throw new HttpsError('failed-precondition', e.message)
  throw new HttpsError('internal', (e as Error).message)
}

const periodoDoPedido = (dados: unknown): string => {
  const p = (dados as { periodo?: unknown })?.periodo
  if (typeof p !== 'string' || !/^\d{4}-\d{2}$/.test(p)) throw new HttpsError('invalid-argument', 'Informe a competência (AAAA-MM)')
  return p
}

/** Guarda a consumer key/secret do contrato com o Serpro — cifradas, e nunca devolvidas. */
export const salvarCredenciaisSerpro = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { consumerKey, consumerSecret } = (req.data ?? {}) as { consumerKey?: string; consumerSecret?: string }
  if (!consumerKey || !consumerSecret) throw new HttpsError('invalid-argument', 'Informe a consumer key e a consumer secret')
  try {
    await salvarCredenciaisDoSerpro(id, FISCAL_CRYPTO_KEY.value(), consumerKey, consumerSecret)
    await auditar(id, 'serpro_configurado', req.auth!.uid, { email })
    return { ok: true }
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

export const removerCredenciaisSerpro = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  await removerCredenciaisDoSerpro(id)
  await auditar(id, 'serpro_removido', req.auth!.uid, { email })
  return { ok: true }
})

/** Demonstração oficial do Serpro (sem contrato) e, se houver credenciais, a autenticação de produção. */
export const testarSerpro = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  return testarSerproDaEmpresa(id, FISCAL_CRYPTO_KEY.value())
})

/** Gera o DAS do período na Receita (PGDASD/GERARDAS12). A declaração precisa já ter sido transmitida. */
export const gerarDasReceita = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const periodo = periodoDoPedido(req.data)
  const { dataConsolidacao } = (req.data ?? {}) as { dataConsolidacao?: string }
  if (dataConsolidacao && !/^\d{4}-\d{2}-\d{2}$/.test(dataConsolidacao)) throw new HttpsError('invalid-argument', 'Data de consolidação inválida')
  try {
    const r = await gerarDasNaReceita(id, FISCAL_CRYPTO_KEY.value(), req.auth!.uid, periodo, dataConsolidacao)
    await auditar(id, 'guia_gerada_receita', req.auth!.uid, { email, detalhe: `DAS ${periodo} · ${r.guia.numeroDocumento ?? r.id}` })
    return { id: r.id, nova: r.nova, valor: r.guia.valor ?? null, vencimento: r.guia.vencimento ?? null, observacoes: r.observacoes, avisos: r.guia.avisos }
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

/** Gera o DARF da DCTFWeb do período (GERARGUIA31 com recibo; GERARGUIAANDAMENTO313 sem). */
export const gerarDarfReceita = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const periodo = periodoDoPedido(req.data)
  // Campo em branco chega como null (o SDK do cliente serializa undefined assim): é "sem recibo",
  // não "recibo inválido". Aceita também o número digitado como texto.
  const bruto = (req.data as { numeroRecibo?: unknown } | undefined)?.numeroRecibo
  const textoRecibo = bruto === undefined || bruto === null ? '' : String(bruto).trim()
  if (textoRecibo && !/^\d{1,15}$/.test(textoRecibo)) throw new HttpsError('invalid-argument', 'Número do recibo inválido: use só os dígitos que aparecem em "Nº Recibo Declaração".')
  const numeroRecibo = textoRecibo ? Number(textoRecibo) : undefined
  try {
    const r = await gerarDarfNaReceita(id, FISCAL_CRYPTO_KEY.value(), req.auth!.uid, periodo, numeroRecibo)
    await auditar(id, 'guia_gerada_receita', req.auth!.uid, { email, detalhe: `DARF DCTFWeb ${periodo} · ${r.guia.numeroDocumento ?? r.id}` })
    return { id: r.id, nova: r.nova, valor: r.guia.valor ?? null, vencimento: r.guia.vencimento ?? null, avisos: r.guia.avisos }
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

/** Recibo e declaração do PGDAS-D do período: confirma se o contador já transmitiu. */
export const declaracaoPgdasd = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  const periodo = periodoDoPedido(req.data)
  try {
    const d = await declaracaoDoPeriodo(id, FISCAL_CRYPTO_KEY.value(), periodo)
    // consulta também é requisição tarifada: fica registrada para o painel de gasto
    await auditar(id, 'serpro_consulta', req.auth!.uid, { detalhe: `Declaração PGDAS-D ${periodo}` })
    const arquivo = (a?: { nomeArquivo: string; pdf: Buffer }) => (a ? { nomeArquivo: a.nomeArquivo, pdfBase64: a.pdf.toString('base64') } : null)
    return { numeroDeclaracao: d.numeroDeclaracao ?? null, recibo: arquivo(d.recibo), declaracao: arquivo(d.declaracao) }
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

// ---------- acompanhamento na Receita (pagamentos, caixa postal, situação fiscal) ----------

/** Dá baixa nas guias que a Receita já recebeu. Uma consulta tarifada cobre todas as guias em aberto. */
export const conferirPagamentosReceita = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  try {
    const r = await conferirPagamentos(id, FISCAL_CRYPTO_KEY.value(), req.auth!.uid)
    if (r.consultadas > 0) await auditar(id, 'serpro_consulta', req.auth!.uid, { email, detalhe: `Pagamentos: ${r.consultadas} guia(s) consultada(s), ${r.baixadas.length} paga(s)` })
    for (const b of r.baixadas) await auditar(id, 'guia_paga', req.auth!.uid, { email, detalhe: `${b.guiaId} · confirmada pela Receita em ${b.pagaEm}` })
    return r
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

/** Cabeçalhos das mensagens da Caixa Postal do e-CAC. Não abre o conteúdo: isso daria ciência da intimação. */
export const caixaPostalReceita = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  try {
    const r = await consultarCaixaPostal(id, FISCAL_CRYPTO_KEY.value(), req.auth!.uid)
    await auditar(id, 'serpro_consulta', req.auth!.uid, { email, detalhe: `Caixa postal: ${r.mensagens.length} mensagem(ns), ${r.naoLidas} não lida(s)` })
    return r
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

/** Relatório de situação fiscal (o que sustenta a certidão negativa), emitido agora pela Receita. */
export const situacaoFiscalReceita = onCall({ region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 240, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  try {
    const r = await emitirSituacaoFiscal(id, FISCAL_CRYPTO_KEY.value(), req.auth!.uid)
    await auditar(id, 'serpro_emissao', req.auth!.uid, { email, detalhe: `Situação fiscal · ${r.semPendencias ? 'sem pendências' : 'com pendências a conferir'}` })
    return r
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

/** Último relatório de situação fiscal guardado — não consulta a Receita, então não é tarifado. */
export const pdfSituacaoFiscalGuardado = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirMembro(req.auth?.uid, req.data)
  try {
    return await pdfSituacaoFiscal(id)
  } catch (e) {
    return traduzirErroSerpro(e)
  }
})

// ---------- folha de pagamento ----------

const traduzirErroFolha = (e: unknown): never => {
  if (e instanceof ErroFolha || e instanceof ErroTabela) throw new HttpsError('failed-precondition', e.message)
  throw new HttpsError('internal', (e as Error).message)
}

const competenciaDoPedido = (dados: unknown): string => {
  const c = (dados as { competencia?: unknown })?.competencia
  if (typeof c !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(c)) throw new HttpsError('invalid-argument', 'Informe a competência (AAAA-MM)')
  return c
}

/** Cria as rubricas padrão da empresa (códigos de natureza da Tabela 03 do eSocial). */
export const prepararFolha = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  return { rubricasCriadas: await garantirRubricas(id) }
})

/** Calcula a folha da competência. Com `funcionarioId`, só aquele holerite — com os lançamentos enviados. */
export const calcularFolhaDoMes = onCall({ region: REGIAO, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const competencia = competenciaDoPedido(req.data)
  const { funcionarioId, lancamentos } = (req.data ?? {}) as { funcionarioId?: string; lancamentos?: Array<{ codigo: string; valor: number; referencia?: string }> }
  try {
    if (funcionarioId) {
      const h = await calcularHoleriteDoFuncionario(id, req.auth!.uid, competencia, funcionarioId, Array.isArray(lancamentos) ? lancamentos : undefined)
      return { calculados: 1, erros: [], liquido: h.resultado.liquido, avisos: h.resultado.avisos }
    }
    const r = await calcularFolha(id, req.auth!.uid, competencia)
    await auditar(id, 'folha_calculada', req.auth!.uid, { email, detalhe: `${competencia} · ${r.calculados} holerite(s)` })
    return { ...r, avisos: [] }
  } catch (e) {
    return traduzirErroFolha(e)
  }
})

export const removerHoleriteDaFolha = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  const competencia = competenciaDoPedido(req.data)
  const { funcionarioId } = (req.data ?? {}) as { funcionarioId?: string }
  if (!funcionarioId) throw new HttpsError('invalid-argument', 'Informe o funcionário')
  try {
    await removerHolerite(id, competencia, funcionarioId)
    return { ok: true }
  } catch (e) {
    return traduzirErroFolha(e)
  }
})

export const fecharFolhaDoMes = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const competencia = competenciaDoPedido(req.data)
  const { reabrir } = (req.data ?? {}) as { reabrir?: boolean }
  try {
    if (reabrir) {
      await reabrirFolha(id, competencia)
      await auditar(id, 'folha_reaberta', req.auth!.uid, { email, detalhe: competencia })
    } else {
      await fecharFolha(id, req.auth!.uid, competencia)
      await auditar(id, 'folha_fechada', req.auth!.uid, { email, detalhe: competencia })
    }
    return { ok: true }
  } catch (e) {
    return traduzirErroFolha(e)
  }
})

export const pdfHolerite = onCall({ region: REGIAO, timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  const competencia = competenciaDoPedido(req.data)
  const { funcionarioId } = (req.data ?? {}) as { funcionarioId?: string }
  if (!funcionarioId) throw new HttpsError('invalid-argument', 'Informe o funcionário')
  try {
    const { pdf, nomeArquivo } = await pdfDoHolerite(id, competencia, funcionarioId)
    return { nomeArquivo, pdfBase64: pdf.toString('base64') }
  } catch (e) {
    return traduzirErroFolha(e)
  }
})

/**
 * Importa as NFS-e antigas direto do web service do município (padrão ABRASF 2.02).
 *
 * É o caminho para as notas anteriores à migração do município para o Emissor Nacional, que o
 * ADN não distribui. A consulta é oficial e por CNPJ + período — sem scraping.
 */
export const importarNfseMunicipal = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 540, memory: '1GiB' },
  async (req) => {
    const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
    const { de, ate, incluirTomadas } = (req.data ?? {}) as { de?: string; ate?: string; incluirTomadas?: boolean }
    if (!de || !ate) throw new HttpsError('invalid-argument', 'Informe o período (de e até)')

    const inicio = new Date(`${de}T00:00:00-03:00`)
    const fim = new Date(`${ate}T23:59:59-03:00`)
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new HttpsError('invalid-argument', 'Período inválido')
    }
    if (inicio > fim) throw new HttpsError('invalid-argument', 'A data inicial é posterior à final')

    try {
      const r = await importarDoMunicipio(id, FISCAL_CRYPTO_KEY.value(), {
        de: inicio,
        ate: fim,
        incluirTomadas: Boolean(incluirTomadas),
      })
      await auditar(id, 'sincronizacao_manual', req.auth!.uid, {
        email,
        detalhe: `Importação municipal ${r.de} a ${r.ate} · ${r.novas} nova(s), ${r.atualizadas} já conhecida(s)`,
      })
      return r
    } catch (e) {
      const erro = (e as Error).message
      logger.error('municipal: importação falhou', { empresaId: id, erro })
      throw new HttpsError('internal', erro)
    }
  },
)

/** Guarda o município e a inscrição municipal usados na consulta ABRASF. */
export const salvarMunicipioWebservice = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { municipio, inscricaoMunicipal } = (req.data ?? {}) as { municipio?: string; inscricaoMunicipal?: string }
  const apelido = (municipio ?? '').trim().toLowerCase()
  if (apelido && !/^[a-z0-9.-]{3,80}$/.test(apelido)) throw new HttpsError('invalid-argument', 'Município inválido')

  await configFiscalRef(id).set(
    {
      tipo: 'fiscal',
      municipioWebservice: apelido || FieldValue.delete(),
      inscricaoMunicipal: (inscricaoMunicipal ?? '').trim() || FieldValue.delete(),
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  await auditar(id, 'integracao_ativada', req.auth!.uid, { email, detalhe: `Web service municipal: ${apelido || 'removido'}` })
  return { ok: true }
})
