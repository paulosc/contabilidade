/**
 * Assinatura digital XMLDSig dos documentos da NFS-e nacional (DPS e pedido de registro de evento).
 *
 * O padrão nacional exige (Swagger do SEFIN, item "Padrão de assinatura"): XMLDSIG conforme a
 * W3C, assinatura envelopada, feita com o certificado do emitente (regra E0718). Usamos os
 * algoritmos que o próprio Sistema Nacional aplica nas NFS-e que devolve: canonicalização
 * exclusiva (exc-c14n), RSA-SHA256 e digest SHA-256, KeyInfo com o certificado X.509.
 *
 * A chave privada sai do .pfx só na memória desta function, para assinar, e não é registrada
 * em log nem devolvida ao cliente.
 */
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

const ALG_ASSINATURA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const ALG_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const ALG_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256'
const TRANSFORMACAO_ENVELOPADA = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

export interface MaterialAssinatura {
  chavePrivadaPem: string
  certificadoPem: string
  /** Certificado em DER/base64, como vai no X509Certificate */
  certificadoBase64: string
}

const ehAutoridade = (cert: forge.pki.Certificate): boolean => {
  const ext = cert.getExtension('basicConstraints') as { cA?: boolean } | null
  return Boolean(ext?.cA)
}

/** Abre o .pfx e separa a chave privada e o certificado do titular, em PEM. */
export function materialDoPfx(pfxBase64: string, senha: string): MaterialAssinatura {
  const der = forge.util.decode64(pfxBase64.replace(/\s/g, ''))
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha)

  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((s) => s.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c))
  const titular = certificados.find((c) => !ehAutoridade(c)) ?? certificados[0]
  if (!titular) throw new Error('O certificado não contém o certificado do titular.')

  const chave = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].find((s) => s.key)?.key
  if (!chave) throw new Error('O certificado não contém a chave privada.')

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(titular)).getBytes()
  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(titular),
    certificadoBase64: forge.util.encode64(certDer),
  }
}

/**
 * Assina o elemento com o atributo Id indicado e devolve o XML com a `Signature` logo depois
 * dele (irmã), sem prefixo de namespace — o SEFIN rejeita prefixo na área de dados (E1228).
 */
export function assinarXml(xml: string, id: string, material: MaterialAssinatura): string {
  const assinador = new SignedXml({
    privateKey: material.chavePrivadaPem,
    publicCert: material.certificadoPem,
    signatureAlgorithm: ALG_ASSINATURA,
    canonicalizationAlgorithm: ALG_C14N,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${material.certificadoBase64}</X509Certificate></X509Data>`,
  })
  const alvo = `//*[@Id='${id}']`
  assinador.addReference({
    xpath: alvo,
    uri: `#${id}`,
    transforms: [TRANSFORMACAO_ENVELOPADA, ALG_C14N],
    digestAlgorithm: ALG_DIGEST,
  })
  assinador.computeSignature(xml, { location: { reference: alvo, action: 'after' } })
  return assinador.getSignedXml()
}

/** Confere uma assinatura com o certificado dado. Usado nos testes e como sanidade antes de enviar. */
export function verificarAssinatura(xmlAssinado: string, certificadoPem: string): boolean {
  const trecho = /<Signature\b[\s\S]*?<\/Signature>/.exec(xmlAssinado)
  if (!trecho) return false
  const verificador = new SignedXml({ publicCert: certificadoPem })
  verificador.loadSignature(trecho[0])
  try {
    return verificador.checkSignature(xmlAssinado)
  } catch {
    return false
  }
}
