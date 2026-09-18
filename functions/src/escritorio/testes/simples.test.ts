/**
 * Apuração do Simples Nacional. As tabelas são conferidas contra propriedades que a própria lei
 * garante (repartição soma 100%; a alíquota efetiva é contínua na virada de faixa) e as contas,
 * contra exemplos feitos à mão a partir da fórmula do art. 18, § 1º-A.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroSimples, aliquotaEfetiva, apurarSimples, calcularFatorR, calcularRbt12, dozeMesesAnteriores, repartir, somarMeses } from '../simples'
import { ANEXOS, type Anexo } from '../simplesTabelas'

const perto = (a: number, b: number, tolerancia = 1e-6) => assert.ok(Math.abs(a - b) <= tolerancia, `${a} ≠ ${b}`)
const mesmoValor = (meses: string[], v: number) => Object.fromEntries(meses.map((m) => [m, v]))

describe('tabelas dos anexos', () => {
  for (const anexo of Object.keys(ANEXOS) as Anexo[]) {
    it(`Anexo ${anexo}: repartição de cada faixa soma 100%`, () => {
      for (const f of ANEXOS[anexo].faixas) perto(Object.values(f.reparticao).reduce((s, p) => s + p, 0), 100, 1e-9)
    })

    // A parcela a deduzir existe para a alíquota efetiva não dar salto na virada de faixa.
    // Vale da 1ª à 5ª; a 6ª faixa muda a partilha (ICMS/ISS saem do DAS) e a lei não a fez contínua.
    it(`Anexo ${anexo}: alíquota efetiva contínua entre as faixas 1 a 5`, () => {
      const faixas = ANEXOS[anexo].faixas
      for (let i = 0; i < 4; i++) {
        const limite = faixas[i].ate
        const antes = (limite * faixas[i].aliquota) / 100 - faixas[i].deduzir
        const depois = (limite * faixas[i + 1].aliquota) / 100 - faixas[i + 1].deduzir
        perto(antes, depois, 0.01)
      }
    })
  }
})

describe('meses', () => {
  it('soma e subtrai meses atravessando o ano', () => {
    assert.equal(somarMeses('2026-01', -1), '2025-12')
    assert.equal(somarMeses('2025-12', 1), '2026-01')
    assert.equal(somarMeses('2026-08', -12), '2025-08')
  })
  it('12 meses anteriores não incluem o próprio período', () => {
    const m = dozeMesesAnteriores('2026-08')
    assert.equal(m.length, 12)
    assert.equal(m[0], '2025-08')
    assert.equal(m[11], '2026-07')
  })
})

describe('alíquota efetiva', () => {
  it('Anexo III, RBT12 de 240 mil: (240.000 × 11,2% − 9.360) ÷ 240.000 = 7,30%', () => {
    const { faixa, efetiva } = aliquotaEfetiva('III', 240_000)
    assert.equal(faixa.faixa, 2)
    perto(efetiva, 7.3)
  })
  it('Anexo V, RBT12 de 500 mil: (500.000 × 19,5% − 9.900) ÷ 500.000 = 17,52%', () => {
    perto(aliquotaEfetiva('V', 500_000).efetiva, 17.52)
  })
  it('Anexo I, RBT12 de 1,2 milhão: (1.200.000 × 10,7% − 22.500) ÷ 1.200.000 = 8,825%', () => {
    perto(aliquotaEfetiva('I', 1_200_000).efetiva, 8.825)
  })
  it('limite da faixa pertence à faixa de baixo', () => {
    assert.equal(aliquotaEfetiva('III', 180_000).faixa.faixa, 1)
    assert.equal(aliquotaEfetiva('III', 180_000.01).faixa.faixa, 2)
  })
  it('sem receita anterior vale a alíquota nominal da 1ª faixa', () => {
    perto(aliquotaEfetiva('III', 0).efetiva, 6)
  })
  it('acima de 4,8 milhões não há faixa', () => {
    assert.throws(() => aliquotaEfetiva('III', 4_800_000.01), ErroSimples)
  })
})

describe('repartição e teto de 5% do ISS', () => {
  it('sem estourar o teto, é alíquota efetiva × percentual', () => {
    const { faixa, efetiva } = aliquotaEfetiva('III', 240_000)
    const r = repartir(faixa, efetiva)
    perto(r.ISS!, 7.3 * 0.32)
    perto(Object.values(r).reduce((s, v) => s + v, 0), 7.3)
  })
  it('5ª faixa do Anexo III com efetiva acima de 14,92537%: ISS para em 5% e o total não muda', () => {
    const { faixa, efetiva } = aliquotaEfetiva('III', 3_000_000) // (3.000.000 × 21% − 125.640) ÷ 3.000.000 = 16,812%
    perto(efetiva, 16.812)
    const r = repartir(faixa, efetiva)
    perto(r.ISS!, 5)
    perto(Object.values(r).reduce((s, v) => s + v, 0), 16.812)
    // o excedente vai aos federais na proporção deles: a CPP (43,4 de 66,5) leva a maior parte
    const excedente = 16.812 * 0.335 - 5
    perto(r.CPP!, 16.812 * 0.434 + (excedente * 43.4) / 66.5)
  })
})

describe('RBT12', () => {
  it('soma os 12 meses anteriores e ignora o mês da apuração', () => {
    const receitas = { ...mesmoValor(dozeMesesAnteriores('2026-08'), 10_000), '2026-08': 99_999, '2025-07': 50_000 }
    const r = calcularRbt12('2026-08', receitas)
    assert.equal(r.acumulado, 120_000)
    assert.equal(r.paraTabela, 120_000)
    assert.equal(r.proporcionalizado, false)
  })
  it('mês de início de atividade: receita do próprio mês × 12', () => {
    const r = calcularRbt12('2026-03', { '2026-03': 8_000 }, '2026-03')
    assert.equal(r.paraTabela, 96_000)
    assert.equal(r.proporcionalizado, true)
  })
  it('4º mês de atividade: média dos 3 anteriores × 12', () => {
    const r = calcularRbt12('2026-06', { '2026-03': 8_000, '2026-04': 10_000, '2026-05': 12_000, '2026-06': 50_000 }, '2026-03')
    assert.equal(r.acumulado, 30_000)
    assert.equal(r.paraTabela, 120_000)
    assert.equal(r.mesesDeAtividade, 3)
  })
  it('depois de 12 meses de atividade não proporcionaliza mais', () => {
    const r = calcularRbt12('2026-08', mesmoValor(dozeMesesAnteriores('2026-08'), 5_000), '2025-08')
    assert.equal(r.proporcionalizado, false)
    assert.equal(r.paraTabela, 60_000)
  })
  it('período anterior ao início de atividade é erro', () => {
    assert.throws(() => calcularRbt12('2026-01', {}, '2026-03'), ErroSimples)
  })
})

describe('Fator R', () => {
  const meses = dozeMesesAnteriores('2026-08')
  it('exatamente 28% já é Anexo III', () => {
    const f = calcularFatorR('2026-08', mesmoValor(meses, 10_000), mesmoValor(meses, 2_800))
    perto(f.valor!, 0.28)
    assert.equal(f.anexo, 'III')
  })
  it('27,99% fica no Anexo V', () => {
    assert.equal(calcularFatorR('2026-08', mesmoValor(meses, 10_000), mesmoValor(meses, 2_799)).anexo, 'V')
  })
  it('sem receita nos 12 meses não há razão a calcular', () => {
    assert.equal(calcularFatorR('2026-08', {}, {}).valor, null)
  })
  it('no mês de início usa folha e receita do próprio mês', () => {
    const f = calcularFatorR('2026-03', { '2026-03': 10_000 }, { '2026-03': 3_000 }, '2026-03')
    perto(f.valor!, 0.3)
    assert.equal(f.anexo, 'III')
  })
})

describe('apuração completa', () => {
  const meses = dozeMesesAnteriores('2026-08')

  it('prestador no Anexo III: RBT12 240 mil, receita de 20 mil → DAS de R$ 1.460,00', () => {
    const a = apurarSimples({ periodo: '2026-08', anexo: 'III', receitas: { ...mesmoValor(meses, 20_000), '2026-08': 20_000 } })
    assert.equal(a.rbt12.paraTabela, 240_000)
    assert.equal(a.faixa, 2)
    assert.equal(a.aliquotaEfetiva, 7.3)
    assert.equal(a.dasEstimado, 1_460)
    perto(a.tributos.reduce((s, t) => s + t.valor, 0), 1_460, 0.03)
  })

  it('sujeito ao Fator R sem folha: cai no Anexo V e avisa quanto faltou', () => {
    const a = apurarSimples({ periodo: '2026-08', anexo: 'III', sujeitoAoFatorR: true, receitas: { ...mesmoValor(meses, 20_000), '2026-08': 20_000 }, folhas: mesmoValor(meses, 3_000) })
    assert.equal(a.anexoAplicado, 'V')
    // (240.000 × 18% − 4.500) ÷ 240.000 = 16,125%
    assert.equal(a.aliquotaEfetiva, 16.125)
    assert.equal(a.dasEstimado, 3_225)
    assert.ok(a.alertas.some((x) => x.texto.includes('Anexo V') && x.texto.includes('31.200,00')))
  })

  it('sujeito ao Fator R com folha de 28%: Anexo III', () => {
    const a = apurarSimples({ periodo: '2026-08', anexo: 'V', sujeitoAoFatorR: true, receitas: { ...mesmoValor(meses, 20_000), '2026-08': 20_000 }, folhas: mesmoValor(meses, 5_600) })
    assert.equal(a.anexoAplicado, 'III')
    assert.equal(a.dasEstimado, 1_460)
  })

  it('avisa ao passar de 80% do sublimite e ao passar do sublimite', () => {
    const base = mesmoValor(meses, 300_000)
    const a = apurarSimples({ periodo: '2026-08', anexo: 'I', receitas: { ...base, '2026-08': 300_000 } })
    // jan a ago = 8 × 300 mil = 2,4 milhões → ainda abaixo de 80% de 3,6 mi (2,88 mi)
    assert.equal(a.receitaNoAno, 2_400_000)
    assert.ok(!a.alertas.some((x) => x.texto.includes('sublimite')))
    const b = apurarSimples({ periodo: '2026-10', anexo: 'I', receitas: mesmoValor([...dozeMesesAnteriores('2026-10'), '2026-10'], 300_000) })
    assert.ok(b.alertas.some((x) => x.nivel === 'atencao' && x.texto.includes('80%')))
  })

  it('RBT12 acima de 4,8 milhões não apura pelo Simples', () => {
    assert.throws(() => apurarSimples({ periodo: '2026-08', anexo: 'I', receitas: mesmoValor(meses, 450_000) }), ErroSimples)
  })
})
