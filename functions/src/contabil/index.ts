/**
 * Functions da contabilidade. Tudo aqui é rotina da equipe do escritório (o papel "cliente" não
 * entra); encerrar e reabrir período é só de administrador.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { REGIAO } from '../lib/config'
import { auditar, exigirAdmin, exigirEquipe } from '../fiscal'
import { ErroContabil, ErroOfx, conciliar, criarConta, demonstracoes, desfazerConciliacao, excluirLancamento, fecharPeriodo, ignorarMovimento, importarExtrato, lancar, prepararContabilidade, razao } from './servico'
import type { Partida } from './razao'

const traduzir = (e: unknown): never => {
  if (e instanceof HttpsError) throw e
  if (e instanceof ErroContabil || e instanceof ErroOfx) throw new HttpsError('failed-precondition', e.message)
  throw new HttpsError('internal', (e as Error).message)
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Cria o plano de contas padrão da empresa (só na primeira vez). */
export const prepararContabilidadeDaEmpresa = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  try {
    const r = await prepararContabilidade(id)
    if (r.criadas) await auditar(id, 'contabil_plano', req.auth!.uid, { email, detalhe: `Plano de contas padrão: ${r.criadas} contas` })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

export const criarContaContabil = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as Record<string, unknown>
  try {
    const c = await criarConta(id, { codigo: texto(d.codigo), nome: texto(d.nome), dre: texto(d.dre) || null, disponivel: d.disponivel === true })
    await auditar(id, 'contabil_plano', req.auth!.uid, { email, detalhe: `Conta ${c.codigo} ${c.nome}` })
    return c
  } catch (e) {
    return traduzir(e)
  }
})

export const importarExtratoOfx = onCall({ region: REGIAO, timeoutSeconds: 180, memory: '512MiB' }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as Record<string, unknown>
  if (!texto(d.contaBanco)) throw new HttpsError('invalid-argument', 'Escolha a conta de banco do extrato')
  try {
    const r = await importarExtrato(id, { conteudoBase64: texto(d.conteudoBase64), contaBanco: texto(d.contaBanco) })
    await auditar(id, 'contabil_extrato', req.auth!.uid, { email, detalhe: `${r.novas} nova(s), ${r.repetidas} repetida(s) · ${r.de ?? '?'} a ${r.ate ?? '?'}` })
    return r
  } catch (e) {
    return traduzir(e)
  }
})

/** Classifica uma movimentação do extrato (gera o lançamento), ignora, ou desfaz. */
export const conciliarMovimento = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as Record<string, unknown>
  const extratoId = texto(d.extratoId)
  const acao = texto(d.acao)
  if (!extratoId) throw new HttpsError('invalid-argument', 'Informe a movimentação')
  try {
    if (acao === 'conciliar') return await conciliar(id, req.auth!.uid, { extratoId, conta: texto(d.conta), historico: texto(d.historico) || undefined, lembrar: d.lembrar === true })
    if (acao === 'desfazer') await desfazerConciliacao(id, extratoId)
    else if (acao === 'ignorar' || acao === 'restaurar') await ignorarMovimento(id, extratoId, acao === 'ignorar')
    else throw new HttpsError('invalid-argument', 'Ação inválida')
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})

export const lancarContabil = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as { data?: string; historico?: string; partidas?: unknown }
  const partidas: Partida[] = Array.isArray(d.partidas)
    ? d.partidas.slice(0, 40).map((p) => {
        const o = (p ?? {}) as Record<string, unknown>
        const debito = typeof o.debito === 'number' && o.debito > 0 ? o.debito : undefined
        const credito = typeof o.credito === 'number' && o.credito > 0 ? o.credito : undefined
        return { conta: texto(o.conta), ...(debito ? { debito } : {}), ...(credito ? { credito } : {}) }
      })
    : []
  try {
    const lancamentoId = await lancar(id, req.auth!.uid, { data: texto(d.data), historico: texto(d.historico), partidas })
    await auditar(id, 'contabil_lancamento', req.auth!.uid, { email, detalhe: `${texto(d.data)} · ${texto(d.historico).slice(0, 80)}` })
    return { lancamentoId }
  } catch (e) {
    return traduzir(e)
  }
})

export const excluirLancamentoContabil = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirEquipe(req.auth?.uid, req.data)
  const lancamentoId = texto((req.data as Record<string, unknown> | undefined)?.lancamentoId)
  if (!lancamentoId) throw new HttpsError('invalid-argument', 'Informe o lançamento')
  try {
    await excluirLancamento(id, lancamentoId)
    await auditar(id, 'contabil_lancamento', req.auth!.uid, { email, detalhe: `excluído ${lancamentoId}` })
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})

/** Balancete de verificação e DRE do período. */
export const demonstracoesContabeis = onCall({ region: REGIAO, memory: '512MiB', timeoutSeconds: 120 }, async (req) => {
  const { id } = await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as Record<string, unknown>
  try {
    return await demonstracoes(id, texto(d.de), texto(d.ate))
  } catch (e) {
    return traduzir(e)
  }
})

/** Razão de uma conta analítica no período, com saldo corrente. */
export const razaoContabil = onCall({ region: REGIAO, memory: '512MiB' }, async (req) => {
  const { id } = await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as Record<string, unknown>
  try {
    return await razao(id, texto(d.conta), texto(d.de), texto(d.ate))
  } catch (e) {
    return traduzir(e)
  }
})

/** Encerra o período até a data (ou reabre, sem data). Só administrador. */
export const fecharPeriodoContabil = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const ate = texto((req.data as Record<string, unknown> | undefined)?.ate) || null
  try {
    await fecharPeriodo(id, req.auth!.uid, ate)
    await auditar(id, 'contabil_periodo', req.auth!.uid, { email, detalhe: ate ? `encerrado até ${ate}` : 'reaberto' })
    return { ok: true }
  } catch (e) {
    return traduzir(e)
  }
})
