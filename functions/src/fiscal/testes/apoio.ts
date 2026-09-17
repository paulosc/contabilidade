/**
 * Apoio dos testes da integração fiscal: gera certificados PKCS#12 de mentira e
 * monta respostas do NFeDistribuicaoDFe com o mesmo formato que a SEFAZ devolve.
 *
 * Nada aqui vai para produção — é só material de teste.
 */
import { gzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import * as forge from 'node-forge'

export interface CertificadoDeTeste {
  pfxBase64: string
  senha: string
  cnpj: string
  titular: string
  validoDe: Date
  validoAte: Date
}

/** Cria um .pfx autoassinado com o CN no formato da ICP-Brasil ("RAZAO SOCIAL:CNPJ"). */
export function gerarCertificadoDeTeste(opcoes: {
  cnpj?: string
  titular?: string
  senha?: string
  diasParaVencer?: number
  diasDeValidadeJaCorridos?: number
} = {}): CertificadoDeTeste {
  const cnpj = opcoes.cnpj ?? '12345678000199'
  const titular = opcoes.titular ?? 'EMPRESA TESTE LTDA'
  const senha = opcoes.senha ?? 'senha-de-teste'

  const par = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = par.publicKey
  cert.serialNumber = '01'
  const validoDe = new Date(Date.now() - (opcoes.diasDeValidadeJaCorridos ?? 30) * 86_400_000)
  const validoAte = new Date(Date.now() + (opcoes.diasParaVencer ?? 365) * 86_400_000)
  cert.validity.notBefore = validoDe
  cert.validity.notAfter = validoAte
  const atributos = [
    { name: 'commonName', value: `${titular}:${cnpj}` },
    { name: 'countryName', value: 'BR' },
    { name: 'organizationName', value: 'ICP-Brasil' },
  ]
  cert.setSubject(atributos)
  cert.setIssuer([
    { name: 'commonName', value: 'AC TESTE' },
    { name: 'countryName', value: 'BR' },
    { name: 'organizationName', value: 'ICP-Brasil' },
  ])
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }])
  cert.sign(par.privateKey, forge.md.sha256.create())

  const p12 = forge.pkcs12.toPkcs12Asn1(par.privateKey, [cert], senha, { algorithm: '3des' })
  const der = forge.asn1.toDer(p12).getBytes()
  return { pfxBase64: forge.util.encode64(der), senha, cnpj, titular, validoDe, validoAte }
}

/** Chave mestra de 32 bytes em base64, no formato que o FISCAL_CRYPTO_KEY espera. */
export const chaveMestraDeTeste = (): string => randomBytes(32).toString('base64')

const envelope = (corpo: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<soap:Body>' +
  '<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">' +
  '<nfeDistDFeInteresseResult>' +
  corpo +
  '</nfeDistDFeInteresseResult>' +
  '</nfeDistDFeInteresseResponse>' +
  '</soap:Body>' +
  '</soap:Envelope>'

/** Monta um retDistDFeInt igual ao dos exemplos do item 6 da NT 2014.002. */
export function respostaSefaz(opcoes: {
  cStat: string
  xMotivo?: string
  ultNSU?: string
  maxNSU?: string
  tpAmb?: string
  documentos?: Array<{ nsu: string; schema: string; xml: string }>
}): string {
  const lote = opcoes.documentos?.length
    ? '<loteDistDFeInt>' +
      opcoes.documentos
        .map((d) => `<docZip NSU="${d.nsu}" schema="${d.schema}">${gzipSync(Buffer.from(d.xml, 'utf8')).toString('base64')}</docZip>`)
        .join('') +
      '</loteDistDFeInt>'
    : ''
  return envelope(
    '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">' +
      `<tpAmb>${opcoes.tpAmb ?? '2'}</tpAmb>` +
      '<verAplic>1.4.0</verAplic>' +
      `<cStat>${opcoes.cStat}</cStat>` +
      `<xMotivo>${opcoes.xMotivo ?? ''}</xMotivo>` +
      '<dhResp>2026-09-17T11:54:49-03:00</dhResp>' +
      `<ultNSU>${opcoes.ultNSU ?? '000000000000000'}</ultNSU>` +
      `<maxNSU>${opcoes.maxNSU ?? '000000000000000'}</maxNSU>` +
      lote +
      '</retDistDFeInt>',
  )
}

export const falhaSoap = (mensagem: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
  `<soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>${mensagem}</faultstring></soap:Fault></soap:Body>` +
  '</soap:Envelope>'

export const CHAVE_NFE = '31260912345678000199550010000012341000012347'

/** Resumo de NF-e (resNFe_v1.01.xsd, leiaute do item 3.11.1 da NT). */
export const resumoNFe = (chave = CHAVE_NFE, cSitNFe = '1') =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
  `<chNFe>${chave}</chNFe>` +
  '<CNPJ>12345678000199</CNPJ>' +
  '<xNome>FORNECEDOR DE MATERIAL LTDA</xNome>' +
  '<IE>1234567890</IE>' +
  '<dhEmi>2026-09-10T09:15:00-03:00</dhEmi>' +
  '<tpNF>1</tpNF>' +
  '<vNF>1530.75</vNF>' +
  '<digVal>abcDEF123==</digVal>' +
  '<dhRecbto>2026-09-10T09:16:10-03:00</dhRecbto>' +
  '<nProt>131260000012345</nProt>' +
  `<cSitNFe>${cSitNFe}</cSitNFe>` +
  '</resNFe>'

/** NF-e completa (nfeProc), reduzida aos campos que o módulo lê. */
export const procNFe = (chave = CHAVE_NFE) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
  '<NFe>' +
  `<infNFe Id="NFe${chave}" versao="4.00">` +
  '<ide><cUF>31</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF>' +
  '<dhEmi>2026-09-10T09:15:00-03:00</dhEmi><tpNF>1</tpNF></ide>' +
  '<emit><CNPJ>12345678000199</CNPJ><xNome>FORNECEDOR DE MATERIAL LTDA</xNome><IE>1234567890</IE>' +
  '<enderEmit><xLgr>RUA A</xLgr><UF>MG</UF></enderEmit></emit>' +
  '<dest><CNPJ>98765432000188</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></dest>' +
  '<det nItem="1"><prod><cProd>P-001</cProd><xProd>CIMENTO CP II 50KG</xProd><NCM>25232910</NCM>' +
  '<CFOP>5102</CFOP><uCom>SC</uCom><qCom>10.0000</qCom><vUnCom>38.5000</vUnCom><vProd>385.00</vProd></prod></det>' +
  '<det nItem="2"><prod><cProd>P-002</cProd><xProd>TINTA ACRILICA 18L</xProd><NCM>32091010</NCM>' +
  '<CFOP>5102</CFOP><uCom>LT</uCom><qCom>5.0000</qCom><vUnCom>229.1500</vUnCom><vProd>1145.75</vProd></prod></det>' +
  '<total><ICMSTot><vProd>1530.75</vProd><vNF>1530.75</vNF></ICMSTot></total>' +
  '</infNFe>' +
  '</NFe>' +
  `<protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><dhRecbto>2026-09-10T09:16:10-03:00</dhRecbto>` +
  '<nProt>131260000012345</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>' +
  '</nfeProc>'

/** Evento de cancelamento (procEventoNFe). */
export const procEventoCancelamento = (chave = CHAVE_NFE) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">' +
  '<evento versao="1.00"><infEvento Id="ID1101110000">' +
  '<cOrgao>31</cOrgao><tpAmb>2</tpAmb><CNPJ>12345678000199</CNPJ>' +
  `<chNFe>${chave}</chNFe><dhEvento>2026-09-11T10:00:00-03:00</dhEvento>` +
  '<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>' +
  '</infEvento></evento>' +
  '<retEvento versao="1.00"><infEvento><tpEvento>110111</tpEvento><xEvento>Cancelamento registrado</xEvento>' +
  '<nProt>131260000099999</nProt></infEvento></retEvento>' +
  '</procEventoNFe>'
