/**
 * Cálculo da folha mensal: INSS, IRRF e FGTS de um trabalhador numa competência.
 *
 * Escopo desta versão: a folha mensal normal (salário, adicionais, horas extras, faltas,
 * descontos) de empregados e de sócios com pró-labore. Ficam de fora, e a tela avisa: 13º
 * salário, férias, rescisão e PLR — cada um tem incidência e tabela de IRRF próprias.
 *
 * Tudo em centavos inteiros por dentro, para a soma do holerite fechar sem resíduo de ponto
 * flutuante. Arredondamento: meio centavo para cima, como nos exemplos oficiais da Receita.
 */
import { tabelaFgts, tabelaInss, tabelaIrrf, type TabelaInss, type TabelaIrrf } from './tabelas'

export type TipoTrabalhador = 'empregado' | 'aprendiz' | 'prolabore'

/** Como uma rubrica entra nas bases. 'desconto' reduz o líquido; 'informativa' só aparece. */
export type TipoRubrica = 'provento' | 'desconto' | 'informativa'

export interface Lancamento {
  codigo: string
  descricao: string
  tipo: TipoRubrica
  valor: number
  /** Referência impressa no holerite: "30 dias", "10 h", "6%" */
  referencia?: string
  incideInss: boolean
  incideIrrf: boolean
  incideFgts: boolean
}

export interface EntradaCalculo {
  competencia: string
  tipo: TipoTrabalhador
  lancamentos: Lancamento[]
  dependentesIrrf: number
  /** Pensão alimentícia judicial descontada em folha: dedutível do IRRF */
  pensaoAlimenticia?: number
  /** INSS já recolhido por outra fonte pagadora no mês (múltiplos vínculos) */
  inssOutrasFontes?: { base: number; valor: number }
}

export interface DetalheIrrf {
  rendimentosTributaveis: number
  metodo: 'simplificado' | 'deducoes-legais'
  deducoesLegais: number
  descontoSimplificado: number
  base: number
  aliquota: number
  impostoPelaTabela: number
  reducao: number
  valor: number
}

export interface ResultadoCalculo {
  competencia: string
  totalProventos: number
  totalDescontos: number
  liquido: number
  baseInss: number
  inss: number
  /** Alíquota efetiva do INSS, para o holerite */
  aliquotaEfetivaInss: number
  irrf: DetalheIrrf
  baseFgts: number
  fgts: number
  /** Proventos e descontos digitados + INSS e IRRF calculados, na ordem do holerite */
  linhas: Lancamento[]
  tabelas: { inss: string; irrf: string }
  avisos: string[]
}

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100)
const reais = (c: number) => c / 100
/** Arredonda um valor em reais para o centavo, meio para cima. */
export const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

// ---------- INSS ----------

/**
 * Parcela (em centavos) × alíquota, TRUNCADA no centavo — em aritmética inteira, para 7,5% de
 * R$ 1.621,00 dar 121,57 por regra e não por acidente de ponto flutuante.
 */
const truncarContribuicao = (parcelaCentavos: number, aliquota: number): number => Math.floor((parcelaCentavos * Math.round(aliquota * 10000)) / 10000)

/**
 * INSS do empregado: progressivo — cada alíquota incide só sobre a parcela dentro da faixa.
 *
 * Regra do eSocial (vigente desde a competência 03/2020, é a que gera o S-5001 e a DCTFWeb): "os
 * cálculos em cada faixa devem ser realizados mediante o truncamento após a segunda casa
 * decimal". Exemplo oficial: R$ 2.000,00 na tabela de 2020 → 78,37 + 85,95 = 164,32.
 * O holerite tem que bater com o eSocial, então é truncamento por faixa — não arredondamento.
 */
export function inssProgressivo(base: number, tabela: TabelaInss): number {
  const limitada = centavos(Math.min(Math.max(base, 0), tabela.teto))
  let anterior = 0
  let total = 0
  for (const faixa of tabela.faixas) {
    if (limitada <= anterior) break
    const topo = centavos(faixa.ate)
    total += truncarContribuicao(Math.min(limitada, topo) - anterior, faixa.aliquota)
    anterior = topo
  }
  return reais(total)
}

/** INSS do contribuinte individual (pró-labore): alíquota única até o teto, também truncada. */
export const inssContribuinteIndividual = (base: number, tabela: TabelaInss): number =>
  reais(truncarContribuicao(centavos(Math.min(Math.max(base, 0), tabela.teto)), tabela.aliquotaContribuinteIndividual))

// ---------- IRRF ----------

export function impostoPelaTabela(base: number, tabela: TabelaIrrf): { imposto: number; aliquota: number } {
  if (base <= 0) return { imposto: 0, aliquota: 0 }
  const faixa = tabela.faixas.find((f) => base <= f.ate)!
  return { imposto: Math.max(0, arredondar(base * faixa.aliquota - faixa.deducao)), aliquota: faixa.aliquota }
}

/** Redução da Lei 15.270/2025: função dos RENDIMENTOS TRIBUTÁVEIS (brutos), não da base de cálculo. */
export function reducaoIrrf(rendimentosTributaveis: number, imposto: number, tabela: TabelaIrrf): number {
  const r = tabela.reducao
  if (!r || imposto <= 0) return 0
  if (rendimentosTributaveis <= r.rendimentoIsento) return Math.min(imposto, r.reducaoMaxima)
  if (rendimentosTributaveis <= r.rendimentoLimite) {
    return Math.min(imposto, Math.max(0, arredondar(r.constante - r.coeficiente * rendimentosTributaveis)))
  }
  return 0
}

export function calcularIrrf(rendimentosTributaveis: number, inss: number, dependentes: number, pensao: number, tabela: TabelaIrrf): DetalheIrrf {
  const deducoesLegais = arredondar(inss + dependentes * tabela.deducaoPorDependente + pensao)
  // A fonte pagadora aplica o que for mais favorável ao trabalhador: deduções legais ou o
  // desconto simplificado, que substitui todas elas.
  const usarSimplificado = tabela.descontoSimplificado > deducoesLegais
  const base = Math.max(0, arredondar(rendimentosTributaveis - (usarSimplificado ? tabela.descontoSimplificado : deducoesLegais)))
  const { imposto, aliquota } = impostoPelaTabela(base, tabela)
  const reducao = reducaoIrrf(rendimentosTributaveis, imposto, tabela)
  return {
    rendimentosTributaveis: arredondar(rendimentosTributaveis),
    metodo: usarSimplificado ? 'simplificado' : 'deducoes-legais',
    deducoesLegais,
    descontoSimplificado: tabela.descontoSimplificado,
    base,
    aliquota,
    impostoPelaTabela: imposto,
    reducao,
    valor: arredondar(imposto - reducao),
  }
}

// ---------- folha de um trabalhador ----------

export const CODIGO_INSS = 'INSS'
export const CODIGO_IRRF = 'IRRF'

export function calcularHolerite(e: EntradaCalculo): ResultadoCalculo {
  const tInss = tabelaInss(e.competencia)
  const tIrrf = tabelaIrrf(e.competencia)
  const tFgts = tabelaFgts(e.competencia)
  const avisos: string[] = []

  // Base = proventos que incidem − descontos que reduzem a base (faltas, atrasos).
  const base = (chave: 'incideInss' | 'incideIrrf' | 'incideFgts') =>
    reais(
      e.lancamentos.reduce((s, l) => {
        if (!l[chave]) return s
        if (l.tipo === 'provento') return s + centavos(l.valor)
        if (l.tipo === 'desconto') return s - centavos(l.valor)
        return s
      }, 0),
    )

  const baseInssBruta = Math.max(0, base('incideInss'))
  let baseInss = Math.min(baseInssBruta, tInss.teto)
  let inss: number
  if (e.tipo === 'prolabore') {
    inss = inssContribuinteIndividual(baseInssBruta, tInss)
  } else {
    inss = inssProgressivo(baseInssBruta, tInss)
  }
  if (e.inssOutrasFontes && e.inssOutrasFontes.base > 0) {
    // Múltiplos vínculos: o teto é um só. Desconta-se aqui apenas o que falta para o teto.
    const espaco = Math.max(0, tInss.teto - e.inssOutrasFontes.base)
    baseInss = Math.min(baseInssBruta, espaco)
    inss =
      e.tipo === 'prolabore'
        ? inssContribuinteIndividual(baseInss, tInss)
        : arredondar(Math.max(0, inssProgressivo(e.inssOutrasFontes.base + baseInss, tInss) - inssProgressivo(e.inssOutrasFontes.base, tInss)))
    avisos.push('INSS calculado considerando a remuneração já tributada em outra fonte pagadora.')
  }
  if (e.tipo !== 'prolabore' && baseInssBruta > 0 && baseInssBruta < tInss.salarioMinimo) {
    avisos.push(`Base do INSS abaixo do salário mínimo (R$ ${tInss.salarioMinimo.toFixed(2)}): confira se é mês incompleto ou jornada parcial.`)
  }

  const rendimentosTributaveis = Math.max(0, base('incideIrrf'))
  const irrf = calcularIrrf(rendimentosTributaveis, inss, Math.max(0, e.dependentesIrrf), Math.max(0, e.pensaoAlimenticia ?? 0), tIrrf)

  const baseFgts = e.tipo === 'prolabore' ? 0 : Math.max(0, base('incideFgts'))
  const fgts = arredondar(baseFgts * (e.tipo === 'aprendiz' ? tFgts.aliquotaAprendiz : tFgts.aliquota))

  const calculados: Lancamento[] = []
  if (inss > 0) {
    calculados.push({
      codigo: CODIGO_INSS,
      descricao: e.tipo === 'prolabore' ? 'INSS — contribuinte individual' : 'INSS',
      tipo: 'desconto',
      valor: inss,
      referencia: `${((inss / Math.max(baseInss, 0.01)) * 100).toFixed(2).replace('.', ',')}%`,
      incideInss: false,
      incideIrrf: false,
      incideFgts: false,
    })
  }
  if (irrf.valor > 0) {
    calculados.push({
      codigo: CODIGO_IRRF,
      descricao: 'IRRF',
      tipo: 'desconto',
      valor: irrf.valor,
      referencia: `${(irrf.aliquota * 100).toFixed(1).replace('.', ',')}%`,
      incideInss: false,
      incideIrrf: false,
      incideFgts: false,
    })
  }

  const linhas = [...e.lancamentos.filter((l) => l.valor !== 0), ...calculados]
  const soma = (tipo: TipoRubrica) => reais(linhas.filter((l) => l.tipo === tipo).reduce((s, l) => s + centavos(l.valor), 0))
  const totalProventos = soma('provento')
  const totalDescontos = soma('desconto')
  const liquido = arredondar(totalProventos - totalDescontos)
  if (liquido < 0) avisos.push('Os descontos superam os proventos: o líquido ficou negativo.')

  return {
    competencia: e.competencia,
    totalProventos,
    totalDescontos,
    liquido,
    baseInss: arredondar(baseInss),
    inss,
    aliquotaEfetivaInss: baseInss > 0 ? inss / baseInss : 0,
    irrf,
    baseFgts: arredondar(baseFgts),
    fgts,
    linhas,
    tabelas: { inss: tInss.ato, irrf: tIrrf.ato },
    avisos,
  }
}
