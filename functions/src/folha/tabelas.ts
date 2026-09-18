/**
 * Tabelas oficiais da folha de pagamento, por vigência.
 *
 * Cada tabela tem a data em que começou a valer e o ato que a fixou. O cálculo de uma competência
 * usa a tabela vigente NAQUELA competência — nunca "a mais nova". Competência sem tabela
 * cadastrada é recusada: melhor não calcular do que calcular com número de outro ano.
 *
 * Fontes (conferidas em 18/09/2026):
 *  - INSS 2026: Portaria Interministerial MPS/MF nº 13, de 09/01/2026
 *    https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal
 *  - INSS 2025: Portaria Interministerial MPS/MF nº 6, de 10/01/2025. Conferida pelos quatro
 *    exemplos oficiais da Receita (INSS de R$ 257,73, 373,41, 509,60 e 649,60 para salários de
 *    R$ 3.036, 4.000, 5.000 e 6.000), que só fecham com estas faixas.
 *  - IRRF: tabela progressiva mensal e parâmetros em
 *    https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026
 *  - Redução do IRRF: Lei nº 15.270/2025, vigente a partir de 01/2026; exemplos oficiais em
 *    https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/exemplos-de-aplicacao-da-lei-15-191-2025
 */

export interface FaixaProgressiva {
  /** Limite superior da faixa (inclusive) */
  ate: number
  aliquota: number
}

export interface TabelaInss {
  /** Primeira competência em que vale, 'AAAA-MM' */
  vigencia: string
  ato: string
  salarioMinimo: number
  teto: number
  /** Empregado, doméstico e avulso: progressiva, cada alíquota só sobre a parcela da faixa */
  faixas: FaixaProgressiva[]
  /** Contribuinte individual que presta serviço a empresa (pró-labore): alíquota única até o teto */
  aliquotaContribuinteIndividual: number
}

export interface FaixaIrrf {
  ate: number
  aliquota: number
  deducao: number
}

export interface ReducaoIrrf {
  /** Até este rendimento, a redução zera o imposto */
  rendimentoIsento: number
  reducaoMaxima: number
  /** Entre o isento e este limite: redução = constante − coeficiente × rendimentos tributáveis */
  rendimentoLimite: number
  constante: number
  coeficiente: number
}

export interface TabelaIrrf {
  vigencia: string
  ato: string
  faixas: FaixaIrrf[]
  deducaoPorDependente: number
  descontoSimplificado: number
  /** Lei 15.270/2025 — ausente nas vigências anteriores a 2026 */
  reducao?: ReducaoIrrf
}

export interface TabelaFgts {
  vigencia: string
  ato: string
  aliquota: number
  aliquotaAprendiz: number
}

const INSS: TabelaInss[] = [
  {
    vigencia: '2025-01',
    ato: 'Portaria Interministerial MPS/MF nº 6, de 10/01/2025',
    salarioMinimo: 1518.0,
    teto: 8157.41,
    faixas: [
      { ate: 1518.0, aliquota: 0.075 },
      { ate: 2793.88, aliquota: 0.09 },
      { ate: 4190.83, aliquota: 0.12 },
      { ate: 8157.41, aliquota: 0.14 },
    ],
    aliquotaContribuinteIndividual: 0.11,
  },
  {
    vigencia: '2026-01',
    ato: 'Portaria Interministerial MPS/MF nº 13, de 09/01/2026',
    salarioMinimo: 1621.0,
    teto: 8475.55,
    faixas: [
      { ate: 1621.0, aliquota: 0.075 },
      { ate: 2902.84, aliquota: 0.09 },
      { ate: 4354.27, aliquota: 0.12 },
      { ate: 8475.55, aliquota: 0.14 },
    ],
    aliquotaContribuinteIndividual: 0.11,
  },
]

const FAIXAS_IRRF_2025_05: FaixaIrrf[] = [
  { ate: 2428.8, aliquota: 0, deducao: 0 },
  { ate: 2826.65, aliquota: 0.075, deducao: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deducao: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deducao: 675.49 },
  { ate: Number.POSITIVE_INFINITY, aliquota: 0.275, deducao: 908.73 },
]

const IRRF: TabelaIrrf[] = [
  {
    vigencia: '2025-05',
    ato: 'Lei nº 15.191/2025 (tabela progressiva mensal a partir de maio/2025)',
    faixas: FAIXAS_IRRF_2025_05,
    deducaoPorDependente: 189.59,
    descontoSimplificado: 607.2,
  },
  {
    vigencia: '2026-01',
    ato: 'Lei nº 15.270/2025 (redução do imposto a partir de janeiro/2026)',
    faixas: FAIXAS_IRRF_2025_05,
    deducaoPorDependente: 189.59,
    descontoSimplificado: 607.2,
    reducao: { rendimentoIsento: 5000.0, reducaoMaxima: 312.89, rendimentoLimite: 7350.0, constante: 978.62, coeficiente: 0.133145 },
  },
]

const FGTS: TabelaFgts[] = [{ vigencia: '1990-05', ato: 'Lei nº 8.036/1990, art. 15', aliquota: 0.08, aliquotaAprendiz: 0.02 }]

export class ErroTabela extends Error {}

function vigente<T extends { vigencia: string }>(tabelas: T[], competencia: string, nome: string): T {
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new ErroTabela('Competência inválida: use AAAA-MM.')
  const candidata = [...tabelas].sort((a, b) => b.vigencia.localeCompare(a.vigencia)).find((t) => t.vigencia <= competencia)
  if (!candidata) throw new ErroTabela(`Não há tabela oficial de ${nome} cadastrada para ${competencia}. O cálculo não é feito com tabela de outro período.`)
  return candidata
}

/**
 * Última competência coberta com segurança: as tabelas de INSS mudam todo janeiro. Passado o
 * ano da tabela mais nova, o cálculo é recusado até alguém cadastrar a portaria do ano novo.
 */
export function ultimoAnoCoberto(): number {
  return Number(INSS.map((t) => t.vigencia).sort().at(-1)!.slice(0, 4))
}

function exigirAnoCoberto(competencia: string): void {
  const ano = Number(competencia.slice(0, 4))
  if (ano > ultimoAnoCoberto()) {
    throw new ErroTabela(`A tabela do INSS de ${ano} ainda não foi cadastrada (a mais recente é a de ${ultimoAnoCoberto()}). Ela muda todo janeiro, por portaria; atualize antes de calcular.`)
  }
}

export function tabelaInss(competencia: string): TabelaInss {
  const t = vigente(INSS, competencia, 'INSS')
  exigirAnoCoberto(competencia)
  return t
}

export function tabelaIrrf(competencia: string): TabelaIrrf {
  const t = vigente(IRRF, competencia, 'IRRF')
  exigirAnoCoberto(competencia)
  return t
}

export const tabelaFgts = (competencia: string): TabelaFgts => vigente(FGTS, competencia, 'FGTS')
