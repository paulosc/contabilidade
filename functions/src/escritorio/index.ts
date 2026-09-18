/**
 * Functions da visão de escritório: carteira de clientes, calendário de obrigações e apuração do
 * Simples. O vínculo com a empresa é sempre conferido no backend (exigirMembro), como no restante.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { REGIAO } from '../lib/config'
import { auditar, exigirAdmin, exigirEquipe, exigirMembro, exigirVinculo } from '../fiscal'
import { ErroDocumento, avaliarSolicitacao, baixarDocumento, criarSolicitacao, enviarDocumento, excluirDocumento } from './documentos'
import { ErroCartaoCnpj, lerCartaoCnpj } from './cartaoCnpj'
import { ErroContrato, type DadosContrato } from './contrato'
import { textoDoPdf } from '../fiscal/guiasServico'
import { gerarContrato, gerarHonorariosRecorrentes } from './gestao'
import { ErroMembro, adicionarMembro, alterarPapel, removerMembro } from './membros'
import { ErroEscritorio, apuracaoDoPeriodo, calendarioDaEmpresa, carteiraDoUsuario, marcarObrigacao } from './servico'

const traduzir = (e: unknown): never => {
  if (e instanceof HttpsError) throw e
  if (e instanceof ErroEscritorio || e instanceof ErroDocumento || e instanceof ErroMembro || e instanceof ErroContrato || e instanceof ErroCartaoCnpj) throw new HttpsError('failed-precondition', e.message)
  throw new HttpsError('internal', (e as Error).message)
}

const mesDoPedido = (dados: unknown, campo: string): string => {
  const v = (dados as Record<string, unknown> | undefined)?.[campo]
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpsError('invalid-argument', 'Informe o mês no formato AAAA-MM')
  return v
}

/** Todas as empresas do usuário, com as pendências de cada uma. */
export const carteiraDeClientes = onCall({ region: REGIAO, timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Faça login')
  try {
    return await carteiraDoUsuario(req.auth.uid)
  } catch (e) {
    return traduzir(e)
  }
})

/** Obrigações que vencem no mês, com a situação de cada uma. */
export const calendarioObrigacoes = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirEquipe(req.auth?.uid, req.data)
  try {
    return await calendarioDaEmpresa(id, mesDoPedido(req.data, 'mes'))
  } catch (e) {
    return traduzir(e)
  }
})

/** Marca (ou desmarca) um item do checklist. Qualquer pessoa da equipe do escritório pode. */
export const marcarObrigacaoFeita = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const { competencia, codigo, marcacao, observacao } = (req.data ?? {}) as { competencia?: string; codigo?: string; marcacao?: string | null; observacao?: string | null }
  if (!competencia || !codigo) throw new HttpsError('invalid-argument', 'Informe a obrigação')
  if (marcacao !== 'feita' && marcacao !== 'dispensada' && marcacao != null) throw new HttpsError('invalid-argument', 'Marcação inválida')
  try {
    await marcarObrigacao(id, { uid: req.auth!.uid, nome: (req.auth!.token.name as string | undefined) ?? email }, { competencia, codigo, marcacao: marcacao ?? null, observacao: observacao ?? undefined })
    await auditar(id, 'obrigacao_marcada', req.auth!.uid, { email, detalhe: `${codigo} · ${competencia} · ${marcacao ?? 'reaberta'}` })
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})

/** Conferência do Simples Nacional do período: RBT12, Fator R, alíquota efetiva e DAS estimado. */
export const apuracaoSimples = onCall({ region: REGIAO, memory: '512MiB' }, async (req) => {
  const { id } = await exigirEquipe(req.auth?.uid, req.data)
  try {
    return await apuracaoDoPeriodo(id, mesDoPedido(req.data, 'periodo'))
  } catch (e) {
    return traduzir(e)
  }
})

// ---------- equipe e acesso do cliente ----------

const nomeDe = (req: CallableRequest, email?: string): string | undefined => {
  const nome = req.auth?.token.name as unknown
  return typeof nome === 'string' && nome ? nome : email
}

/** Dá acesso à empresa a quem já tem conta, pelo e-mail. */
export const adicionarMembroDaEmpresa = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { email: convidado, papel } = (req.data ?? {}) as { email?: string; papel?: string }
  try {
    const r = await adicionarMembro(id, convidado ?? '', papel)
    await auditar(id, 'membro_adicionado', req.auth!.uid, { email, detalhe: `${convidado} · ${papel}` })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

export const alterarMembroDaEmpresa = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const { uid, papel, remover } = (req.data ?? {}) as { uid?: string; papel?: string; remover?: boolean }
  if (!uid) throw new HttpsError('invalid-argument', 'Informe a pessoa')
  try {
    if (remover) {
      await removerMembro(id, req.auth!.uid, uid)
      await auditar(id, 'membro_removido', req.auth!.uid, { email, detalhe: uid })
    } else {
      await alterarPapel(id, req.auth!.uid, uid, papel)
      await auditar(id, 'membro_alterado', req.auth!.uid, { email, detalhe: `${uid} · ${papel}` })
    }
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})

// ---------- documentos e solicitações ----------

/** Envio de documento: o cliente e a equipe podem. */
export const enviarDocumentoDaEmpresa = onCall({ region: REGIAO, timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const p = (req.data ?? {}) as { nomeArquivo?: string; conteudoBase64?: string; categoria?: string; competencia?: string | null; observacao?: string | null; solicitacaoId?: string | null }
  if (!p.nomeArquivo || !p.conteudoBase64) throw new HttpsError('invalid-argument', 'Envie o arquivo')
  try {
    const r = await enviarDocumento(id, { uid: req.auth!.uid, nome: nomeDe(req, email) }, { nomeArquivo: p.nomeArquivo, conteudoBase64: p.conteudoBase64, categoria: p.categoria, competencia: p.competencia ?? undefined, observacao: p.observacao ?? undefined, solicitacaoId: p.solicitacaoId ?? undefined })
    await auditar(id, 'documento_enviado', req.auth!.uid, { email, detalhe: p.nomeArquivo.slice(0, 120) })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

export const baixarDocumentoDaEmpresa = onCall({ region: REGIAO, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
  const { documentoId } = (req.data ?? {}) as { documentoId?: string }
  if (!documentoId) throw new HttpsError('invalid-argument', 'Informe o documento')
  try {
    const r = await baixarDocumento(id, documentoId)
    await auditar(id, 'documento_baixado', req.auth!.uid, { email, detalhe: r.nomeArquivo })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

export const excluirDocumentoDaEmpresa = onCall({ region: REGIAO }, async (req) => {
  const { id, email, papel } = await exigirVinculo(req.auth?.uid, req.data)
  const { documentoId } = (req.data ?? {}) as { documentoId?: string }
  if (!documentoId) throw new HttpsError('invalid-argument', 'Informe o documento')
  try {
    await excluirDocumento(id, { uid: req.auth!.uid, daEquipe: papel !== 'cliente' }, documentoId)
    await auditar(id, 'documento_excluido', req.auth!.uid, { email, detalhe: documentoId })
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})

/** Pedido de documento ao cliente. Só a equipe do escritório cria. */
export const criarSolicitacaoDeDocumento = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const p = (req.data ?? {}) as { titulo?: string; descricao?: string | null; categoria?: string; competencia?: string | null; prazo?: string | null }
  try {
    const r = await criarSolicitacao(id, { uid: req.auth!.uid, nome: nomeDe(req, email) }, { titulo: p.titulo ?? '', descricao: p.descricao ?? undefined, categoria: p.categoria ?? 'outro', competencia: p.competencia ?? undefined, prazo: p.prazo ?? undefined })
    await auditar(id, 'solicitacao_criada', req.auth!.uid, { email, detalhe: (p.titulo ?? '').slice(0, 120) })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

/** A equipe aceita o que chegou, recusa dizendo o que faltou, ou apaga um pedido ainda sem resposta. */
export const avaliarSolicitacaoDeDocumento = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const { solicitacaoId, decisao, motivo } = (req.data ?? {}) as { solicitacaoId?: string; decisao?: string; motivo?: string | null }
  if (!solicitacaoId || (decisao !== 'aceita' && decisao !== 'recusada' && decisao !== 'excluir')) throw new HttpsError('invalid-argument', 'Informe a solicitação e a decisão')
  try {
    await avaliarSolicitacao(id, solicitacaoId, decisao, motivo ?? undefined)
    await auditar(id, 'solicitacao_avaliada', req.auth!.uid, { email, detalhe: `${solicitacaoId} · ${decisao}` })
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})

// ---------- gestão do escritório ----------

/** Minuta do contrato de prestação de serviços contábeis (Resolução CFC 1.590/2020). */
export const gerarContratoDeServicos = onCall({ region: REGIAO, timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const dados = (req.data as { contrato?: DadosContrato } | undefined)?.contrato
  if (!dados || typeof dados !== 'object') throw new HttpsError('invalid-argument', 'Informe os dados do contrato')
  try {
    const r = await gerarContrato(id, { uid: req.auth!.uid, nome: nomeDe(req, email) }, dados)
    await auditar(id, 'contrato_gerado', req.auth!.uid, { email, detalhe: `${dados.contratante?.nome ?? ''} · honorários ${dados.honorarioMensal}` })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

/** Todo dia, 7h: gera o recibo de honorários do mês para quem ligou a recorrência. Não repete o que já existe. */
export const honorariosRecorrentes = onSchedule({ schedule: 'every day 07:00', timeZone: 'America/Sao_Paulo', region: REGIAO, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  await gerarHonorariosRecorrentes()
})

// ---------- cadastro da empresa pelo cartão CNPJ ----------

const MAX_CARTAO_CNPJ = 3 * 1024 * 1024

/**
 * Lê o Comprovante de Inscrição e de Situação Cadastral (PDF da Receita) e devolve os dados da
 * empresa. Serve ao cadastro de empresa nova, então só exige login — não há empresa ainda. Nada é
 * gravado nem guardado: o PDF é lido em memória e descartado.
 */
export const lerCartaoCnpjDoPdf = onCall({ region: REGIAO, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Faça login')
  const base64 = (req.data as { conteudoBase64?: unknown } | undefined)?.conteudoBase64
  if (typeof base64 !== 'string' || !base64) throw new HttpsError('invalid-argument', 'Envie o PDF do comprovante')
  if (base64.length > Math.ceil((MAX_CARTAO_CNPJ * 4) / 3) + 4) throw new HttpsError('invalid-argument', 'Arquivo grande demais: o comprovante do CNPJ tem uma página só.')
  try {
    const pdf = Buffer.from(base64, 'base64')
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroCartaoCnpj('O arquivo enviado não é um PDF.')
    return lerCartaoCnpj(await textoDoPdf(pdf))
  } catch (e) {
    return traduzir(e)
  }
})
