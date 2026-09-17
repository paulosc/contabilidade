/**
 * Integração fiscal (NF-e) — callables da tela e worker agendado.
 *
 * Nenhuma dessas funções confia no `empresaId` que vier do cliente: o tenant é sempre
 * derivado do uid autenticado (/usuarios/{uid}.empresaId + /empresas/{id}/membros/{uid}),
 * do mesmo jeito que o módulo de integrações já faz. É isso que garante que a empresa A
 * não alcance documento nenhum da empresa B.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
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

async function exigirMembro(uid: string | undefined, dados?: unknown): Promise<{ id: string; email?: string }> {
  const { id, email } = await vinculoDoUsuario(uid, empresaDoPedido(dados))
  return { id, email }
}

async function exigirAdmin(uid: string | undefined, dados?: unknown): Promise<{ id: string; email?: string }> {
  const { id, papel, email } = await vinculoDoUsuario(uid, empresaDoPedido(dados))
  if (papel !== 'admin') throw new HttpsError('permission-denied', 'Apenas administradores')
  return { id, email }
}

async function auditar(
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
export const pdfNotaServico = onCall(
  { region: REGIAO, secrets: SEGREDOS_FISCAIS, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const { id, email } = await exigirMembro(req.auth?.uid, req.data)
    const { chaveAcesso } = (req.data ?? {}) as { chaveAcesso?: string }
    if (!chaveAcesso) throw new HttpsError('invalid-argument', 'Informe a chave de acesso')

    // a nota precisa ser desta empresa: nada de baixar PDF de chave arbitrária
    const snap = await notasServicoRef(id).doc(chaveAcesso).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Nota de serviço não encontrada nesta empresa')

    const credenciais = await resolverCredenciaisNfse(id, FISCAL_CRYPTO_KEY.value())
    try {
      const pdf = await credenciais.provider.danfse(chaveAcesso)
      await auditar(id, 'xml_baixado', req.auth!.uid, { email, chaveAcesso, detalhe: 'PDF (DANFSe)' })
      return { chaveAcesso, nomeArquivo: `${chaveAcesso}.pdf`, pdfBase64: pdf.toString('base64') }
    } catch (e) {
      const erro = (e as Error).message
      logger.error('nfse: falha ao gerar o PDF', { empresaId: id, chaveAcesso, erro })
      throw new HttpsError('internal', erro)
    } finally {
      credenciais.provider.encerrar()
    }
  },
)

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
