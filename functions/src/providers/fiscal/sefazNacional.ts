/**
 * Adapter oficial do Web Service NFeDistribuicaoDFe (Ambiente Nacional da NF-e).
 *
 * Referência: Nota Técnica 2014.002 v1.40 (julho/2026) — "Web Service de Distribuição de DF-e
 * de Interesse dos Atores da NF-e" — e o pacote de esquemas PL_NFeDistDFe_104
 * (distDFeInt_v1.01.xsd / retDistDFeInt_v1.01.xsd), ambos publicados no Portal Nacional da NF-e.
 *
 * O que a NT define e este arquivo segue à risca:
 *  - método `nfeDistDFeInteresse`, processo síncrono, leiaute `versao="1.01"`;
 *  - namespace do serviço  http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe;
 *  - namespace dos dados    http://www.portalfiscal.inf.br/nfe;
 *  - XML sempre em UTF-8 e SEM prefixo de namespace (regra D02 → rejeição 404);
 *  - área de dados de no máximo 10 KB (regra B01 → rejeição 214);
 *  - transmissão com certificado digital ICP-Brasil (e-CNPJ/e-CPF) em TLS mútuo;
 *  - resposta `retDistDFeInt` com cStat/xMotivo/ultNSU/maxNSU e lote de até 50 `docZip`,
 *    cada um em base64 de um conteúdo compactado em gzip.
 *
 * Endereços publicados em "Serviços → Relação de Serviços Web" (Ambiente Nacional):
 *  produção     https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
 *  homologação  https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
 */
import { Agent, request as httpsRequest } from 'node:https'
import { gunzipSync, inflateSync, unzipSync } from 'node:zlib'
import { analisarXml, caminho, descendente, escaparXml, filhos, textoFilho, type NoXml } from '../../fiscal/xml'
import {
  tpAmbDe,
  type CredenciaisFiscais,
  type DistribuicaoDFeProvider,
  type DocumentoDistribuido,
  type RespostaDistribuicao,
} from './DistribuicaoDFeProvider'

const URLS = {
  producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
} as const

/** Namespace do WSDL do serviço (envelope/corpo da chamada). */
const NS_SERVICO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe'
/** Namespace do portal fiscal (área de dados: distDFeInt/retDistDFeInt). */
const NS_DADOS = 'http://www.portalfiscal.inf.br/nfe'
/** soapAction do binding NFeDistribuicaoDFeSoap, operação nfeDistDFeInteresse. */
const SOAP_ACTION = `${NS_SERVICO}/nfeDistDFeInteresse`
/** Única versão aceita pelo schema (TVerDistDFe). */
const VERSAO_LEIAUTE = '1.01'

const TIMEOUT_MS = 60_000

/** NSU tem exatamente 15 dígitos (tipo TNSU). */
export const formatarNsu = (valor: string | number): string => {
  const so = String(valor ?? '').replace(/\D/g, '')
  return (so || '0').slice(-15).padStart(15, '0')
}

/** Código IBGE da UF, usado no campo opcional cUFAutor (tipo TCodUfIBGE). */
export const UF_IBGE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
}

interface RespostaHttp {
  status: number
  corpo: string
}

export class SefazDistribuicaoProvider implements DistribuicaoDFeProvider {
  readonly nome = 'sefaz-nacional'
  private agente?: Agent
  private readonly timeoutMs: number

  constructor(private readonly cfg: CredenciaisFiscais, opcoes: { timeoutMs?: number } = {}) {
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS
  }

  /** Libera o socket TLS; o certificado sai da memória com ele. */
  encerrar(): void {
    this.agente?.destroy()
    this.agente = undefined
  }

  private obterAgente(): Agent {
    if (!this.agente) {
      this.agente = new Agent({
        pfx: Buffer.from(this.cfg.pfxBase64, 'base64'),
        passphrase: this.cfg.senha,
        keepAlive: false,
        minVersion: 'TLSv1.2',
      })
    }
    return this.agente
  }

  private http(corpo: string, soap12: boolean): Promise<RespostaHttp> {
    const url = new URL(this.cfg.endpoint || URLS[this.cfg.ambiente])
    const dados = Buffer.from(corpo, 'utf8')
    const cabecalhos: Record<string, string> = {
      'Content-Type': soap12
        ? `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`
        : 'text/xml; charset=utf-8',
      'Content-Length': String(dados.byteLength),
      Accept: soap12 ? 'application/soap+xml, text/xml' : 'text/xml',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'locabilize-fiscal/1.0',
    }
    if (!soap12) cabecalhos.SOAPAction = `"${SOAP_ACTION}"`

    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers: cabecalhos,
          agent: this.obterAgente(),
          timeout: this.timeoutMs,
        },
        (res) => {
          const partes: Buffer[] = []
          res.on('data', (c: Buffer) => partes.push(c))
          res.on('end', () => {
            let bruto = Buffer.concat(partes)
            const codificacao = String(res.headers['content-encoding'] ?? '').toLowerCase()
            try {
              if (codificacao.includes('gzip')) bruto = gunzipSync(bruto)
              else if (codificacao.includes('deflate')) bruto = inflateSync(bruto)
            } catch {
              // corpo não compactado apesar do cabeçalho: segue com o conteúdo original
            }
            resolve({ status: res.statusCode ?? 0, corpo: bruto.toString('utf8') })
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error(`SEFAZ não respondeu em ${this.timeoutMs / 1000}s`)))
      req.on('error', reject)
      req.write(dados)
      req.end()
    })
  }

  /** Monta o envelope SOAP. A NT traz o exemplo em SOAP 1.1; o WSDL do serviço também aceita 1.2. */
  private envelope(areaDeDados: string, soap12: boolean): string {
    const ns = soap12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/'
    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      `<soap:Envelope xmlns:soap="${ns}">` +
      '<soap:Body>' +
      `<nfeDistDFeInteresse xmlns="${NS_SERVICO}">` +
      `<nfeDadosMsg xmlns="${NS_SERVICO}">` +
      areaDeDados +
      '</nfeDadosMsg>' +
      '</nfeDistDFeInteresse>' +
      '</soap:Body>' +
      '</soap:Envelope>'
    )
  }

  /** distDFeInt conforme distDFeInt_v1.01.xsd (sem prefixo de namespace, UTF-8). */
  private areaDeDados(consulta: string): string {
    const documento = /^[0-9]{11}$/.test(this.cfg.cnpj)
      ? `<CPF>${escaparXml(this.cfg.cnpj)}</CPF>`
      : `<CNPJ>${escaparXml(this.cfg.cnpj)}</CNPJ>`
    const uf = this.cfg.cUFAutor ? `<cUFAutor>${escaparXml(this.cfg.cUFAutor)}</cUFAutor>` : ''
    return (
      `<distDFeInt xmlns="${NS_DADOS}" versao="${VERSAO_LEIAUTE}">` +
      `<tpAmb>${tpAmbDe(this.cfg.ambiente)}</tpAmb>` +
      uf +
      documento +
      consulta +
      '</distDFeInt>'
    )
  }

  private async chamar(consulta: string): Promise<RespostaDistribuicao> {
    const inicio = Date.now()
    const dados = this.areaDeDados(consulta)
    if (Buffer.byteLength(dados, 'utf8') > 10 * 1024) {
      // regra B01 da NT: área de dados acima de 10 KB é descartada pela SEFAZ
      throw new Error('Área de dados acima de 10 KB, limite do NFeDistribuicaoDFe')
    }

    let resposta = await this.http(this.envelope(dados, true), true)
    // .asmx recusa a versão do SOAP com 415; nesse caso repetimos no formato do exemplo da NT (SOAP 1.1)
    if (resposta.status === 415 || (resposta.status === 500 && /VersionMismatch/i.test(resposta.corpo))) {
      resposta = await this.http(this.envelope(dados, false), false)
    }

    if (resposta.status === 403) {
      throw new Error(
        'SEFAZ recusou a conexão (HTTP 403). Normalmente é certificado digital não aceito: confira se é um e-CNPJ A1 da ICP-Brasil válido.',
      )
    }
    if (resposta.status < 200 || resposta.status >= 300) {
      const falha = extrairFalhaSoap(resposta.corpo)
      throw new Error(`SEFAZ respondeu HTTP ${resposta.status}${falha ? `: ${falha}` : ''}`)
    }

    const retorno = interpretarRetorno(resposta.corpo)
    return { ...retorno, duracaoMs: Date.now() - inicio }
  }

  distribuirPorNsu(ultNSU: string): Promise<RespostaDistribuicao> {
    return this.chamar(`<distNSU><ultNSU>${formatarNsu(ultNSU)}</ultNSU></distNSU>`)
  }

  consultarNsu(nsu: string): Promise<RespostaDistribuicao> {
    return this.chamar(`<consNSU><NSU>${formatarNsu(nsu)}</NSU></consNSU>`)
  }

  async consultarChave(chNFe: string): Promise<RespostaDistribuicao> {
    const chave = chNFe.replace(/\D/g, '')
    if (chave.length !== 44) throw new Error('Chave de acesso deve ter 44 dígitos')
    return this.chamar(`<consChNFe><chNFe>${chave}</chNFe></consChNFe>`)
  }
}

/** Texto do <soap:Fault> quando a SEFAZ devolve erro de protocolo. */
export function extrairFalhaSoap(corpo: string): string | undefined {
  try {
    const raiz = analisarXml(corpo)
    const falha = descendente(raiz, 'fault')
    if (!falha) return undefined
    const texto =
      textoFilho(falha, 'faultstring') ??
      textoFilho(caminho(falha, 'reason'), 'text') ??
      falha.texto.trim()
    return texto || undefined
  } catch {
    return undefined
  }
}

/** Descompacta o docZip. A NT define gzip; aceitamos zlib/deflate por segurança. */
export function descompactarDocZip(base64: string): string {
  const bruto = Buffer.from(base64.replace(/\s/g, ''), 'base64')
  for (const tentar of [gunzipSync, unzipSync, inflateSync]) {
    try {
      return tentar(bruto).toString('utf8')
    } catch {
      // tenta o próximo formato
    }
  }
  throw new Error('Não foi possível descompactar o documento (docZip) devolvido pela SEFAZ')
}

/** Lê o envelope SOAP e devolve os campos do retDistDFeInt já descompactados. */
export function interpretarRetorno(corpoSoap: string): Omit<RespostaDistribuicao, 'duracaoMs'> {
  const raiz = analisarXml(corpoSoap)
  const ret = descendente(raiz, 'retdistdfeint')
  if (!ret) {
    const falha = extrairFalhaSoap(corpoSoap)
    throw new Error(falha ? `SEFAZ devolveu falha SOAP: ${falha}` : 'Resposta da SEFAZ sem retDistDFeInt')
  }

  const lote = descendente(ret, 'lotedistdfeint')
  const documentos: DocumentoDistribuido[] = []
  for (const doc of filhos(lote, 'doczip')) {
    const conteudo = (doc.texto ?? '').trim()
    if (!conteudo) continue
    documentos.push({
      nsu: doc.atributos.nsu ? formatarNsu(doc.atributos.nsu) : undefined,
      schema: doc.atributos.schema ?? '',
      xml: descompactarDocZip(conteudo),
    })
  }

  return {
    tpAmb: textoFilho(ret, 'tpamb') ?? '',
    verAplic: textoFilho(ret, 'veraplic'),
    cStat: textoFilho(ret, 'cstat') ?? '',
    xMotivo: textoFilho(ret, 'xmotivo') ?? '',
    dhResp: textoFilho(ret, 'dhresp'),
    ultNSU: textoFilho(ret, 'ultnsu'),
    maxNSU: textoFilho(ret, 'maxnsu'),
    documentos,
  }
}

/** Exportado só para os testes do parser. */
export type { NoXml }
