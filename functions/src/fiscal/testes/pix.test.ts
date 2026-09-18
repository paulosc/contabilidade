/**
 * PIX copia e cola (BR Code estático).
 *
 * O CRC é conferido por dois lados: o valor de verificação universal do CRC-16/CCITT-FALSE
 * ("123456789" → 29B1) e o exemplo do Manual de Padrões para Iniciação do Pix do Banco Central.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroPix, crc16, gerarPixCopiaECola, normalizarChavePix } from '../pix'

describe('CRC16 do BR Code', () => {
  it('valor de verificação padrão do CRC-16/CCITT-FALSE', () => {
    assert.equal(crc16('123456789'), '29B1')
  })

  it('exemplo do manual do Banco Central', () => {
    const semCrc = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'
    assert.equal(crc16(semCrc), '1D3D')
  })
})

describe('chave PIX', () => {
  it('normaliza conforme o tipo', () => {
    assert.equal(normalizarChavePix('cpf_cnpj', '123.456.789-09'), '12345678909')
    assert.equal(normalizarChavePix('cpf_cnpj', '11.222.333/0001-81'), '11222333000181')
    assert.equal(normalizarChavePix('celular', '(35) 99104-0850'), '+5535991040850')
    assert.equal(normalizarChavePix('celular', '+55 35 99104-0850'), '+5535991040850')
    assert.equal(normalizarChavePix('email', ' Fulano@Exemplo.com.BR '), 'fulano@exemplo.com.br')
    assert.equal(normalizarChavePix('aleatoria', '123E4567-E12B-12D1-A456-426655440000'), '123e4567-e12b-12d1-a456-426655440000')
  })

  it('recusa chave que não bate com o tipo', () => {
    assert.throws(() => normalizarChavePix('cpf_cnpj', '12345'), ErroPix)
    assert.throws(() => normalizarChavePix('celular', '9999'), ErroPix)
    assert.throws(() => normalizarChavePix('email', 'sem-arroba'), ErroPix)
    assert.throws(() => normalizarChavePix('aleatoria', 'abc'), ErroPix)
    assert.throws(() => normalizarChavePix('email', ''), ErroPix)
  })
})

describe('copia e cola', () => {
  it('reproduz o exemplo do manual do Banco Central (sem valor)', () => {
    const br = gerarPixCopiaECola({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Fulano de Tal', cidade: 'BRASILIA' })
    // o manual usa o nome em caixa mista; aqui ele sai em maiúsculas, então o CRC muda — confere-se a estrutura
    assert.ok(br.startsWith('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913FULANO DE TAL6008BRASILIA62070503***6304'))
    assert.equal(br.slice(-4), crc16(br.slice(0, -4)))
  })

  it('com valor e identificador: campos 54 e 62, nome sem acento e limitado a 25', () => {
    const br = gerarPixCopiaECola({
      chave: '11222333000181',
      nome: 'Escritório São João Contábil e Assessoria Ltda',
      cidade: 'Conceição dos Ouros',
      valor: 265,
      identificador: 'HON-0000000001',
    })
    assert.ok(br.includes('5406265.00'))
    assert.ok(br.includes('5925ESCRITORIO SAO JOAO CONTA'))
    assert.ok(br.includes('6015CONCEICAO DOS O'))
    assert.ok(br.includes('62170513HON0000000001'))
    assert.match(br, /6304[0-9A-F]{4}$/)
    assert.equal(br.slice(-4), crc16(br.slice(0, -4)))
  })

  it('exige nome e cidade', () => {
    assert.throws(() => gerarPixCopiaECola({ chave: 'x@y.com', nome: '', cidade: 'BH' }), ErroPix)
    assert.throws(() => gerarPixCopiaECola({ chave: 'x@y.com', nome: 'Fulano', cidade: '' }), ErroPix)
  })
})
