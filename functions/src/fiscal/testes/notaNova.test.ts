/**
 * Nota sem modelo: regras de regime × totais de tributos × alíquota do Anexo I (leiaute v1.01) e
 * o código IBGE do município a partir do nome.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { DadosDps } from '../dps'
import { ErroRegime, codigoIbgeDoMunicipio, regimeDoPerfil, regrasDoRegime } from '../notaNova'

const base = (): DadosDps => ({
  ambiente: 'homologacao',
  dhEmi: '2026-09-18T10:00:00-03:00',
  serie: '1',
  numero: '1',
  competencia: '2026-09-18',
  tpEmit: '1',
  codigoMunicipioEmissao: '3117900',
  prestador: { cnpj: '11222333000181', regime: { opSimpNac: '3', regApTribSN: '1', regEspTrib: '0' } },
  tomador: { cnpj: '11444777000161', nome: 'Cliente' },
  servico: { codigoMunicipioPrestacao: '3117900', cTribNac: '010101', descricao: 'Desenvolvimento de sistema' },
  valores: { vServ: '1000.00', tribMun: { tribISSQN: '1', tpRetISSQN: '1' }, totTrib: { pTotTribSN: '6.00' } },
})

describe('situação no Simples a partir do perfil fiscal', () => {
  it('ME/EPP apura pelo Simples; MEI e não optante não informam regApTribSN', () => {
    assert.deepEqual(regimeDoPerfil('simples'), { opSimpNac: '3', regApTribSN: '1', regEspTrib: '0' })
    assert.deepEqual(regimeDoPerfil('mei'), { opSimpNac: '2', regEspTrib: '0' })
    assert.deepEqual(regimeDoPerfil('presumido'), { opSimpNac: '1', regEspTrib: '0' })
    assert.deepEqual(regimeDoPerfil(undefined), { opSimpNac: '1', regEspTrib: '0' })
  })
})

describe('regras de rejeição conferidas antes do envio', () => {
  it('ME/EPP pelo Simples, sem retenção, com percentual do Simples: passa', () => {
    assert.doesNotThrow(() => regrasDoRegime(base()))
  })
  it('E0166: ME/EPP sem regApTribSN', () => {
    const d = base()
    delete d.prestador.regime.regApTribSN
    assert.throws(() => regrasDoRegime(d), /E0166/)
  })
  it('E0162: MEI ou não optante com regApTribSN', () => {
    const d = base()
    d.prestador.regime = { opSimpNac: '2', regApTribSN: '1', regEspTrib: '0' }
    d.valores.totTrib = { indTotTrib: '0' }
    assert.throws(() => regrasDoRegime(d), /E0162/)
  })
  it('E0712: ME/EPP não pode "não informar tributos"', () => {
    const d = base()
    d.valores.totTrib = { indTotTrib: '0' }
    assert.throws(() => regrasDoRegime(d), /E0712/)
  })
  it('E0710: MEI não informa percentual do Simples', () => {
    const d = base()
    d.prestador.regime = { opSimpNac: '2', regEspTrib: '0' }
    assert.throws(() => regrasDoRegime(d), /E0710/)
  })
  it('E0713: não optante não usa indTotTrib nem pTotTribSN', () => {
    const d = base()
    d.prestador.regime = { opSimpNac: '1', regEspTrib: '0' }
    assert.throws(() => regrasDoRegime(d), /E0713/)
    d.valores.totTrib = { pTotTrib: { fed: '4.00', est: '0.00', mun: '2.00' } }
    assert.doesNotThrow(() => regrasDoRegime(d))
  })
  it('E0625: ME/EPP pelo Simples sem retenção não informa alíquota; com retenção, pode', () => {
    const d = base()
    d.valores.tribMun.pAliq = '2.00'
    assert.throws(() => regrasDoRegime(d), /E0625/)
    d.valores.tribMun.tpRetISSQN = '2'
    assert.doesNotThrow(() => regrasDoRegime(d))
  })
  it('percentual do Simples fora de 0 a 100', () => {
    const d = base()
    d.valores.totTrib = { pTotTribSN: '120' }
    assert.throws(() => regrasDoRegime(d), ErroRegime)
  })
})

describe('código IBGE pelo nome do município', () => {
  it('ignora acento e caixa', () => {
    assert.equal(codigoIbgeDoMunicipio('CONCEICAO DOS OUROS', 'MG'), codigoIbgeDoMunicipio('Conceição dos Ouros', 'mg'))
    assert.match(codigoIbgeDoMunicipio('Belo Horizonte', 'MG') ?? '', /^3106200$/)
    assert.equal(codigoIbgeDoMunicipio('São Paulo', 'SP'), '3550308')
  })
  it('a UF desempata homônimos e nome desconhecido não inventa código', () => {
    assert.notEqual(codigoIbgeDoMunicipio('Bom Jesus', 'PI'), codigoIbgeDoMunicipio('Bom Jesus', 'RS'))
    assert.equal(codigoIbgeDoMunicipio('Cidade Que Não Existe', 'MG'), undefined)
    assert.equal(codigoIbgeDoMunicipio(undefined, 'MG'), undefined)
  })
})
