/**
 * Apuração do Simples Nacional — conta pura, sem banco, para poder ser testada.
 *
 * Base legal (LC 123/2006, art. 18, redação da LC 155/2016):
 *  § 1º   a alíquota nominal sai da receita bruta acumulada nos 12 meses ANTERIORES ao período;
 *  § 1º-A alíquota efetiva = (RBT12 × Aliq − PD) ÷ RBT12;
 *  § 1º-B ISS efetivo no máximo 5%, com a diferença indo para os tributos federais da faixa;
 *  § 2º   início de atividade: receita proporcionalizada aos meses de atividade;
 *  § 3º   a alíquota incide sobre a receita bruta do mês;
 *  § 5º-J/M e § 24: Fator R = folha (remunerações + pró-labore + CPP e FGTS recolhidos) dos 12
 *         meses anteriores ÷ receita dos 12 meses anteriores; ≥ 28% → Anexo III, senão Anexo V.
 * Proporcionalização no início de atividade conforme Resolução CGSN 140/2018, art. 22:
 *  no mês de início, RBT12 = receita do próprio mês × 12; nos 11 meses seguintes, média mensal
 *  dos meses anteriores × 12.
 *
 * Isto é CONFERÊNCIA. O valor devido é o do PGDAS-D da Receita — que ainda trata casos que esta
 * conta não cobre (ISS retido, receitas de exportação, substituição tributária, mais de um anexo
 * no mesmo mês, regime de caixa). Por isso a tela sempre compara com o DAS oficial.
 */
import { ANEXOS, FATOR_R_MINIMO, ISS_EFETIVO_MAXIMO, LIMITE_SIMPLES, SUBLIMITE_ICMS_ISS, type Anexo, type FaixaSimples, type Tributo } from './simplesTabelas'

export class ErroSimples extends Error {}

const centavos = (v: number) => Math.round(v * 100) / 100

/** 'AAAA-MM' deslocado em n meses (n pode ser negativo) */
export function somarMeses(periodo: string, n: number): string {
  const [a, m] = periodo.split('-').map(Number)
  const total = a * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Os 12 meses anteriores ao período, do mais antigo ao mais recente */
export const dozeMesesAnteriores = (periodo: string): string[] => Array.from({ length: 12 }, (_, i) => somarMeses(periodo, i - 12))

export interface Rbt12 {
  /** Soma simples do que foi auferido nos 12 meses anteriores */
  acumulado: number
  /** O que entra na tabela: igual ao acumulado, ou proporcionalizado no início de atividade */
  paraTabela: number
  proporcionalizado: boolean
  mesesDeAtividade: number
}

/**
 * RBT12 do período. `inicioAtividade` ('AAAA-MM') só importa se cair dentro dos 12 meses
 * anteriores (ou no próprio período): aí vale a proporcionalização.
 */
export function calcularRbt12(periodo: string, receitas: Record<string, number>, inicioAtividade?: string): Rbt12 {
  const meses = dozeMesesAnteriores(periodo)
  const emAtividade = inicioAtividade ? meses.filter((m) => m >= inicioAtividade) : meses
  const acumulado = centavos(emAtividade.reduce((s, m) => s + (receitas[m] ?? 0), 0))

  if (!inicioAtividade || inicioAtividade <= meses[0]) return { acumulado, paraTabela: acumulado, proporcionalizado: false, mesesDeAtividade: 12 }
  if (inicioAtividade > periodo) throw new ErroSimples('O período é anterior ao início de atividade.')

  if (inicioAtividade === periodo) {
    return { acumulado: 0, paraTabela: centavos((receitas[periodo] ?? 0) * 12), proporcionalizado: true, mesesDeAtividade: 0 }
  }
  const n = emAtividade.length
  return { acumulado, paraTabela: centavos((acumulado / n) * 12), proporcionalizado: true, mesesDeAtividade: n }
}

export function faixaDoAnexo(anexo: Anexo, rbt12: number): FaixaSimples {
  const faixas = ANEXOS[anexo].faixas
  const achada = faixas.find((f) => rbt12 <= f.ate)
  if (!achada) throw new ErroSimples('Receita bruta em 12 meses acima de R$ 4.800.000,00: fora do Simples Nacional.')
  return achada
}

/** Alíquota efetiva em percentual, sem arredondar (LC 123, art. 18, § 1º-A). Com RBT12 zero vale a nominal da 1ª faixa. */
export function aliquotaEfetiva(anexo: Anexo, rbt12: number): { faixa: FaixaSimples; efetiva: number } {
  const faixa = faixaDoAnexo(anexo, rbt12)
  if (rbt12 <= 0) return { faixa, efetiva: faixa.aliquota }
  return { faixa, efetiva: ((rbt12 * faixa.aliquota) / 100 - faixa.deduzir) / rbt12 * 100 }
}

/**
 * Percentual efetivo de cada tributo (art. 18, § 1º-B): alíquota efetiva × repartição; o ISS para
 * em 5% e o excedente é redistribuído aos tributos federais na proporção deles.
 */
export function repartir(faixa: FaixaSimples, efetiva: number): Partial<Record<Tributo, number>> {
  const partes = Object.entries(faixa.reparticao) as Array<[Tributo, number]>
  const bruto = Object.fromEntries(partes.map(([t, p]) => [t, (efetiva * p) / 100])) as Partial<Record<Tributo, number>>
  const iss = bruto.ISS ?? 0
  if (iss <= ISS_EFETIVO_MAXIMO) return bruto
  const excedente = iss - ISS_EFETIVO_MAXIMO
  const federais = partes.filter(([t]) => t !== 'ISS' && t !== 'ICMS')
  const somaFederais = federais.reduce((s, [, p]) => s + p, 0)
  const ajustado: Partial<Record<Tributo, number>> = { ...bruto, ISS: ISS_EFETIVO_MAXIMO }
  for (const [t, p] of federais) ajustado[t] = (bruto[t] ?? 0) + (excedente * p) / somaFederais
  return ajustado
}

export interface FatorR {
  folha12: number
  receita12: number
  /** Razão folha ÷ receita; null quando não há receita nos 12 meses (a lei não define a razão) */
  valor: number | null
  anexo: 'III' | 'V'
}

/**
 * Fator R do período. No mês de início de atividade usa folha e receita do próprio mês; nos
 * demais, os acumulados dos meses anteriores (Resolução CGSN 140/2018, art. 26).
 * Sem receita e sem folha não há razão a calcular: fica no Anexo V, o mais oneroso, por prudência.
 */
export function calcularFatorR(periodo: string, receitas: Record<string, number>, folhas: Record<string, number>, inicioAtividade?: string): FatorR {
  const meses = inicioAtividade === periodo ? [periodo] : dozeMesesAnteriores(periodo).filter((m) => !inicioAtividade || m >= inicioAtividade)
  const folha12 = centavos(meses.reduce((s, m) => s + (folhas[m] ?? 0), 0))
  const receita12 = centavos(meses.reduce((s, m) => s + (receitas[m] ?? 0), 0))
  if (receita12 <= 0) return { folha12, receita12, valor: null, anexo: folha12 > 0 ? 'III' : 'V' }
  const valor = folha12 / receita12
  return { folha12, receita12, valor, anexo: valor >= FATOR_R_MINIMO ? 'III' : 'V' }
}

export interface PedidoApuracao {
  periodo: string
  /** Anexo da atividade. Com `sujeitoAoFatorR`, é o Fator R que decide entre III e V. */
  anexo: Anexo
  sujeitoAoFatorR?: boolean
  inicioAtividade?: string
  /** Receita bruta por mês ('AAAA-MM'), incluindo o próprio período */
  receitas: Record<string, number>
  /** Folha com encargos por mês ('AAAA-MM') */
  folhas?: Record<string, number>
}

export type AlertaSimples = { nivel: 'info' | 'atencao' | 'critico'; texto: string }

export interface Apuracao {
  periodo: string
  receitaDoMes: number
  rbt12: Rbt12
  fatorR?: FatorR
  anexoAplicado: Anexo
  faixa: number
  aliquotaNominal: number
  parcelaADeduzir: number
  /** Percentual, arredondado só para exibir */
  aliquotaEfetiva: number
  dasEstimado: number
  tributos: Array<{ tributo: Tributo; percentual: number; valor: number }>
  /** Receita acumulada no ano-calendário até o período, inclusive */
  receitaNoAno: number
  alertas: AlertaSimples[]
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function apurarSimples(p: PedidoApuracao): Apuracao {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.periodo)) throw new ErroSimples('Período inválido.')
  const receitaDoMes = centavos(p.receitas[p.periodo] ?? 0)
  const rbt12 = calcularRbt12(p.periodo, p.receitas, p.inicioAtividade)
  const fatorR = p.sujeitoAoFatorR ? calcularFatorR(p.periodo, p.receitas, p.folhas ?? {}, p.inicioAtividade) : undefined
  const anexoAplicado: Anexo = fatorR ? fatorR.anexo : p.anexo

  const alertas: AlertaSimples[] = []
  const ano = p.periodo.slice(0, 4)
  const receitaNoAno = centavos(Object.entries(p.receitas).reduce((s, [m, v]) => (m.startsWith(ano) && m <= p.periodo ? s + v : s), 0))

  if (rbt12.paraTabela > LIMITE_SIMPLES) {
    throw new ErroSimples(`Receita bruta em 12 meses de ${brl(rbt12.paraTabela)}: acima do limite de ${brl(LIMITE_SIMPLES)} do Simples Nacional. A apuração deste período não é pelo Simples — fale com o responsável técnico.`)
  }

  const { faixa, efetiva } = aliquotaEfetiva(anexoAplicado, rbt12.paraTabela)
  const dasEstimado = centavos((receitaDoMes * efetiva) / 100)
  const partes = repartir(faixa, efetiva)
  const tributos = (Object.entries(partes) as Array<[Tributo, number]>).map(([tributo, percentual]) => ({
    tributo,
    percentual: Math.round(percentual * 10000) / 10000,
    valor: centavos((receitaDoMes * percentual) / 100),
  }))

  if (rbt12.proporcionalizado) {
    alertas.push({ nivel: 'info', texto: `Início de atividade: a receita de 12 meses foi proporcionalizada (${rbt12.mesesDeAtividade || 'nenhum'} ${rbt12.mesesDeAtividade === 1 ? 'mês' : 'meses'} anteriores de atividade), conforme a LC 123, art. 18, § 2º.` })
  }
  if (fatorR) {
    if (fatorR.valor === null) {
      alertas.push({ nivel: 'atencao', texto: 'Sem receita nos 12 meses anteriores, o Fator R não tem como ser calculado por aqui — confira o anexo no PGDAS-D.' })
    } else if (fatorR.anexo === 'V') {
      const faltam = centavos(FATOR_R_MINIMO * fatorR.receita12 - fatorR.folha12)
      alertas.push({ nivel: 'atencao', texto: `Fator R de ${(fatorR.valor * 100).toFixed(2)}%: abaixo de 28%, tributa no Anexo V. Faltaram ${brl(faltam)} de folha nos 12 meses para chegar ao Anexo III.` })
    } else if (fatorR.valor < FATOR_R_MINIMO + 0.02) {
      alertas.push({ nivel: 'atencao', texto: `Fator R de ${(fatorR.valor * 100).toFixed(2)}%: no Anexo III, mas com menos de 2 pontos de folga sobre os 28%.` })
    }
  }
  if (receitaNoAno > LIMITE_SIMPLES) {
    alertas.push({ nivel: 'critico', texto: `Receita no ano de ${brl(receitaNoAno)}: passou do limite de ${brl(LIMITE_SIMPLES)}. Há exclusão do Simples — os efeitos dependem de o excesso passar ou não de 20% (LC 123, art. 3º, §§ 9º e 9º-A).` })
  } else if (receitaNoAno > SUBLIMITE_ICMS_ISS) {
    alertas.push({ nivel: 'critico', texto: `Receita no ano de ${brl(receitaNoAno)}: passou do sublimite de ${brl(SUBLIMITE_ICMS_ISS)}. ICMS e ISS deixam de ser recolhidos no DAS (LC 123, art. 13-A).` })
  } else if (receitaNoAno > SUBLIMITE_ICMS_ISS * 0.8) {
    alertas.push({ nivel: 'atencao', texto: `Receita no ano de ${brl(receitaNoAno)}: já passou de 80% do sublimite de ${brl(SUBLIMITE_ICMS_ISS)}.` })
  }
  if (faixa.faixa === 6) {
    alertas.push({ nivel: 'atencao', texto: '6ª faixa: ICMS e ISS não entram no DAS e são recolhidos à parte.' })
  }

  return {
    periodo: p.periodo,
    receitaDoMes,
    rbt12,
    fatorR,
    anexoAplicado,
    faixa: faixa.faixa,
    aliquotaNominal: faixa.aliquota,
    parcelaADeduzir: faixa.deduzir,
    aliquotaEfetiva: Math.round(efetiva * 10000) / 10000,
    dasEstimado,
    tributos,
    receitaNoAno,
    alertas,
  }
}
