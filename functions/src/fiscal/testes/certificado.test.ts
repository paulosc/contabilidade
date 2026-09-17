/** Certificado digital A1: leitura do .pfx, validade, senha e cifragem dos segredos. */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroCertificado, certificadoVigente, cifrar, decifrar, lerCertificadoPfx, mesmaImpressao } from '../certificado'
import { chaveMestraDeTeste, gerarCertificadoDeTeste } from './apoio'

describe('certificado A1', () => {
  it('lê CNPJ, titular e validade de um certificado válido', () => {
    const c = gerarCertificadoDeTeste({ cnpj: '12345678000199', titular: 'EMPRESA TESTE LTDA' })
    const dados = lerCertificadoPfx(c.pfxBase64, c.senha)

    assert.equal(dados.documento, '12345678000199')
    assert.equal(dados.tipo, 'e-CNPJ')
    assert.equal(dados.titular, 'EMPRESA TESTE LTDA')
    assert.equal(dados.emissor, 'AC TESTE')
    assert.equal(dados.impressaoDigital.length, 64)
    assert.equal(certificadoVigente(dados), true)
  })

  it('recusa senha incorreta com mensagem clara', () => {
    const c = gerarCertificadoDeTeste()
    assert.throws(
      () => lerCertificadoPfx(c.pfxBase64, 'senha-errada'),
      (e: unknown) => e instanceof ErroCertificado && /senha do certificado incorreta/i.test((e as Error).message),
    )
  })

  it('recusa arquivo que não é PKCS#12', () => {
    const lixo = Buffer.from('isto aqui nao e um certificado').toString('base64')
    assert.throws(
      () => lerCertificadoPfx(lixo, 'qualquer'),
      (e: unknown) => e instanceof ErroCertificado && /\.pfx ou \.p12/i.test((e as Error).message),
    )
  })

  it('identifica certificado expirado', () => {
    const c = gerarCertificadoDeTeste({ diasParaVencer: -1, diasDeValidadeJaCorridos: 400 })
    const dados = lerCertificadoPfx(c.pfxBase64, c.senha)
    assert.equal(certificadoVigente(dados), false)
    assert.equal(certificadoVigente(dados, new Date(dados.validoAte.getTime() - 86_400_000)), true)
  })

  it('identifica certificado que ainda não entrou em vigor', () => {
    const dados = { validoDe: new Date(Date.now() + 86_400_000), validoAte: new Date(Date.now() + 10 * 86_400_000) }
    assert.equal(certificadoVigente(dados), false)
  })
})

describe('cifragem dos segredos do certificado', () => {
  it('cifra e decifra de volta o mesmo conteúdo', () => {
    const chave = chaveMestraDeTeste()
    const senha = 'S3nh@-do-certificado'
    const pacote = cifrar(senha, chave)

    assert.notEqual(pacote, senha)
    assert.equal(pacote.includes(senha), false, 'a senha não pode aparecer em claro no pacote')
    assert.equal(decifrar(pacote, chave), senha)
  })

  it('cifra o mesmo texto de forma diferente a cada vez (IV aleatório)', () => {
    const chave = chaveMestraDeTeste()
    assert.notEqual(cifrar('igual', chave), cifrar('igual', chave))
  })

  it('não decifra com outra chave', () => {
    const pacote = cifrar('segredo', chaveMestraDeTeste())
    assert.throws(() => decifrar(pacote, chaveMestraDeTeste()), ErroCertificado)
  })

  it('rejeita chave mestra com tamanho errado', () => {
    assert.throws(() => cifrar('x', Buffer.from('curta').toString('base64')), ErroCertificado)
    assert.throws(() => cifrar('x', ''), ErroCertificado)
  })

  it('rejeita pacote adulterado (AES-GCM autentica o conteúdo)', () => {
    const chave = chaveMestraDeTeste()
    const partes = cifrar('segredo', chave).split('.')
    const adulterado = [partes[0], partes[1], partes[2], Buffer.from('outro conteudo').toString('base64url')].join('.')
    assert.throws(() => decifrar(adulterado, chave), ErroCertificado)
  })

  it('rejeita formato desconhecido', () => {
    assert.throws(() => decifrar('nao-e-um-pacote', chaveMestraDeTeste()), ErroCertificado)
  })

  it('compara impressões digitais sem estourar com tamanhos diferentes', () => {
    assert.equal(mesmaImpressao('abc', 'abc'), true)
    assert.equal(mesmaImpressao('abc', 'abcd'), false)
    assert.equal(mesmaImpressao('', ''), false)
  })
})
