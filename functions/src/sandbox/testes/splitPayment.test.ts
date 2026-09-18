/**
 * Sandbox do split payment: cada caso reproduz uma regra dos arts. 31 a 36 da LC 214/2025
 * (redação da LC 227/2026).
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroSplit, debitosDaOperacao, simularSplit, type EntradaSplit } from '../splitPayment'

const venda: EntradaSplit = {
  valorOperacao: 10_000,
  debitoIbs: 10,
  debitoCbs: 90,
  procedimento: 'padrao',
  tributosInformados: true,
  consultaDisponivel: true,
  instrumento: 'pix',
  adquirenteContribuinte: true,
}

describe('débitos pelas alíquotas de teste de 2026 (arts. 343 e 346)', () => {
  it('IBS 0,1% e CBS 0,9%', () => {
    assert.deepEqual(debitosDaOperacao(10_000), { ibs: 10, cbs: 90 })
    assert.deepEqual(debitosDaOperacao(1_234.56), { ibs: 1.23, cbs: 11.11 })
  })
  it('aceita outras alíquotas', () => {
    assert.deepEqual(debitosDaOperacao(1_000, 17.7, 8.8), { ibs: 177, cbs: 88 })
  })
})

describe('procedimento padrão (art. 32)', () => {
  it('com consulta: segrega o débito em aberto e o resto vai ao fornecedor', () => {
    const r = simularSplit(venda)
    assert.equal(r.procedimentoAplicado, 'padrao')
    assert.equal(r.totalSegregadoIbs, 10)
    assert.equal(r.totalSegregadoCbs, 90)
    assert.equal(r.totalLiquidoAoFornecedor, 9_900)
    assert.equal(r.devolucaoAoFornecedor, null)
    assert.deepEqual(r.saldoARecolherPeloFornecedor, { ibs: 0, cbs: 0 })
    assert.equal(r.creditoParaOAdquirente, 'sim')
  })
  it('com consulta e parte já extinta por crédito: segrega só a diferença positiva (§ 3º)', () => {
    const r = simularSplit({ ...venda, extintoIbs: 4, extintoCbs: 30 })
    assert.equal(r.totalSegregadoIbs, 6)
    assert.equal(r.totalSegregadoCbs, 60)
    assert.equal(r.totalLiquidoAoFornecedor, 9_934)
  })
  it('sem consulta: segrega o débito cheio e o excedente volta em até 3 dias úteis (§ 4º)', () => {
    const r = simularSplit({ ...venda, consultaDisponivel: false, extintoIbs: 4, extintoCbs: 30 })
    assert.equal(r.totalSegregadoIbs, 10)
    assert.equal(r.totalSegregadoCbs, 90)
    assert.equal(r.devolucaoAoFornecedor?.ibs, 4)
    assert.equal(r.devolucaoAoFornecedor?.cbs, 30)
    assert.match(r.devolucaoAoFornecedor!.prazo, /3 dias úteis/)
  })
  it('originar o pagamento sem identificar os tributos vira simplificado (art. 33, § 2º-A)', () => {
    const r = simularSplit({ ...venda, tributosInformados: false, percentualSimplificadoIbs: 0.05, percentualSimplificadoCbs: 0.5 })
    assert.equal(r.procedimentoAplicado, 'simplificado')
    assert.ok(r.motivos.some((m) => m.includes('§ 2º-A')))
  })
})

describe('procedimento simplificado (art. 33)', () => {
  const simples: EntradaSplit = { ...venda, procedimento: 'simplificado', percentualSimplificadoIbs: 0.05, percentualSimplificadoCbs: 0.5 }

  it('percentual sobre o valor da operação; o que faltar fica com o fornecedor (art. 34, IV)', () => {
    const r = simularSplit(simples)
    assert.equal(r.totalSegregadoIbs, 5)
    assert.equal(r.totalSegregadoCbs, 50)
    assert.deepEqual(r.saldoARecolherPeloFornecedor, { ibs: 5, cbs: 40 })
    assert.equal(r.devolucaoAoFornecedor, null)
  })
  it('percentual acima do débito: o excedente volta depois da apuração (§ 4º)', () => {
    const r = simularSplit({ ...simples, percentualSimplificadoIbs: 0.2, percentualSimplificadoCbs: 1.5 })
    assert.equal(r.totalSegregadoIbs, 20)
    assert.equal(r.totalSegregadoCbs, 150)
    assert.equal(r.devolucaoAoFornecedor?.ibs, 10)
    assert.equal(r.devolucaoAoFornecedor?.cbs, 60)
    assert.match(r.devolucaoAoFornecedor!.prazo, /apuração/)
  })
  it('não gera crédito para o adquirente contribuinte (§ 7º, II)', () => {
    assert.equal(simularSplit(simples).creditoParaOAdquirente, 'nao')
    assert.equal(simularSplit({ ...simples, adquirenteContribuinte: false }).creditoParaOAdquirente, 'nao_se_aplica')
  })
  it('sem percentuais não simula: eles ainda não foram fixados', () => {
    assert.throws(() => simularSplit({ ...venda, procedimento: 'simplificado' }), /percentuais/)
  })
})

describe('parcelado pelo fornecedor (art. 34, II)', () => {
  it('segrega proporcionalmente em todas as parcelas, sem perder centavo', () => {
    const r = simularSplit({ ...venda, valorOperacao: 1_000, debitoIbs: 1, debitoCbs: 9, parcelas: 3 })
    assert.deepEqual(r.parcelas.map((p) => p.valor), [333.33, 333.33, 333.34])
    assert.deepEqual(r.parcelas.map((p) => p.segregadoCbs), [2.99, 2.99, 3.02])
    assert.equal(Math.round(r.parcelas.reduce((s, p) => s + p.segregadoCbs, 0) * 100) / 100, 9)
    assert.equal(Math.round(r.parcelas.reduce((s, p) => s + p.segregadoIbs, 0) * 100) / 100, 1)
    assert.equal(Math.round(r.parcelas.reduce((s, p) => s + p.liquidoAoFornecedor, 0) * 100) / 100, 990)
    for (const p of r.parcelas) assert.equal(Math.round((p.segregadoIbs + p.segregadoCbs + p.liquidoAoFornecedor) * 100) / 100, p.valor)
  })
})

describe('instrumento sem segregação', () => {
  it('dinheiro: não há split; o débito fica com o fornecedor e o adquirente contribuinte pode recolher (art. 36)', () => {
    const r = simularSplit({ ...venda, instrumento: 'dinheiro' })
    assert.equal(r.procedimentoAplicado, 'sem_split')
    assert.equal(r.totalSegregadoCbs, 0)
    assert.equal(r.totalLiquidoAoFornecedor, 10_000)
    assert.deepEqual(r.saldoARecolherPeloFornecedor, { ibs: 10, cbs: 90 })
    assert.ok(r.motivos.some((m) => m.includes('art. 36')))
  })
})

describe('entradas inválidas', () => {
  it('recusa valores negativos, extinto maior que o débito e tributo maior que a operação', () => {
    assert.throws(() => simularSplit({ ...venda, valorOperacao: 0 }), ErroSplit)
    assert.throws(() => simularSplit({ ...venda, extintoCbs: 91 }), ErroSplit)
    assert.throws(() => simularSplit({ ...venda, debitoCbs: 20_000 }), ErroSplit)
    assert.throws(() => simularSplit({ ...venda, parcelas: 0 }), ErroSplit)
  })
})
