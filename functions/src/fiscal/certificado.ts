/**
 * Certificado digital A1 (e-CNPJ) da empresa: leitura do arquivo .pfx/.p12 e
 * cifragem do par arquivo+senha antes de ele encostar no Firestore.
 *
 * Regras que valem para todo o módulo fiscal:
 *  - a senha NUNCA é gravada em texto puro, NUNCA volta para o frontend e NUNCA vai para log;
 *  - o .pfx (que carrega a chave privada) é gravado cifrado, em /empresas/{id}/privado/fiscal,
 *    documento que as Rules negam para qualquer cliente (`match /privado/{doc=**} { allow read, write: if false }`);
 *  - a chave que cifra os dois fica no Secret Manager (FISCAL_CRYPTO_KEY, via defineSecret),
 *    de modo que ler o Firestore não basta para usar o certificado.
 *
 * Por que não guardar um segredo por empresa no Secret Manager: o Secret Manager é
 * dimensionado para configuração do projeto, não para dado de tenant (cada versão de segredo
 * precisa ser criada/destruída por API, entra na cota do projeto e teria de ser declarada em
 * `secrets:` no deploy da function, que é estático). O desenho adotado — envelope encryption com
 * uma chave mestra no Secret Manager e o material cifrado no documento privado do tenant — é o
 * equivalente seguro e é o que escala para N empresas.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import * as forge from 'node-forge'

export interface DadosCertificado {
  /** CNPJ (ou CPF) do titular, só dígitos/letras, extraído do próprio certificado */
  documento: string
  tipo: 'e-CNPJ' | 'e-CPF'
  titular: string
  emissor: string
  validoDe: Date
  validoAte: Date
  /** SHA-256 do certificado (DER), para identificar a versão sem expor o arquivo */
  impressaoDigital: string
}

export class ErroCertificado extends Error {}

const CNPJ_NO_CN = /:([0-9A-Z]{12}[0-9]{2})$/
const CPF_NO_CN = /:(\d{11})$/
/** OIDs da ICP-Brasil para CNPJ e CPF no subjectAltName (NT 2014.002, regra A07). */
const OID_CNPJ = '2.16.76.1.3.3'
const OID_CPF = '2.16.76.1.3.1'

/** Percorre a árvore ASN.1 procurando o valor que vem logo depois de um OID da ICP-Brasil. */
function documentoNoSubjectAltName(cert: forge.pki.Certificate, oid: string, tamanho: number): string | undefined {
  const ext = cert.extensions.find((e) => e.id === '2.5.29.17') as { value?: string } | undefined
  if (!ext?.value) return undefined
  let raiz: forge.asn1.Asn1
  try {
    raiz = forge.asn1.fromDer(forge.util.createBuffer(ext.value))
  } catch {
    return undefined
  }
  let achouOid = false
  let encontrado: string | undefined
  const visitar = (no: forge.asn1.Asn1): void => {
    if (encontrado) return
    if (no.type === forge.asn1.Type.OID && typeof no.value === 'string') {
      achouOid = forge.asn1.derToOid(no.value) === oid
      return
    }
    if (achouOid && typeof no.value === 'string') {
      const digitos = no.value.replace(/[^0-9A-Z]/gi, '')
      if (digitos.length >= tamanho) {
        encontrado = digitos.slice(0, tamanho).toUpperCase()
        return
      }
    }
    if (Array.isArray(no.value)) for (const f of no.value) visitar(f)
  }
  visitar(raiz)
  return encontrado
}

function nomeComum(cert: forge.pki.Certificate): string {
  const campo = cert.subject.getField('CN') as { value?: string } | null
  return (campo?.value ?? '').trim()
}

function nomeEmissor(cert: forge.pki.Certificate): string {
  const campo = cert.issuer.getField('CN') as { value?: string } | null
  return (campo?.value ?? '').trim()
}

/** É certificado de Autoridade Certificadora? (não é o certificado do titular) */
function ehAutoridade(cert: forge.pki.Certificate): boolean {
  const bc = cert.extensions.find((e) => e.name === 'basicConstraints') as { cA?: boolean } | undefined
  return bc?.cA === true
}

/**
 * Abre o .pfx/.p12 e devolve os dados do titular.
 * Erros de senha e de arquivo inválido viram mensagens que a tela pode mostrar.
 */
export function lerCertificadoPfx(pfxBase64: string, senha: string): DadosCertificado {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const der = forge.util.decode64(pfxBase64.replace(/\s/g, ''))
    const asn1 = forge.asn1.fromDer(der)
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (/password|mac could not be verified|invalid password/i.test(msg)) {
      throw new ErroCertificado('Senha do certificado incorreta.')
    }
    throw new ErroCertificado('Arquivo inválido: envie o certificado A1 no formato .pfx ou .p12.')
  }

  const sacos = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const certificados = sacos.map((s) => s.cert).filter((c): c is forge.pki.Certificate => Boolean(c))
  if (certificados.length === 0) throw new ErroCertificado('O arquivo não contém nenhum certificado.')

  const titular = certificados.find((c) => !ehAutoridade(c)) ?? certificados[0]

  const temChave = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])
    .concat(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])
    .some((s) => Boolean(s.key))
  if (!temChave) throw new ErroCertificado('O arquivo não contém a chave privada. Exporte o certificado A1 com a chave.')

  const cn = nomeComum(titular)
  const cnpj = CNPJ_NO_CN.exec(cn)?.[1] ?? documentoNoSubjectAltName(titular, OID_CNPJ, 14)
  const cpf = cnpj ? undefined : (CPF_NO_CN.exec(cn)?.[1] ?? documentoNoSubjectAltName(titular, OID_CPF, 11))
  const documento = cnpj ?? cpf
  if (!documento) {
    throw new ErroCertificado(
      'Não foi possível identificar o CNPJ no certificado. Use um e-CNPJ A1 da ICP-Brasil (a SEFAZ rejeita certificado sem CNPJ — código 473).',
    )
  }

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(titular)).getBytes()
  const impressaoDigital = createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex')

  return {
    documento,
    tipo: cnpj ? 'e-CNPJ' : 'e-CPF',
    titular: cn.replace(CNPJ_NO_CN, '').replace(CPF_NO_CN, '').trim() || cn,
    emissor: nomeEmissor(titular),
    validoDe: titular.validity.notBefore,
    validoAte: titular.validity.notAfter,
    impressaoDigital,
  }
}

/** O certificado está dentro do prazo de validade nesta data? */
export const certificadoVigente = (c: { validoDe: Date; validoAte: Date }, agora = new Date()): boolean =>
  agora >= c.validoDe && agora <= c.validoAte

// ---------- cifragem (AES-256-GCM com chave mestra do Secret Manager) ----------

const PREFIXO = 'v1'

function chaveDe(chaveBase64: string): Buffer {
  const chave = Buffer.from((chaveBase64 ?? '').trim(), 'base64')
  if (chave.length !== 32) {
    throw new ErroCertificado(
      'Segredo FISCAL_CRYPTO_KEY ausente ou inválido (precisa de 32 bytes em base64). Configure com "firebase functions:secrets:set FISCAL_CRYPTO_KEY".',
    )
  }
  return chave
}

/** Cifra um texto e devolve "v1.<iv>.<tag>.<dados>" em base64url. */
export function cifrar(texto: string, chaveBase64: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', chaveDe(chaveBase64), iv)
  const dados = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  return [PREFIXO, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.')
}

export function decifrar(pacote: string, chaveBase64: string): string {
  const partes = (pacote ?? '').split('.')
  if (partes.length !== 4 || partes[0] !== PREFIXO) throw new ErroCertificado('Conteúdo cifrado em formato desconhecido.')
  const decipher = createDecipheriv('aes-256-gcm', chaveDe(chaveBase64), Buffer.from(partes[1], 'base64url'))
  decipher.setAuthTag(Buffer.from(partes[2], 'base64url'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(partes[3], 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new ErroCertificado('Não foi possível decifrar o certificado: a chave FISCAL_CRYPTO_KEY mudou?')
  }
}

/** Comparação de impressões digitais sem vazar tempo. */
export function mesmaImpressao(a: string, b: string): boolean {
  const x = Buffer.from(a ?? '', 'utf8')
  const y = Buffer.from(b ?? '', 'utf8')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}
