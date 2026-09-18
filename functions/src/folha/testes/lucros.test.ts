/**
 * IR sobre lucros distribuídos (Lei 9.250/1995, art. 6º-A, pela Lei 15.270/2025).
 * Os casos seguem o texto da lei: 10% sobre o TOTAL quando o mês passa de R$ 50 mil, recalculado
 * a cada pagamento, com a exceção dos lucros apurados até 2025.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { lucrosDoMes, retencaoDoNovoPagamento } from '../lucros'

describe('situação do mês', () => {
  it('até R$ 50.000,00 no mês não há retenção — o limite é "superior a"', () => {
    assert.equal(lucrosDoMes('2026-09', [{ valor: 50_000 }]).devido, 0)
    assert.equal(lucrosDoMes('2026-09', [{ valor: 30_000 }, { valor: 20_000 }]).devido, 0)
  })
  it('acima do limite, 10% sobre o total, não sobre o excedente', () => {
    assert.equal(lucrosDoMes('2026-09', [{ valor: 50_000.01 }]).devido, 5_000)
    assert.equal(lucrosDoMes('2026-09', [{ valor: 80_000 }]).devido, 8_000)
  })
  it('antes de janeiro de 2026 a regra não existia', () => {
    assert.equal(lucrosDoMes('2025-12', [{ valor: 200_000 }]).devido, 0)
    assert.equal(lucrosDoMes('2026-01', [{ valor: 200_000 }]).devido, 20_000)
  })
  it('lucro de resultado até 2025 aprovado até 31/12/2025 fica fora da base e do limite', () => {
    const m = lucrosDoMes('2026-09', [{ valor: 120_000, excecao2025: true }, { valor: 40_000 }])
    assert.equal(m.foraDaRegra, 120_000)
    assert.equal(m.sujeito, 40_000)
    assert.equal(m.devido, 0)
    assert.equal(m.folgaAteOLimite, 10_000)
  })
  it('mostra quando faltou reter', () => {
    const m = lucrosDoMes('2026-09', [{ valor: 30_000, irrfRetido: 0 }, { valor: 30_000, irrfRetido: 0 }])
    assert.equal(m.devido, 6_000)
    assert.equal(m.diferenca, 6_000)
  })
})

describe('retenção de um novo pagamento', () => {
  it('o pagamento que cruza o limite retém também sobre os anteriores do mês (§ 2º)', () => {
    const r = retencaoDoNovoPagamento('2026-09', [{ valor: 30_000, irrfRetido: 0 }], { valor: 30_000 })
    assert.equal(r.irrf, 6_000) // 10% de 60.000
    assert.equal(r.liquido, 24_000)
    assert.equal(r.mes.diferenca, 0)
  })
  it('já acima do limite, o pagamento seguinte retém só os seus 10%', () => {
    const r = retencaoDoNovoPagamento('2026-09', [{ valor: 60_000, irrfRetido: 6_000 }], { valor: 10_000 })
    assert.equal(r.irrf, 1_000)
    assert.equal(r.liquido, 9_000)
  })
  it('abaixo do limite não retém nada e informa a folga', () => {
    const r = retencaoDoNovoPagamento('2026-09', [{ valor: 20_000 }], { valor: 15_000 })
    assert.equal(r.irrf, 0)
    assert.equal(r.mes.folgaAteOLimite, 15_000)
  })
  it('pagamento na exceção de 2025 não retém, mesmo com o mês acima do limite', () => {
    const r = retencaoDoNovoPagamento('2026-09', [{ valor: 60_000, irrfRetido: 6_000 }], { valor: 100_000, excecao2025: true })
    assert.equal(r.irrf, 0)
    assert.equal(r.liquido, 100_000)
  })
  it('a retenção nunca passa do valor do próprio pagamento', () => {
    // 49.000 sem retenção + 2.000: o devido vira 5.100, mas só há 2.000 para reter neste pagamento
    const r = retencaoDoNovoPagamento('2026-09', [{ valor: 49_000, irrfRetido: 0 }], { valor: 2_000 })
    assert.equal(r.irrf, 2_000)
    assert.equal(r.liquido, 0)
    assert.equal(r.mes.diferenca, 3_100) // o que faltou fica visível para recolher
  })
  it('valor inválido é erro', () => {
    assert.throws(() => retencaoDoNovoPagamento('2026-09', [], { valor: 0 }))
  })
})
