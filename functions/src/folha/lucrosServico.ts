/**
 * Registro dos lucros distribuídos a cada sócio: /empresas/{id}/lucros/{id}.
 * Só o backend grava (a retenção é calculada aqui, com os outros pagamentos do mês); só
 * administrador lê — é renda de pessoa física.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { REGIAO } from '../lib/config'
import { auditar, exigirAdmin } from '../fiscal'
import { raizRef } from '../fiscal/modelo'
import { retencaoDoNovoPagamento, type PagamentoDeLucro } from './lucros'

const lucrosRef = (empresaId: string) => raizRef(empresaId).collection('lucros')
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

function cpfValido(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false
  const dv = (n: number) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10])
}

/** Registra um pagamento de lucros e devolve quanto reter nele, considerando o que o sócio já recebeu no mês. */
export const registrarLucroDistribuido = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as { socioNome?: string; socioCpf?: string; data?: string; valor?: number; excecao2025?: boolean; observacao?: string | null }
  const socioNome = (d.socioNome ?? '').trim().slice(0, 100)
  const socioCpf = soDigitos(d.socioCpf)
  if (socioNome.length < 3) throw new HttpsError('invalid-argument', 'Informe o nome do sócio')
  if (!cpfValido(socioCpf)) throw new HttpsError('invalid-argument', 'CPF do sócio inválido')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data ?? '') || Number.isNaN(Date.parse(d.data!))) throw new HttpsError('invalid-argument', 'Data do pagamento inválida')
  if (typeof d.valor !== 'number' || !(d.valor > 0) || d.valor > 1e10) throw new HttpsError('invalid-argument', 'Valor inválido')

  const competencia = d.data!.slice(0, 7)
  const doMes = await lucrosRef(id).where('socioCpf', '==', socioCpf).where('competencia', '==', competencia).get()
  const anteriores = doMes.docs.map((x) => x.data() as PagamentoDeLucro)
  const r = retencaoDoNovoPagamento(competencia, anteriores, { valor: d.valor, excecao2025: d.excecao2025 === true })

  const observacao = d.observacao?.trim().slice(0, 300)
  const ref = await lucrosRef(id).add({
    socioNome,
    socioCpf,
    data: d.data,
    competencia,
    valor: d.valor,
    excecao2025: d.excecao2025 === true,
    irrfRetido: r.irrf,
    liquido: r.liquido,
    ...(observacao ? { observacao } : {}),
    criadoPor: req.auth!.uid,
    criadoEm: FieldValue.serverTimestamp(),
  })
  // CPF não vai para a auditoria: fica só o nome
  await auditar(id, 'lucro_registrado', req.auth!.uid, { email, detalhe: `${socioNome} · ${d.data} · ${d.valor.toFixed(2)} · IRRF ${r.irrf.toFixed(2)}` })
  return { id: ref.id, irrf: r.irrf, liquido: r.liquido, mes: r.mes }
})

export const excluirLucroDistribuido = onCall({ region: REGIAO }, async (req) => {
  const { id, email } = await exigirAdmin(req.auth?.uid, req.data)
  const lucroId = String((req.data as { lucroId?: unknown } | undefined)?.lucroId ?? '')
  if (!lucroId) throw new HttpsError('invalid-argument', 'Informe o pagamento')
  const ref = lucrosRef(id).doc(lucroId)
  const atual = await ref.get()
  if (!atual.exists) throw new HttpsError('not-found', 'Pagamento não encontrado nesta empresa')
  await ref.delete()
  await auditar(id, 'lucro_excluido', req.auth!.uid, { email, detalhe: `${atual.data()?.socioNome as string} · ${atual.data()?.data as string}` })
  return { ok: true }
})
