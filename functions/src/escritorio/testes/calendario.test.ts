/**
 * Calendário de obrigações. As datas de 2026 foram conferidas no calendário: Páscoa em 05/04/2026,
 * Carnaval em 16 e 17/02, Sexta-feira Santa em 03/04, Corpus Christi em 04/06.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ehDiaUtil, feriados, obrigacoesQueVencemEm, pascoa, situacaoDaObrigacao, type PerfilFiscal } from '../calendario'

const simplesComFolha: PerfilFiscal = { regime: 'simples', temEmpregados: true, temProLabore: true, temReinf: false }
const simplesSoSocio: PerfilFiscal = { regime: 'simples', temEmpregados: false, temProLabore: true, temReinf: false }
const mei: PerfilFiscal = { regime: 'mei', temEmpregados: false, temProLabore: false, temReinf: false }
const presumido: PerfilFiscal = { regime: 'presumido', temEmpregados: true, temProLabore: true, temReinf: true }

const venc = (perfil: PerfilFiscal, mes: string, codigo: string) => obrigacoesQueVencemEm(perfil, mes).find((o) => o.codigo === codigo)?.vencimento

describe('feriados e dias úteis', () => {
  it('Páscoa', () => {
    assert.equal(pascoa(2026).toISOString().slice(0, 10), '2026-04-05')
    assert.equal(pascoa(2025).toISOString().slice(0, 10), '2025-04-20')
    assert.equal(pascoa(2027).toISOString().slice(0, 10), '2027-03-28')
  })
  it('feriados móveis de 2026', () => {
    const f = feriados(2026)
    for (const d of ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20']) assert.ok(f.has(d), d)
  })
  it('fim de semana e feriado não são dia útil', () => {
    assert.equal(ehDiaUtil(new Date(Date.UTC(2026, 8, 19))), false) // sábado
    assert.equal(ehDiaUtil(new Date(Date.UTC(2026, 8, 7))), false) // Independência
    assert.equal(ehDiaUtil(new Date(Date.UTC(2026, 8, 18))), true)
  })
})

describe('vencimentos', () => {
  it('setembro/2026: dia 20 é domingo — DAS prorroga para 21, DARF e FGTS antecipam para 18', () => {
    assert.equal(venc(simplesComFolha, '2026-09', 'das'), '2026-09-21')
    assert.equal(venc(simplesComFolha, '2026-09', 'pgdas'), '2026-09-21')
    assert.equal(venc(simplesComFolha, '2026-09', 'darf_previdenciario'), '2026-09-18')
    assert.equal(venc(simplesComFolha, '2026-09', 'fgts'), '2026-09-18')
  })
  it('as obrigações mensais se referem ao mês anterior', () => {
    const das = obrigacoesQueVencemEm(simplesComFolha, '2026-09').find((o) => o.codigo === 'das')!
    assert.equal(das.competencia, '2026-08')
    assert.equal(obrigacoesQueVencemEm(simplesComFolha, '2026-01').find((o) => o.codigo === 'das')!.competencia, '2025-12')
  })
  it('agosto/2026: dia 15 é sábado — eSocial antecipa para 14, EFD-Reinf prorroga para 17', () => {
    assert.equal(venc(presumido, '2026-08', 'esocial'), '2026-08-14')
    assert.equal(venc(presumido, '2026-08', 'efd_reinf'), '2026-08-17')
  })
  it('DCTFWeb no último dia útil: agosto/2026 termina na segunda 31', () => {
    assert.equal(venc(simplesComFolha, '2026-08', 'dctfweb'), '2026-08-31')
    // maio/2026 termina no domingo 31 → sexta 29
    assert.equal(venc(simplesComFolha, '2026-05', 'dctfweb'), '2026-05-29')
  })
  it('5º dia útil de salário conta o sábado: setembro/2026 → dia 5 (sábado)', () => {
    // 1 ter, 2 qua, 3 qui, 4 sex, 5 sáb
    assert.equal(venc(simplesComFolha, '2026-09', 'salarios'), '2026-09-05')
    // junho/2026: 1 seg, 2 ter, 3 qua, 4 Corpus Christi (não conta), 5 sex, 6 sáb → dia 6
    assert.equal(venc(simplesComFolha, '2026-06', 'salarios'), '2026-06-06')
  })
  it('13º: 30/11/2026 é segunda; 20/12/2026 é domingo → 18/12', () => {
    assert.equal(venc(simplesComFolha, '2026-11', 'decimo_terceiro_1'), '2026-11-30')
    assert.equal(venc(simplesComFolha, '2026-12', 'decimo_terceiro_2'), '2026-12-18')
  })
})

describe('o que se aplica a cada perfil', () => {
  const codigos = (p: PerfilFiscal, mes: string) => obrigacoesQueVencemEm(p, mes).map((o) => o.codigo)

  it('Simples só com pró-labore: tem eSocial, DCTFWeb e DARF, mas não FGTS nem salários', () => {
    const c = codigos(simplesSoSocio, '2026-09')
    for (const x of ['das', 'pgdas', 'esocial', 'dctfweb', 'darf_previdenciario', 'folha']) assert.ok(c.includes(x), x)
    for (const x of ['fgts', 'salarios', 'efd_reinf', 'das_mei', 'pis_cofins']) assert.ok(!c.includes(x), x)
  })
  it('MEI sem empregado: DAS-MEI e rotinas, sem folha nem contabilidade', () => {
    const c = codigos(mei, '2026-09')
    assert.ok(c.includes('das_mei'))
    for (const x of ['das', 'esocial', 'balancete', 'conciliacao']) assert.ok(!c.includes(x), x)
  })
  it('anuais aparecem só no mês em que vencem, referindo-se ao ano anterior', () => {
    const defis = obrigacoesQueVencemEm(simplesComFolha, '2026-03').find((o) => o.codigo === 'defis')!
    assert.equal(defis.vencimento, '2026-03-31')
    assert.equal(defis.competencia, '2025')
    assert.ok(!codigos(simplesComFolha, '2026-04').includes('defis'))
    assert.equal(venc(mei, '2026-05', 'dasn_simei'), '2026-05-31')
    assert.ok(!codigos(mei, '2026-03').includes('defis'))
  })
  it('lucro presumido: PIS/Cofins todo mês e IRPJ/CSLL no mês seguinte ao trimestre', () => {
    assert.equal(venc(presumido, '2026-09', 'pis_cofins'), '2026-09-25')
    assert.ok(!codigos(presumido, '2026-09').includes('irpj_csll'))
    const t = obrigacoesQueVencemEm(presumido, '2026-10').find((o) => o.codigo === 'irpj_csll')!
    assert.equal(t.competencia, '2026-T3')
    assert.equal(t.vencimento, '2026-10-30')
    assert.equal(obrigacoesQueVencemEm(presumido, '2026-01').find((o) => o.codigo === 'irpj_csll')!.competencia, '2025-T4')
  })
  it('vem em ordem de vencimento', () => {
    const v = obrigacoesQueVencemEm(simplesComFolha, '2026-09').map((o) => o.vencimento)
    assert.deepEqual(v, [...v].sort())
  })
})

describe('situação', () => {
  it('marcação vence sobre a data', () => {
    assert.equal(situacaoDaObrigacao('2026-09-01', 'feita', '2026-09-18'), 'feita')
    assert.equal(situacaoDaObrigacao('2026-09-01', 'dispensada', '2026-09-18'), 'dispensada')
  })
  it('sem marcação: atrasada, vence hoje, próxima (até 5 dias) ou futura', () => {
    assert.equal(situacaoDaObrigacao('2026-09-17', undefined, '2026-09-18'), 'atrasada')
    assert.equal(situacaoDaObrigacao('2026-09-18', undefined, '2026-09-18'), 'vence_hoje')
    assert.equal(situacaoDaObrigacao('2026-09-21', undefined, '2026-09-18'), 'proxima')
    assert.equal(situacaoDaObrigacao('2026-09-30', undefined, '2026-09-18'), 'futura')
  })
})
