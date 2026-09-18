/**
 * Retenção de IR sobre lucros e dividendos pagos a pessoa física — conta pura.
 *
 * Lei 9.250/1995, art. 6º-A (incluído pela Lei 15.270/2025), vigente desde janeiro de 2026:
 *   caput  quando a MESMA pessoa jurídica paga à MESMA pessoa física mais de R$ 50.000,00 de lucros
 *          no mesmo mês, retém 10% "sobre o total do valor pago" — não só sobre o excedente;
 *   § 1º   sem nenhuma dedução da base;
 *   § 2º   havendo mais de um pagamento no mês, a retenção é recalculada sobre o total do mês;
 *   § 3º   ficam de fora os lucros de resultados apurados até 2025, com distribuição aprovada até
 *          31/12/2025 e pagos nos termos originalmente previstos no ato de aprovação.
 * A lei não abre exceção para empresa do Simples Nacional.
 *
 * Recolhimento (orientação da Receita, agosto/2026): DARF 1841-01, vencimento no último dia útil
 * do 2º decêndio do mês seguinte; informado no R-4010 da EFD-Reinf e confessado na DCTFWeb.
 */

export const LIMITE_MENSAL_LUCROS = 50_000
export const ALIQUOTA_LUCROS = 0.1
export const INICIO_DA_RETENCAO = '2026-01'
export const CODIGO_DARF_LUCROS = '1841-01'

export interface PagamentoDeLucro {
  valor: number
  /** Lucro enquadrado na exceção do § 3º (resultado até 2025, aprovado até 31/12/2025) */
  excecao2025?: boolean
  /** Quanto já foi retido neste pagamento */
  irrfRetido?: number
}

const emCentavos = (v: number) => Math.round(v * 100)
const emReais = (c: number) => c / 100

export interface LucrosDoMes {
  /** Soma do que entra na regra (fora a exceção do § 3º) */
  sujeito: number
  foraDaRegra: number
  /** IR devido no mês, recalculado sobre o total (§ 2º) */
  devido: number
  retido: number
  /** Devido menos retido: positivo = falta reter; negativo = reteve a mais */
  diferenca: number
  /** Quanto ainda pode ser pago no mês sem disparar a retenção (0 se já passou) */
  folgaAteOLimite: number
}

/** Situação dos pagamentos de um mês, de uma empresa para um sócio. */
export function lucrosDoMes(competencia: string, pagamentos: PagamentoDeLucro[]): LucrosDoMes {
  const sujeito = pagamentos.filter((p) => !p.excecao2025).reduce((s, p) => s + emCentavos(p.valor), 0)
  const foraDaRegra = pagamentos.filter((p) => p.excecao2025).reduce((s, p) => s + emCentavos(p.valor), 0)
  const retido = pagamentos.reduce((s, p) => s + emCentavos(p.irrfRetido ?? 0), 0)
  const vale = competencia >= INICIO_DA_RETENCAO
  const limite = emCentavos(LIMITE_MENSAL_LUCROS)
  const devido = vale && sujeito > limite ? Math.round(sujeito * ALIQUOTA_LUCROS) : 0
  return { sujeito: emReais(sujeito), foraDaRegra: emReais(foraDaRegra), devido: emReais(devido), retido: emReais(retido), diferenca: emReais(devido - retido), folgaAteOLimite: emReais(Math.max(0, limite - sujeito)) }
}

/**
 * Quanto reter ao fazer mais um pagamento no mês: o devido sobre o total (já com o novo) menos o
 * que os pagamentos anteriores do mês já retiveram. É por isso que o pagamento que cruza os
 * R$ 50 mil "paga" a retenção dos anteriores também.
 */
export function retencaoDoNovoPagamento(competencia: string, anteriores: PagamentoDeLucro[], novo: { valor: number; excecao2025?: boolean }): { irrf: number; liquido: number; mes: LucrosDoMes } {
  if (!(novo.valor > 0)) throw new Error('Valor do pagamento inválido.')
  const antes = lucrosDoMes(competencia, anteriores)
  const comNovo = lucrosDoMes(competencia, [...anteriores, novo])
  // pagamento na exceção não retém nada, mesmo que o mês já esteja acima do limite
  const irrf = novo.excecao2025 ? 0 : Math.max(0, emReais(emCentavos(comNovo.devido) - emCentavos(antes.retido)))
  const retencao = Math.min(irrf, novo.valor)
  return { irrf: retencao, liquido: emReais(emCentavos(novo.valor) - emCentavos(retencao)), mes: lucrosDoMes(competencia, [...anteriores, { ...novo, irrfRetido: retencao }]) }
}
