import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { vencimentoNaCompetencia } from '../gestao'

describe('vencimento do honorário recorrente', () => {
  it('usa o dia combinado dentro da competência', () => {
    assert.equal(vencimentoNaCompetencia('2026-09', 10), '2026-09-10')
    assert.equal(vencimentoNaCompetencia('2026-12', 5), '2026-12-05')
  })
  it('dia que não existe no mês vira o último dia', () => {
    assert.equal(vencimentoNaCompetencia('2026-09', 31), '2026-09-30')
    assert.equal(vencimentoNaCompetencia('2026-02', 30), '2026-02-28')
    assert.equal(vencimentoNaCompetencia('2028-02', 30), '2028-02-29')
  })
})
