/**
 * Cliente do NFeDistribuicaoDFe de ponta a ponta, contra um servidor HTTPS local que
 * exige certificado de cliente — do mesmo jeito que o Ambiente Nacional exige.
 *
 * Cobre o que a tela precisa distinguir: resposta com documentos, sem documentos,
 * rejeição, erro de autenticação (403), indisponibilidade (5xx) e timeout.
 */
import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { createServer, type Server } from 'node:https'
import { AddressInfo } from 'node:net'
import * as forge from 'node-forge'
import { SefazDistribuicaoProvider } from '../../providers/fiscal/sefazNacional'
import { RETORNO } from '../../providers/fiscal/DistribuicaoDFeProvider'
import { falhaSoap, gerarCertificadoDeTeste, procNFe, respostaSefaz, resumoNFe } from './apoio'

interface Recebido {
  contentType?: string
  soapAction?: string
  corpo: string
  temCertificado: boolean
}

/** O teste troca esta função para decidir o que o "servidor da SEFAZ" responde. */
let responder: (r: Recebido) => { status: number; corpo: string; atraso?: number }
let ultimoRecebido: Recebido | undefined

let servidor: Server
let endpoint: string
const cliente = gerarCertificadoDeTeste({ cnpj: '12345678000199' })

function certificadoDoServidor(): { key: string; cert: string } {
  const par = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = par.publicKey
  cert.serialNumber = '02'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 86_400_000)
  const nome = [{ name: 'commonName', value: 'localhost' }]
  cert.setSubject(nome)
  cert.setIssuer(nome)
  cert.sign(par.privateKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(par.privateKey), cert: forge.pki.certificateToPem(cert) }
}

function provider(opcoes: { timeoutMs?: number } = {}) {
  return new SefazDistribuicaoProvider(
    { cnpj: '12345678000199', pfxBase64: cliente.pfxBase64, senha: cliente.senha, ambiente: 'homologacao', cUFAutor: '31', endpoint },
    opcoes,
  )
}

before(async () => {
  const { key, cert } = certificadoDoServidor()
  servidor = createServer({ key, cert, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    const partes: Buffer[] = []
    req.on('data', (c: Buffer) => partes.push(c))
    req.on('end', () => {
      const recebido: Recebido = {
        contentType: req.headers['content-type'],
        soapAction: req.headers.soapaction as string | undefined,
        corpo: Buffer.concat(partes).toString('utf8'),
        temCertificado: Boolean((req.socket as { getPeerCertificate?: () => { subject?: unknown } }).getPeerCertificate?.()?.subject),
      }
      ultimoRecebido = recebido
      const resposta = responder(recebido)
      const enviar = () => {
        res.writeHead(resposta.status, { 'Content-Type': 'application/soap+xml; charset=utf-8' })
        res.end(resposta.corpo)
      }
      if (resposta.atraso) setTimeout(enviar, resposta.atraso)
      else enviar()
    })
  })
  // o certificado do servidor é autoassinado: o teste roda contra ele de propósito
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  endpoint = `https://127.0.0.1:${(servidor.address() as AddressInfo).port}/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
})

after(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()))
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
})

describe('requisição enviada à SEFAZ', () => {
  it('monta o envelope conforme a NT e apresenta o certificado do cliente', async () => {
    responder = () => ({ status: 200, corpo: respostaSefaz({ cStat: RETORNO.NENHUM_DOCUMENTO, ultNSU: '0', maxNSU: '0' }) })
    const p = provider()
    await p.distribuirPorNsu('7')
    p.encerrar()

    const enviado = ultimoRecebido!.corpo
    assert.equal(ultimoRecebido!.temCertificado, true, 'a conexão tem de ser mTLS')
    assert.ok(enviado.includes('<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">'))
    assert.ok(enviado.includes('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">'))
    assert.ok(enviado.includes('<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">'))
    assert.ok(enviado.includes('<tpAmb>2</tpAmb>'), 'homologação = tpAmb 2')
    assert.ok(enviado.includes('<cUFAutor>31</cUFAutor>'))
    assert.ok(enviado.includes('<CNPJ>12345678000199</CNPJ>'))
    assert.ok(enviado.includes('<distNSU><ultNSU>000000000000007</ultNSU></distNSU>'))
    assert.ok(ultimoRecebido!.contentType?.includes('nfeDistDFeInteresse'), 'a action vai no Content-Type do SOAP 1.2')
    assert.equal(/<\w+:distDFeInt/.test(enviado), false, 'a área de dados não pode usar prefixo de namespace')
  })

  it('usa consNSU e consChNFe nas consultas pontuais', async () => {
    responder = () => ({ status: 200, corpo: respostaSefaz({ cStat: RETORNO.NENHUM_DOCUMENTO }) })
    const p = provider()
    await p.consultarNsu('42')
    assert.ok(ultimoRecebido!.corpo.includes('<consNSU><NSU>000000000000042</NSU></consNSU>'))
    await p.consultarChave('31260912345678000199550010000012341000012347')
    assert.ok(ultimoRecebido!.corpo.includes('<consChNFe><chNFe>31260912345678000199550010000012341000012347</chNFe></consChNFe>'))
    p.encerrar()
  })

  it('recusa chave de acesso fora do formato antes de sair da máquina', async () => {
    const p = provider()
    await assert.rejects(() => p.consultarChave('123'), /44 dígitos/)
    p.encerrar()
  })

  it('volta para SOAP 1.1 quando o servidor recusa a versão 1.2', async () => {
    const versoes: string[] = []
    responder = (r) => {
      versoes.push(r.contentType ?? '')
      if (versoes.length === 1) return { status: 415, corpo: '' }
      return { status: 200, corpo: respostaSefaz({ cStat: RETORNO.NENHUM_DOCUMENTO }) }
    }
    const p = provider()
    const r = await p.distribuirPorNsu('0')
    p.encerrar()

    assert.equal(r.cStat, '137')
    assert.equal(versoes.length, 2)
    assert.ok(versoes[0].includes('application/soap+xml'))
    assert.ok(versoes[1].includes('text/xml'))
    assert.equal(ultimoRecebido!.soapAction, '"http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"')
    assert.ok(ultimoRecebido!.corpo.includes('http://schemas.xmlsoap.org/soap/envelope/'))
  })
})

describe('respostas da SEFAZ', () => {
  it('sem documentos (137)', async () => {
    responder = () => ({
      status: 200,
      corpo: respostaSefaz({ cStat: RETORNO.NENHUM_DOCUMENTO, xMotivo: 'Nenhum documento localizado', ultNSU: '15', maxNSU: '15' }),
    })
    const p = provider()
    const r = await p.distribuirPorNsu('15')
    p.encerrar()
    assert.equal(r.cStat, '137')
    assert.equal(r.documentos.length, 0)
    assert.ok(r.duracaoMs >= 0)
  })

  it('vários documentos em um lote (138)', async () => {
    responder = () => ({
      status: 200,
      corpo: respostaSefaz({
        cStat: RETORNO.DOCUMENTO_LOCALIZADO,
        ultNSU: '000000000000012',
        maxNSU: '000000000000100',
        documentos: [
          { nsu: '000000000000011', schema: 'resNFe_v1.01.xsd', xml: resumoNFe() },
          { nsu: '000000000000012', schema: 'procNFe_v4.00.xsd', xml: procNFe() },
        ],
      }),
    })
    const p = provider()
    const r = await p.distribuirPorNsu('10')
    p.encerrar()
    assert.equal(r.cStat, '138')
    assert.equal(r.documentos.length, 2)
    assert.equal(r.ultNSU, '000000000000012')
    assert.equal(r.maxNSU, '000000000000100')
    assert.ok(r.documentos[1].xml.includes('CIMENTO CP II 50KG'))
  })

  it('erro de autorização/autenticação do certificado (HTTP 403)', async () => {
    responder = () => ({ status: 403, corpo: '<html>403 - Forbidden: Access is denied.</html>' })
    const p = provider()
    await assert.rejects(() => p.distribuirPorNsu('0'), /certificado digital/i)
    p.encerrar()
  })

  it('indisponibilidade do serviço (HTTP 500 com falha SOAP)', async () => {
    responder = () => ({ status: 500, corpo: falhaSoap('Service temporarily unavailable') })
    const p = provider()
    await assert.rejects(() => p.distribuirPorNsu('0'), /HTTP 500.*Service temporarily unavailable/s)
    p.encerrar()
  })

  it('erro temporário do lado da SEFAZ (cStat 108) chega como resposta, não como exceção', async () => {
    responder = () => ({ status: 200, corpo: respostaSefaz({ cStat: RETORNO.PARALISADO_CURTO, xMotivo: 'Servico Paralisado Momentaneamente' }) })
    const p = provider()
    const r = await p.distribuirPorNsu('0')
    p.encerrar()
    assert.equal(r.cStat, '108')
  })

  it('timeout vira erro com mensagem clara', async () => {
    responder = () => ({ status: 200, corpo: respostaSefaz({ cStat: RETORNO.NENHUM_DOCUMENTO }), atraso: 1_000 })
    const p = provider({ timeoutMs: 150 })
    await assert.rejects(() => p.distribuirPorNsu('0'), /não respondeu/)
    p.encerrar()
  })
})
