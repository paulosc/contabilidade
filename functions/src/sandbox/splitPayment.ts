/**
 * SANDBOX — simulador do split payment (recolhimento do IBS e da CBS na liquidação financeira).
 *
 * Conta pura, sem banco e sem rede. Não fala com a Plataforma Pública do Split Payment, não gera
 * obrigação e não grava nada: serve para entender, com números, o que a lei manda fazer.
 *
 * Base: LC 214/2025, arts. 31 a 36, com a redação da LC 227/2026 (texto do Planalto):
 *   art. 31, § 1º  dois procedimentos: padrão (art. 32) e simplificado (art. 33);
 *   art. 32, § 3º  padrão: antes de liberar o dinheiro ao fornecedor, o prestador de serviço de
 *                  pagamento consulta o sistema do CGIBS/RFB e segrega a diferença positiva entre
 *                  os débitos destacados no documento fiscal e as parcelas já extintas (art. 27);
 *   art. 32, § 4º  sem conseguir consultar: segrega o débito CHEIO informado, e o excedente volta
 *                  ao fornecedor em até 3 dias úteis;
 *   art. 33        simplificado: percentual preestabelecido sobre o valor da operação, sem relação
 *                  com o débito real; § 2º-A — originar o pagamento sem identificar IBS e CBS
 *                  implica opção pelo simplificado; § 7º, II — não dá crédito ao adquirente;
 *                  § 4º — o que sobrar volta em até 3 dias úteis da conclusão da apuração;
 *   art. 34, II    venda parcelada pelo fornecedor: segregação proporcional em todas as parcelas;
 *   art. 34, IV    o fornecedor continua responsável pelo saldo que o split não cobrir;
 *   art. 36        instrumento que não permite segregar: o adquirente contribuinte pode recolher.
 * Alíquotas de teste de 2026: IBS 0,1% (art. 343) e CBS 0,9% (art. 346).
 *
 * O que NÃO está aqui, porque não foi possível ler a fonte oficial: a API da Plataforma Pública
 * (Manual de Integração e Swagger, Ato Conjunto RFB/CGIBS nº 2/2026) e os percentuais do
 * procedimento simplificado, que o CGIBS e a RFB ainda vão fixar — por isso o percentual é entrada.
 */

export class ErroSplit extends Error {}

export const ALIQUOTAS_TESTE_2026 = { ibs: 0.1, cbs: 0.9 } as const

export type Procedimento = 'padrao' | 'simplificado'
export type Instrumento = 'pix' | 'boleto' | 'cartao' | 'ted' | 'dinheiro'

export interface EntradaSplit {
  /** Valor total da operação, como no documento fiscal */
  valorOperacao: number
  /** Débitos destacados no documento fiscal */
  debitoIbs: number
  debitoCbs: number
  /** Parcelas desses débitos já extintas por outra modalidade do art. 27 (crédito compensado, pagamento) */
  extintoIbs?: number
  extintoCbs?: number
  /** O que o fornecedor escolheu; pode ser trocado pela regra do art. 33, § 2º-A */
  procedimento: Procedimento
  /** A transação foi originada com os valores de IBS e CBS identificados? (art. 32, § 1º, II) */
  tributosInformados: boolean
  /** O prestador de serviço de pagamento conseguiu consultar o sistema do CGIBS/RFB? (art. 32, §§ 3º e 4º) */
  consultaDisponivel: boolean
  /** Percentuais do procedimento simplificado — ainda não fixados pelo CGIBS e pela RFB */
  percentualSimplificadoIbs?: number
  percentualSimplificadoCbs?: number
  /** Parcelas do pagamento quando é o fornecedor que parcela (art. 34, II) */
  parcelas?: number
  instrumento: Instrumento
  /** O adquirente é contribuinte do IBS e da CBS no regime regular? */
  adquirenteContribuinte: boolean
}

export interface ParcelaSplit {
  numero: number
  valor: number
  segregadoIbs: number
  segregadoCbs: number
  liquidoAoFornecedor: number
}

export interface ResultadoSplit {
  procedimentoAplicado: Procedimento | 'sem_split'
  /** Por que este procedimento (troca automática, instrumento sem suporte...) */
  motivos: string[]
  parcelas: ParcelaSplit[]
  totalSegregadoIbs: number
  totalSegregadoCbs: number
  totalLiquidoAoFornecedor: number
  /** Segregado acima do débito em aberto: volta ao fornecedor (art. 32, § 4º, II, "b"; art. 33, § 4º) */
  devolucaoAoFornecedor: { ibs: number; cbs: number; prazo: string } | null
  /** Débito que o split não cobriu: continua com o fornecedor (art. 34, IV) */
  saldoARecolherPeloFornecedor: { ibs: number; cbs: number }
  /** O adquirente contribuinte pode tomar crédito pelo que foi segregado? */
  creditoParaOAdquirente: 'sim' | 'nao' | 'nao_se_aplica'
  base: string[]
}

const centavos = (v: number) => Math.round(v * 100)
const reais = (c: number) => c / 100

/** Divide `total` (centavos) em `n` partes proporcionais aos pesos, sem perder nem criar centavo: o resto vai para a última. */
function repartir(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0)
  if (soma === 0) return pesos.map(() => 0)
  const partes = pesos.map((p) => Math.floor((total * p) / soma))
  partes[partes.length - 1] += total - partes.reduce((s, p) => s + p, 0)
  return partes
}

/** Débitos de IBS e CBS de uma operação pelas alíquotas informadas (em %). Em 2026 valem as de teste. */
export function debitosDaOperacao(valorOperacao: number, aliquotaIbs: number = ALIQUOTAS_TESTE_2026.ibs, aliquotaCbs: number = ALIQUOTAS_TESTE_2026.cbs): { ibs: number; cbs: number } {
  if (!(valorOperacao >= 0) || !(aliquotaIbs >= 0) || !(aliquotaCbs >= 0)) throw new ErroSplit('Valor e alíquotas não podem ser negativos.')
  return { ibs: reais(Math.round((centavos(valorOperacao) * aliquotaIbs) / 100)), cbs: reais(Math.round((centavos(valorOperacao) * aliquotaCbs) / 100)) }
}

export function simularSplit(e: EntradaSplit): ResultadoSplit {
  if (!(e.valorOperacao > 0)) throw new ErroSplit('Informe o valor da operação.')
  for (const [nome, v] of [['débito de IBS', e.debitoIbs], ['débito de CBS', e.debitoCbs], ['IBS já extinto', e.extintoIbs ?? 0], ['CBS já extinta', e.extintoCbs ?? 0]] as const) {
    if (!(v >= 0) || !Number.isFinite(v)) throw new ErroSplit(`Valor inválido: ${nome}.`)
  }
  if ((e.extintoIbs ?? 0) > e.debitoIbs || (e.extintoCbs ?? 0) > e.debitoCbs) throw new ErroSplit('A parcela já extinta não pode ser maior que o débito.')
  if (e.debitoIbs + e.debitoCbs > e.valorOperacao) throw new ErroSplit('Os tributos não podem ser maiores que o valor da operação.')
  const n = Math.floor(e.parcelas ?? 1)
  if (!(n >= 1 && n <= 60)) throw new ErroSplit('Número de parcelas entre 1 e 60.')

  const motivos: string[] = []
  const base: string[] = ['LC 214/2025, art. 31 — segregação e recolhimento na liquidação financeira']
  const valor = centavos(e.valorOperacao)
  const abertoIbs = centavos(e.debitoIbs) - centavos(e.extintoIbs ?? 0)
  const abertoCbs = centavos(e.debitoCbs) - centavos(e.extintoCbs ?? 0)
  const valoresDasParcelas = repartir(valor, Array<number>(n).fill(1))

  // dinheiro não passa por prestador de serviço de pagamento: não há quem segregue
  if (e.instrumento === 'dinheiro') {
    motivos.push('Pagamento em dinheiro não passa por prestador de serviço de pagamento: não há split payment.')
    if (e.adquirenteContribuinte) motivos.push('O adquirente contribuinte do regime regular pode optar por recolher ele mesmo o IBS e a CBS da operação (art. 36).')
    base.push('LC 214/2025, art. 36 — recolhimento pelo adquirente', 'LC 214/2025, art. 34, IV — o fornecedor responde pelo saldo')
    return {
      procedimentoAplicado: 'sem_split',
      motivos,
      parcelas: valoresDasParcelas.map((v, i) => ({ numero: i + 1, valor: reais(v), segregadoIbs: 0, segregadoCbs: 0, liquidoAoFornecedor: reais(v) })),
      totalSegregadoIbs: 0,
      totalSegregadoCbs: 0,
      totalLiquidoAoFornecedor: reais(valor),
      devolucaoAoFornecedor: null,
      saldoARecolherPeloFornecedor: { ibs: reais(abertoIbs), cbs: reais(abertoCbs) },
      creditoParaOAdquirente: 'nao_se_aplica',
      base,
    }
  }

  let procedimento: Procedimento = e.procedimento
  if (procedimento === 'padrao' && !e.tributosInformados) {
    procedimento = 'simplificado'
    motivos.push('A transação foi originada sem identificar os valores de IBS e CBS: isso implica opção pelo procedimento simplificado (art. 33, § 2º-A).')
  }

  let segregarIbs: number
  let segregarCbs: number
  let devolucao: ResultadoSplit['devolucaoAoFornecedor'] = null

  if (procedimento === 'padrao') {
    base.push('LC 214/2025, art. 32 — procedimento padrão')
    if (e.consultaDisponivel) {
      segregarIbs = abertoIbs
      segregarCbs = abertoCbs
      motivos.push('Consulta ao sistema do CGIBS/RFB feita: segrega-se só a diferença entre o débito destacado e o que já foi extinto (art. 32, § 3º).')
    } else {
      segregarIbs = centavos(e.debitoIbs)
      segregarCbs = centavos(e.debitoCbs)
      motivos.push('Sem conseguir consultar o sistema, o prestador de serviço de pagamento segrega o débito cheio informado (art. 32, § 4º, I).')
      const dIbs = segregarIbs - abertoIbs
      const dCbs = segregarCbs - abertoCbs
      if (dIbs > 0 || dCbs > 0) devolucao = { ibs: reais(dIbs), cbs: reais(dCbs), prazo: 'até 3 dias úteis (art. 32, § 4º, II, "b")' }
    }
  } else {
    base.push('LC 214/2025, art. 33 — procedimento simplificado')
    const pIbs = e.percentualSimplificadoIbs
    const pCbs = e.percentualSimplificadoCbs
    if (pIbs === undefined || pCbs === undefined || !(pIbs >= 0) || !(pCbs >= 0) || pIbs + pCbs > 100) {
      throw new ErroSplit('No procedimento simplificado, informe os percentuais de IBS e de CBS. Eles ainda serão fixados pelo CGIBS e pela RFB (art. 33, § 2º); aqui são hipótese sua.')
    }
    segregarIbs = Math.round((valor * pIbs) / 100)
    segregarCbs = Math.round((valor * pCbs) / 100)
    motivos.push('O valor segregado é um percentual do valor da operação e não guarda relação com o débito real (art. 33, § 2º, III).')
    const dIbs = Math.max(0, segregarIbs - abertoIbs)
    const dCbs = Math.max(0, segregarCbs - abertoCbs)
    if (dIbs > 0 || dCbs > 0) devolucao = { ibs: reais(dIbs), cbs: reais(dCbs), prazo: 'até 3 dias úteis da conclusão da apuração, se não for usado em outros débitos do período (art. 33, §§ 3º e 4º)' }
  }

  if (n > 1) {
    base.push('LC 214/2025, art. 34, II — parcelado pelo fornecedor: segregação proporcional em todas as parcelas')
    motivos.push('A antecipação de recebíveis não muda a obrigação de segregar em cada parcela (art. 34, III).')
  }
  const ibsPorParcela = repartir(segregarIbs, valoresDasParcelas)
  const cbsPorParcela = repartir(segregarCbs, valoresDasParcelas)
  const parcelas: ParcelaSplit[] = valoresDasParcelas.map((v, i) => ({ numero: i + 1, valor: reais(v), segregadoIbs: reais(ibsPorParcela[i]), segregadoCbs: reais(cbsPorParcela[i]), liquidoAoFornecedor: reais(v - ibsPorParcela[i] - cbsPorParcela[i]) }))

  const saldoIbs = Math.max(0, abertoIbs - segregarIbs)
  const saldoCbs = Math.max(0, abertoCbs - segregarCbs)
  if (saldoIbs > 0 || saldoCbs > 0) base.push('LC 214/2025, art. 34, IV — o fornecedor responde pelo saldo que o split não cobrir')

  return {
    procedimentoAplicado: procedimento,
    motivos,
    parcelas,
    totalSegregadoIbs: reais(segregarIbs),
    totalSegregadoCbs: reais(segregarCbs),
    totalLiquidoAoFornecedor: reais(valor - segregarIbs - segregarCbs),
    devolucaoAoFornecedor: devolucao,
    saldoARecolherPeloFornecedor: { ibs: reais(saldoIbs), cbs: reais(saldoCbs) },
    // no simplificado, o que foi segregado não vira crédito para quem comprou (art. 33, § 7º, II)
    creditoParaOAdquirente: !e.adquirenteContribuinte ? 'nao_se_aplica' : procedimento === 'simplificado' ? 'nao' : 'sim',
    base,
  }
}
