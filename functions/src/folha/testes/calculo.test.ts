/**
 * Cálculo da folha. Os casos de IRRF são os exemplos publicados pela própria Receita Federal
 * ("Exemplos de Aplicação da Lei 15.270/2025"); os de INSS saem das portarias e dos mesmos
 * exemplos. Se um destes quebrar, a regra mudou ou o cálculo está errado — nunca ajustar o teste.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { calcularHolerite, calcularIrrf, inssContribuinteIndividual, inssProgressivo, type Lancamento } from '../calculo'
import { ErroTabela, tabelaInss, tabelaIrrf, ultimoAnoCoberto } from '../tabelas'

const salario = (valor: number): Lancamento => ({ codigo: '1000', descricao: 'Salário', tipo: 'provento', valor, referencia: '30 dias', incideInss: true, incideIrrf: true, incideFgts: true })

describe('tabelas por vigência', () => {
  it('usa a tabela da competência, não a mais nova', () => {
    assert.equal(tabelaInss('2025-12').teto, 8157.41)
    assert.equal(tabelaInss('2026-01').teto, 8475.55)
    assert.equal(tabelaIrrf('2025-12').reducao, undefined)
    assert.equal(tabelaIrrf('2026-01').reducao?.reducaoMaxima, 312.89)
  })

  it('recusa competência sem tabela oficial cadastrada', () => {
    assert.throws(() => tabelaInss('2024-12'), ErroTabela)
    assert.throws(() => tabelaIrrf('2025-04'), ErroTabela)
    assert.throws(() => tabelaInss(`${ultimoAnoCoberto() + 1}-01`), /ainda não foi cadastrada/)
    assert.throws(() => tabelaInss('09/2026'), ErroTabela)
  })
})

describe('INSS', () => {
  it('exemplo oficial do eSocial: trunca em cada faixa (R$ 2.000,00 em 2020 → 78,37 + 85,95 = 164,32)', () => {
    const tabela2020 = {
      ...tabelaInss('2026-01'),
      teto: 6101.06,
      faixas: [
        { ate: 1045.0, aliquota: 0.075 },
        { ate: 2089.6, aliquota: 0.09 },
        { ate: 3134.4, aliquota: 0.12 },
        { ate: 6101.06, aliquota: 0.14 },
      ],
    }
    assert.equal(inssProgressivo(1045, tabela2020), 78.37)
    assert.equal(inssProgressivo(2000, tabela2020), 164.32)
  })

  it('2025: truncado por faixa, fica 1 ou 2 centavos abaixo dos valores ilustrativos da Receita', () => {
    const t = tabelaInss('2025-12')
    assert.equal(inssProgressivo(3036, t), 257.72) // Receita ilustra 257,73
    assert.equal(inssProgressivo(4000, t), 373.4) // 373,41
    assert.equal(inssProgressivo(5000, t), 509.58) // 509,60
    assert.equal(inssProgressivo(6000, t), 649.58) // 649,60
  })

  it('2026: salário mínimo, teto e acima do teto', () => {
    const t = tabelaInss('2026-09')
    assert.equal(inssProgressivo(1621, t), 121.57)
    // 121,57 + 115,36 + 174,17 + 576,97
    assert.equal(inssProgressivo(8475.55, t), 988.07)
    assert.equal(inssProgressivo(20000, t), 988.07)
    assert.equal(inssProgressivo(0, t), 0)
  })

  it('pró-labore: 11% até o teto — R$ 4.800,00 dá os R$ 528,00 do DARF', () => {
    const t = tabelaInss('2026-08')
    assert.equal(inssContribuinteIndividual(4800, t), 528)
    assert.equal(inssContribuinteIndividual(10000, t), 932.31)
  })
})

describe('IRRF — exemplos oficiais da Receita (Lei 15.270/2025)', () => {
  const t = tabelaIrrf('2026-01')

  it('João: R$ 3.036,00 — simplificado, isento pela tabela', () => {
    const r = calcularIrrf(3036, 257.73, 0, 0, t)
    assert.equal(r.metodo, 'simplificado')
    assert.equal(r.base, 2428.8)
    assert.equal(r.valor, 0)
  })

  it('José: R$ 4.000,00 — imposto de R$ 114,76 zerado pela redução', () => {
    const r = calcularIrrf(4000, 373.41, 0, 0, t)
    assert.equal(r.metodo, 'simplificado')
    assert.equal(r.base, 3392.8)
    assert.equal(r.impostoPelaTabela, 114.76)
    assert.equal(r.reducao, 114.76)
    assert.equal(r.valor, 0)
  })

  it('Maria: R$ 5.000,00 — imposto de R$ 312,89 zerado pela redução máxima', () => {
    const r = calcularIrrf(5000, 509.6, 0, 0, t)
    assert.equal(r.base, 4392.8)
    assert.equal(r.impostoPelaTabela, 312.89)
    assert.equal(r.reducao, 312.89)
    assert.equal(r.valor, 0)
  })

  it('Rita: R$ 6.000,00 — deduções legais; redução de R$ 179,75 sobre o BRUTO; retém R$ 382,88', () => {
    const r = calcularIrrf(6000, 649.6, 0, 0, t)
    assert.equal(r.metodo, 'deducoes-legais')
    assert.equal(r.base, 5350.4)
    assert.equal(r.impostoPelaTabela, 562.63)
    assert.equal(r.reducao, 179.75)
    assert.equal(r.valor, 382.88)
  })

  it('Vera: R$ 7.607,20 — acima de R$ 7.350,00 não há redução', () => {
    const r = calcularIrrf(7607.2, 0, 0, 0, t)
    assert.equal(r.base, 7000)
    assert.equal(r.impostoPelaTabela, 1016.27)
    assert.equal(r.reducao, 0)
    assert.equal(r.valor, 1016.27)
  })

  it('antes de 2026 a redução não existe', () => {
    const r = calcularIrrf(4000, 373.41, 0, 0, tabelaIrrf('2025-12'))
    assert.equal(r.reducao, 0)
    assert.equal(r.valor, 114.76)
  })

  it('dependentes tornam as deduções legais mais vantajosas que o simplificado', () => {
    const r = calcularIrrf(9000, 951.63, 3, 0, t)
    assert.equal(r.metodo, 'deducoes-legais')
    assert.equal(r.deducoesLegais, 1520.4)
  })
})

describe('holerite', () => {
  it('empregado em 2026: INSS progressivo, IRRF zerado pela redução, FGTS informativo e líquido fechando', () => {
    const r = calcularHolerite({ competencia: '2026-09', tipo: 'empregado', lancamentos: [salario(4000)], dependentesIrrf: 0 })
    // 121,57 + 115,36 + 131,65
    assert.equal(r.inss, 368.58)
    assert.equal(r.irrf.valor, 0)
    assert.equal(r.fgts, 320)
    assert.equal(r.totalProventos, 4000)
    assert.equal(r.totalDescontos, 368.58)
    assert.equal(r.liquido, 3631.42)
    assert.deepEqual(
      r.linhas.map((l) => l.codigo),
      ['1000', 'INSS'],
    )
  })

  it('faltas reduzem as bases; vale-transporte desconta do líquido sem mexer em base', () => {
    const r = calcularHolerite({
      competencia: '2026-09',
      tipo: 'empregado',
      dependentesIrrf: 0,
      lancamentos: [
        salario(3000),
        { codigo: '9207', descricao: 'Faltas', tipo: 'desconto', valor: 200, incideInss: true, incideIrrf: true, incideFgts: true },
        { codigo: '9216', descricao: 'Vale-transporte', tipo: 'desconto', valor: 180, incideInss: false, incideIrrf: false, incideFgts: false },
      ],
    })
    assert.equal(r.baseInss, 2800)
    assert.equal(r.baseFgts, 2800)
    assert.equal(r.fgts, 224)
    assert.equal(r.liquido, Number((3000 - 200 - 180 - r.inss - r.irrf.valor).toFixed(2)))
  })

  it('pró-labore: 11%, sem FGTS', () => {
    const r = calcularHolerite({ competencia: '2026-08', tipo: 'prolabore', dependentesIrrf: 0, lancamentos: [{ ...salario(4800), descricao: 'Pró-labore', incideFgts: false }] })
    assert.equal(r.inss, 528)
    assert.equal(r.fgts, 0)
    assert.equal(r.irrf.valor, 0)
    assert.equal(r.liquido, 4272)
  })

  it('aprendiz recolhe FGTS de 2%', () => {
    assert.equal(calcularHolerite({ competencia: '2026-09', tipo: 'aprendiz', dependentesIrrf: 0, lancamentos: [salario(1621)] }).fgts, 32.42)
  })

  it('múltiplos vínculos: só desconta o que falta para o teto', () => {
    const r = calcularHolerite({ competencia: '2026-09', tipo: 'empregado', dependentesIrrf: 0, lancamentos: [salario(5000)], inssOutrasFontes: { base: 6000, valor: 641.54 } })
    assert.equal(r.baseInss, 2475.55)
    // progressivo(8.475,55) 988,07 − progressivo(6.000,00) 641,50
    assert.equal(r.inss, 346.57)
    assert.ok(r.avisos.some((a) => /outra fonte pagadora/.test(a)))
  })

  it('competência sem tabela é recusada, não calculada no chute', () => {
    assert.throws(() => calcularHolerite({ competencia: '2024-06', tipo: 'empregado', dependentesIrrf: 0, lancamentos: [salario(3000)] }), ErroTabela)
  })
})
