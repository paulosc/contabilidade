/**
 * Functions da visão de escritório: carteira de clientes, calendário de obrigações e apuração do
 * Simples. O vínculo com a empresa é sempre conferido no backend (exigirMembro), como no restante.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { REGIAO } from '../lib/config'
import { auditar, exigirMembro } from '../fiscal'
import { ErroEscritorio, apuracaoDoPeriodo, calendarioDaEmpresa, carteiraDoUsuario, marcarObrigacao } from './servico'

const traduzir = (e: unknown): never => {
  if (e instanceof HttpsError) throw e
  if (e instanceof ErroEscritorio) throw new HttpsError('failed-precondition', e.message)
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
  const { id } = await exigirMembro(req.auth?.uid, req.data)
  try {
    return await calendarioDaEmpresa(id, mesDoPedido(req.data, 'mes'))
  } catch (e) {
    return traduzir(e)
  }
})

/** Marca (ou desmarca) um item do checklist. Qualquer membro da equipe pode. */
export const marcarObrigacaoFeita = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirMembro(req.auth?.uid, req.data)
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
  const { id } = await exigirMembro(req.auth?.uid, req.data)
  try {
    return await apuracaoDoPeriodo(id, mesDoPedido(req.data, 'periodo'))
  } catch (e) {
    return traduzir(e)
  }
})
