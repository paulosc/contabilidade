/**
 * Partidas dobradas, balancete e DRE — conta pura, sem banco.
 *
 * Todo lançamento tem partidas a débito e a crédito que somam o mesmo valor. As somas são feitas
 * em centavos inteiros: com ponto flutuante, 0,1 + 0,2 não fecha e o balancete "não bate" por um
 * centavo que nunca existiu.
 */
import { ancestrais, type Conta, type LinhaDre } from './planoDeContas'

export class ErroContabil extends Error {}

export interface Partida {
  conta: string
  /** Exatamente um dos dois, maior que zero */
  debito?: number
  credito?: number
}

export interface Lancamento {
  /** 'AAAA-MM-DD' */
  data: string
  historico: string
  partidas: Partida[]
}

const emCentavos = (v: number) => Math.round(v * 100)
const emReais = (c: number) => c / 100

/** Confere o lançamento contra o plano de contas e devolve o valor total (soma dos débitos). */
export function validarLancamento(l: Lancamento, contas: Map<string, Conta>): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data) || Number.isNaN(Date.parse(l.data))) throw new ErroContabil('Data do lançamento inválida.')
  if (!l.historico?.trim()) throw new ErroContabil('Todo lançamento precisa de histórico.')
  if (!Array.isArray(l.partidas) || l.partidas.length < 2) throw new ErroContabil('Um lançamento precisa de pelo menos uma partida a débito e uma a crédito.')
  let debitos = 0
  let creditos = 0
  for (const p of l.partidas) {
    const conta = contas.get(p.conta)
    if (!conta) throw new ErroContabil(`Conta ${p.conta} não existe no plano de contas.`)
    if (!conta.analitica) throw new ErroContabil(`${conta.codigo} ${conta.nome} é conta sintética: lance numa das contas abaixo dela.`)
    const d = p.debito ?? 0
    const c = p.credito ?? 0
    if ((d > 0) === (c > 0)) throw new ErroContabil('Cada partida é a débito OU a crédito, com valor maior que zero.')
    if (d < 0 || c < 0 || !Number.isFinite(d + c)) throw new ErroContabil('Valor de partida inválido.')
    debitos += emCentavos(d)
    creditos += emCentavos(c)
  }
  if (debitos === 0) throw new ErroContabil('O lançamento não tem valor.')
  if (debitos !== creditos) throw new ErroContabil(`Débitos (${emReais(debitos).toFixed(2)}) e créditos (${emReais(creditos).toFixed(2)}) não fecham.`)
  return emReais(debitos)
}

/**
 * Lançamento de uma movimentação do extrato: o banco de um lado, a conta escolhida do outro.
 * Dinheiro que entrou debita o banco; dinheiro que saiu credita.
 */
export function lancamentoDoExtrato(t: { data: string; valor: number; memo: string }, contaBanco: string, contrapartida: string, historico?: string): Lancamento {
  if (!t.valor) throw new ErroContabil('Movimentação sem valor.')
  const v = Math.abs(t.valor)
  const partidas: Partida[] = t.valor > 0 ? [{ conta: contaBanco, debito: v }, { conta: contrapartida, credito: v }] : [{ conta: contrapartida, debito: v }, { conta: contaBanco, credito: v }]
  return { data: t.data, historico: (historico?.trim() || t.memo || 'Movimentação bancária').slice(0, 200), partidas }
}

export interface LinhaBalancete {
  codigo: string
  nome: string
  analitica: boolean
  nivel: number
  natureza: Conta['natureza']
  /** Saldos na natureza da conta: positivo é o lado normal dela */
  saldoAnterior: number
  debitos: number
  creditos: number
  saldoFinal: number
}

export interface Balancete {
  linhas: LinhaBalancete[]
  totalDebitos: number
  totalCreditos: number
  /** Ativo = Passivo + PL + resultado do exercício ainda não transferido */
  fechamento: { ativo: number; passivoEPl: number; resultado: number; confere: boolean }
}

/**
 * Balancete de verificação do período [de, ate]. `lancamentos` deve trazer tudo até `ate`: o que
 * é anterior a `de` compõe o saldo anterior. Contas sem saldo e sem movimento ficam de fora.
 */
export function balancete(contas: Conta[], lancamentos: Lancamento[], de: string, ate: string): Balancete {
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]))
  // tudo em centavos, com sinal de débito positivo
  const acumulado = new Map<string, { anterior: number; deb: number; cred: number }>()
  const celula = (codigo: string) => {
    let c = acumulado.get(codigo)
    if (!c) acumulado.set(codigo, (c = { anterior: 0, deb: 0, cred: 0 }))
    return c
  }
  for (const l of lancamentos) {
    if (l.data > ate) continue
    for (const p of l.partidas) {
      const d = emCentavos(p.debito ?? 0)
      const c = emCentavos(p.credito ?? 0)
      for (const codigo of [p.conta, ...ancestrais(p.conta)]) {
        const cel = celula(codigo)
        if (l.data < de) cel.anterior += d - c
        else {
          cel.deb += d
          cel.cred += c
        }
      }
    }
  }

  const linhas: LinhaBalancete[] = []
  let totalDebitos = 0
  let totalCreditos = 0
  for (const [codigo, v] of acumulado) {
    const conta = porCodigo.get(codigo)
    if (!conta) continue
    const sinal = conta.natureza === 'devedora' ? 1 : -1
    const final = v.anterior + v.deb - v.cred
    if (!v.anterior && !v.deb && !v.cred) continue
    linhas.push({ codigo, nome: conta.nome, analitica: conta.analitica, nivel: codigo.split('.').length, natureza: conta.natureza, saldoAnterior: emReais(sinal * v.anterior || 0), debitos: emReais(v.deb), creditos: emReais(v.cred), saldoFinal: emReais(sinal * final || 0) })
    if (conta.analitica) {
      totalDebitos += v.deb
      totalCreditos += v.cred
    }
  }
  linhas.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))

  // saldo final de cada raiz, com sinal de débito positivo
  const raiz = (codigo: string) => {
    const v = acumulado.get(codigo)
    return v ? v.anterior + v.deb - v.cred : 0
  }
  const ativo = raiz('1')
  const passivoEPl = 0 - raiz('2')
  const resultado = 0 - (raiz('3') + raiz('4'))
  return { linhas, totalDebitos: emReais(totalDebitos), totalCreditos: emReais(totalCreditos), fechamento: { ativo: emReais(ativo), passivoEPl: emReais(passivoEPl), resultado: emReais(resultado), confere: ativo === passivoEPl + resultado } }
}

export interface Dre {
  de: string
  ate: string
  receitaBruta: number
  deducoes: number
  receitaLiquida: number
  custos: number
  lucroBruto: number
  despesas: { pessoal: number; administrativas: number; financeiras: number; tributarias: number; total: number }
  outrasReceitas: number
  resultado: number
  /** Cada conta que entrou, para abrir o detalhe de uma linha */
  contas: Array<{ codigo: string; nome: string; linha: LinhaDre; valor: number }>
}

/** Demonstração do resultado do período [de, ate], só com o movimento do período. */
export function dre(contas: Conta[], lancamentos: Lancamento[], de: string, ate: string): Dre {
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]))
  const mov = new Map<string, number>() // centavos, crédito positivo (receita aumenta o resultado)
  for (const l of lancamentos) {
    if (l.data < de || l.data > ate) continue
    for (const p of l.partidas) {
      if (!porCodigo.get(p.conta)?.dre) continue
      mov.set(p.conta, (mov.get(p.conta) ?? 0) + emCentavos(p.credito ?? 0) - emCentavos(p.debito ?? 0))
    }
  }
  const soma: Record<LinhaDre, number> = { receita_bruta: 0, deducoes: 0, custos: 0, despesas_pessoal: 0, despesas_administrativas: 0, despesas_financeiras: 0, despesas_tributarias: 0, outras_receitas: 0 }
  const detalhe: Dre['contas'] = []
  for (const [codigo, v] of mov) {
    const conta = porCodigo.get(codigo)!
    soma[conta.dre!] += v
    if (v) detalhe.push({ codigo, nome: conta.nome, linha: conta.dre!, valor: emReais(Math.abs(v)) })
  }
  detalhe.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))

  // receitas ficam positivas; deduções, custos e despesas viram valores positivos a subtrair
  const receitaBruta = soma.receita_bruta
  // `0 - x` e não `-x`: negar zero dá -0, que a tela mostraria como "-R$ 0,00"
  const deducoes = 0 - soma.deducoes
  const custos = 0 - soma.custos
  const pessoal = 0 - soma.despesas_pessoal
  const administrativas = 0 - soma.despesas_administrativas
  const financeiras = 0 - soma.despesas_financeiras
  const tributarias = 0 - soma.despesas_tributarias
  const totalDespesas = pessoal + administrativas + financeiras + tributarias
  const receitaLiquida = receitaBruta - deducoes
  const lucroBruto = receitaLiquida - custos
  const resultado = lucroBruto - totalDespesas + soma.outras_receitas
  return {
    de,
    ate,
    receitaBruta: emReais(receitaBruta),
    deducoes: emReais(deducoes),
    receitaLiquida: emReais(receitaLiquida),
    custos: emReais(custos),
    lucroBruto: emReais(lucroBruto),
    despesas: { pessoal: emReais(pessoal), administrativas: emReais(administrativas), financeiras: emReais(financeiras), tributarias: emReais(tributarias), total: emReais(totalDespesas) },
    outrasReceitas: emReais(soma.outras_receitas),
    resultado: emReais(resultado),
    contas: detalhe,
  }
}

export interface BalancoPatrimonial {
  ate: string
  ativo: LinhaBalancete[]
  passivo: LinhaBalancete[]
  patrimonioLiquido: LinhaBalancete[]
  /** Resultado acumulado que ainda não foi transferido para o patrimônio líquido por lançamento de encerramento */
  resultadoAcumulado: number
  totalAtivo: number
  totalPassivo: number
  totalPatrimonioLiquido: number
  confere: boolean
}

/** Balanço patrimonial na data: saldos acumulados de tudo o que foi lançado até ela. */
export function balancoPatrimonial(contas: Conta[], lancamentos: Lancamento[], ate: string): BalancoPatrimonial {
  const b = balancete(contas, lancamentos, '0001-01-01', ate)
  const comSaldo = b.linhas.filter((l) => l.saldoFinal !== 0)
  const ativo = comSaldo.filter((l) => l.codigo === '1' || l.codigo.startsWith('1.'))
  const patrimonioLiquido = comSaldo.filter((l) => l.codigo === '2.3' || l.codigo.startsWith('2.3.'))
  const passivo = comSaldo.filter((l) => (l.codigo.startsWith('2.') || l.codigo === '2') && l.codigo !== '2' && !patrimonioLiquido.includes(l))
  const saldo = (codigo: string) => emCentavos(b.linhas.find((l) => l.codigo === codigo)?.saldoFinal ?? 0)
  const totalPl = saldo('2.3') + emCentavos(b.fechamento.resultado)
  const totalPassivo = saldo('2') - saldo('2.3')
  return {
    ate,
    ativo,
    passivo,
    patrimonioLiquido,
    resultadoAcumulado: b.fechamento.resultado,
    totalAtivo: b.fechamento.ativo,
    totalPassivo: emReais(totalPassivo),
    totalPatrimonioLiquido: emReais(totalPl),
    confere: emCentavos(b.fechamento.ativo) === totalPassivo + totalPl,
  }
}

export interface MovimentoDoRazao {
  data: string
  historico: string
  debito: number
  credito: number
  /** Saldo depois do movimento, na natureza da conta */
  saldo: number
  /** As outras contas do lançamento */
  contrapartidas: string[]
}

export interface RazaoDaConta {
  conta: string
  saldoAnterior: number
  movimentos: MovimentoDoRazao[]
  totalDebitos: number
  totalCreditos: number
  saldoFinal: number
}

/** Razão de uma conta analítica no período, com saldo corrente. */
export function razaoDaConta(conta: Conta, lancamentos: Lancamento[], de: string, ate: string): RazaoDaConta {
  const sinal = conta.natureza === 'devedora' ? 1 : -1
  let corrente = 0 // centavos, débito positivo
  let totalDebitos = 0
  let totalCreditos = 0
  const movimentos: MovimentoDoRazao[] = []
  const ordenados = [...lancamentos].filter((l) => l.data <= ate).sort((a, b) => a.data.localeCompare(b.data))
  let saldoAnterior = 0
  for (const l of ordenados) {
    const d = l.partidas.filter((p) => p.conta === conta.codigo).reduce((s, p) => s + emCentavos(p.debito ?? 0), 0)
    const c = l.partidas.filter((p) => p.conta === conta.codigo).reduce((s, p) => s + emCentavos(p.credito ?? 0), 0)
    if (!d && !c) continue
    corrente += d - c
    if (l.data < de) {
      saldoAnterior = corrente
      continue
    }
    totalDebitos += d
    totalCreditos += c
    movimentos.push({ data: l.data, historico: l.historico, debito: emReais(d), credito: emReais(c), saldo: emReais(sinal * corrente || 0), contrapartidas: [...new Set(l.partidas.map((p) => p.conta).filter((x) => x !== conta.codigo))] })
  }
  return { conta: conta.codigo, saldoAnterior: emReais(sinal * saldoAnterior || 0), movimentos, totalDebitos: emReais(totalDebitos), totalCreditos: emReais(totalCreditos), saldoFinal: emReais(sinal * corrente || 0) }
}

/** Texto do extrato reduzido ao que identifica o favorecido: minúsculas, sem acento, sem números soltos. */
export function normalizarMemo(memo: string): string {
  return memo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface RegraDeConciliacao {
  termo: string
  conta: string
}

/** Sugere a conta pela regra cujo termo aparece no memo; entre várias, vale a de termo mais longo (mais específica). */
export function sugerirConta(memo: string, regras: RegraDeConciliacao[]): string | undefined {
  const m = normalizarMemo(memo)
  if (!m) return undefined
  return regras.filter((r) => r.termo && m.includes(r.termo)).sort((a, b) => b.termo.length - a.termo.length)[0]?.conta
}
