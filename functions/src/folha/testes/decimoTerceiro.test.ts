/**
 * 13º salário. Os valores esperados foram calculados à mão com as tabelas de 2026 (INSS da
 * Portaria 13/2026, com truncamento por faixa; IRRF com desconto simplificado de 607,20 e a
 * redução da Lei 15.270/2025).
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroDecimoTerceiro, avosDoAno, calcularDecimoTerceiro } from '../decimoTerceiro'

describe('avos (Decreto 10.854/2021, art. 76, §§ 1º e 2º)', () => {
  it('ano inteiro: 12', () => {
    assert.equal(avosDoAno(2026, '2020-05-10'), 12)
    assert.equal(avosDoAno(2026, '2026-01-01'), 12)
  })
  it('mês da admissão conta com 15 dias ou mais de serviço', () => {
    assert.equal(avosDoAno(2026, '2026-03-17'), 10) // 17 a 31/03 = 15 dias → conta março
    assert.equal(avosDoAno(2026, '2026-03-18'), 9) // 14 dias → não conta
    assert.equal(avosDoAno(2026, '2026-02-14'), 11) // fevereiro de 28 dias: 14 a 28 = 15 dias
    assert.equal(avosDoAno(2026, '2026-02-15'), 10)
  })
  it('admitido em dezembro depois do dia 17, ou no ano seguinte: nada', () => {
    assert.equal(avosDoAno(2026, '2026-12-18'), 0)
    assert.equal(avosDoAno(2026, '2027-01-02'), 0)
  })
  it('avos até um mês e meses sem direito', () => {
    assert.equal(avosDoAno(2026, '2026-03-17', 10), 8)
    assert.equal(avosDoAno(2026, '2020-01-01', 12, 3), 9)
  })
})

describe('13º de ano inteiro', () => {
  it('salário de R$ 3.000,00: INSS por faixa, IRRF zerado pelo desconto simplificado', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2022-01-10', salario: 3000 })
    assert.equal(r.avos, 12)
    assert.equal(r.bruto, 3000)
    assert.deepEqual(r.primeiraParcela, { mes: 11, avos: 12, valor: 1500, fgts: 120 })
    assert.equal(r.segundaParcela.inss, 248.58) // 121,57 + 115,36 + 11,65
    assert.equal(r.segundaParcela.irrf.metodo, 'simplificado')
    assert.equal(r.segundaParcela.irrf.valor, 0)
    assert.equal(r.segundaParcela.liquido, 1251.42)
    assert.equal(r.segundaParcela.fgts, 120)
  })

  it('salário de R$ 8.000,00 com 2 dependentes: deduções legais, sem redução (acima de 7.350)', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2019-06-01', salario: 8000, dependentes: 2 })
    assert.equal(r.segundaParcela.inss, 921.5) // 121,57 + 115,36 + 174,17 + 510,40
    assert.equal(r.segundaParcela.irrf.metodo, 'deducoes-legais')
    assert.equal(r.segundaParcela.irrf.base, 6699.32) // 8.000 − 921,50 − 2 × 189,59
    assert.equal(r.segundaParcela.irrf.reducao, 0)
    assert.equal(r.segundaParcela.irrf.valor, 933.58) // 6.699,32 × 27,5% − 908,73
    assert.equal(r.segundaParcela.liquido, 2144.92)
  })

  it('o IRRF do 13º é sobre o valor total, não só sobre a 2ª parcela', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2019-06-01', salario: 8000 })
    assert.equal(r.segundaParcela.irrf.rendimentosTributaveis, 8000)
  })
})

describe('admitido no ano (art. 78, § 4º)', () => {
  it('R$ 6.000,00 desde 17/03: 10 avos, adiantamento de novembro com 8 avos, redução zera o IR até R$ 5.000,00', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2026-03-17', salario: 6000 })
    assert.equal(r.avos, 10)
    assert.equal(r.bruto, 5000)
    assert.equal(r.primeiraParcela.avos, 8) // março a outubro
    assert.equal(r.primeiraParcela.valor, 2000) // 6.000 × 8/12 ÷ 2
    assert.equal(r.segundaParcela.inss, 501.5) // 121,57 + 115,36 + 174,17 + 90,40
    assert.equal(r.segundaParcela.irrf.impostoPelaTabela, 312.89) // (5.000 − 607,20) × 22,5% − 675,49
    assert.equal(r.segundaParcela.irrf.reducao, 312.89)
    assert.equal(r.segundaParcela.irrf.valor, 0)
    assert.equal(r.segundaParcela.liquido, 2498.5)
  })
})

describe('variáveis, aprendiz e adiantamento informado', () => {
  it('soma 1/11 dos variáveis devidos até novembro (art. 77)', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2020-01-01', salario: 2000, variaveisAteNovembro: 5500 })
    assert.equal(r.bruto, 2500)
  })
  it('aprendiz recolhe FGTS de 2%', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'aprendiz', dataAdmissao: '2025-01-01', salario: 1000 })
    assert.equal(r.primeiraParcela.fgts, 10)
    assert.equal(r.segundaParcela.fgts, 10)
  })
  it('adiantamento pago diferente do calculado é respeitado e avisado', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2020-01-01', salario: 3000, adiantamentoPago: 1000 })
    assert.equal(r.segundaParcela.adiantamentoAbatido, 1000)
    assert.equal(r.segundaParcela.liquido, 1751.42)
    assert.ok(r.avisos.some((a) => a.includes('difere')))
  })
  it('sem nenhum avo não há 13º', () => {
    const r = calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2026-12-20', salario: 3000 })
    assert.equal(r.bruto, 0)
    assert.equal(r.segundaParcela.liquido, 0)
    assert.ok(r.avisos.length > 0)
  })
  it('entradas inválidas', () => {
    assert.throws(() => calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2020-01-01', salario: 0 }), ErroDecimoTerceiro)
    assert.throws(() => calcularDecimoTerceiro({ ano: 2026, tipo: 'empregado', dataAdmissao: '2020-01-01', salario: 3000, mesDoAdiantamento: 12 }), ErroDecimoTerceiro)
    assert.throws(() => avosDoAno(2026, '17/03/2026'), ErroDecimoTerceiro)
  })
})
