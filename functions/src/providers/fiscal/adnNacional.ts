/**
 * Adapter da API de Distribuição dos Contribuintes do ADN (NFS-e nacional).
 *
 * REST/JSON sobre TLS mútuo com o certificado A1 da empresa — o mesmo certificado usado na
 * NF-e. Endereços e semântica conforme os manuais oficiais citados em
 * `AdnContribuintesProvider.ts`.
 *
 * Sobre o formato da resposta: o Swagger do ADN fica atrás de TLS mútuo (as tentativas de
 * leitura devolveram HTTP 403 / conexão recusada sem certificado), então os nomes exatos dos
 * campos JSON não puderam ser conferidos na implementação. O que os manuais garantem é a
 * semântica: lote de até 50 documentos, `ultNSU` e `maxNSU`, e o XML de cada DF-e. Por isso a
 * leitura aqui aceita as grafias plausíveis, é insensível a maiúsculas e devolve em
 * `formatoRecebido` as chaves que realmente vieram — basta uma execução real para confirmar.
 */
import { Agent, request as httpsRequest } from 'node:https'
import { gunzipSync, inflateSync, unzipSync } from 'node:zlib'
import {
  ADN_URLS,
  type AdnContribuintesProvider,
  type CredenciaisAdn,
  type DocumentoServicoDistribuido,
  type RespostaDistribuicaoAdn,
} from './AdnContribuintesProvider'

const TIMEOUT_MS = 60_000

/** NSU do ADN: número inteiro, sem o preenchimento de 15 posições que a NF-e exige. */
export const nsuAdn = (valor: string | number): string => {
  const so = String(valor ?? '').replace(/\D/g, '')
  return so ? String(Number(so)) : '0'
}

interface RespostaHttp {
  status: number
  corpo: string
  bytes?: Buffer
}

export class AdnNacionalProvider implements AdnContribuintesProvider {
  readonly nome = 'adn-nfse-nacional'
  private agente?: Agent
  private readonly timeoutMs: number

  constructor(private readonly cfg: CredenciaisAdn, opcoes: { timeoutMs?: number } = {}) {
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS
  }

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

  private get base(): string {
    return this.cfg.endpoint || ADN_URLS[this.cfg.ambiente]
  }

  private http(caminho: string, base?: string, accept = 'application/json'): Promise<RespostaHttp> {
    const url = new URL((base ?? this.base) + caminho)
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers: {
            Accept: accept,
            'Accept-Encoding': 'gzip, deflate',
            'User-Agent': 'contabilidade-fiscal/1.0',
          },
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
              // veio sem compactação apesar do cabeçalho
            }
            resolve({ status: res.statusCode ?? 0, corpo: bruto.toString('utf8'), bytes: bruto })
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error(`ADN não respondeu em ${this.timeoutMs / 1000}s`)))
      req.on('error', reject)
      req.end()
    })
  }

  private async chamar(caminho: string): Promise<RespostaDistribuicaoAdn> {
    const inicio = Date.now()
    const r = await this.http(caminho)

    if (r.status === 403) {
      throw new Error(
        'O ADN recusou a conexão (HTTP 403). Normalmente é certificado digital não aceito: confira se é um certificado ICP-Brasil válido e se o CNPJ dele cobre o CNPJ consultado.',
      )
    }
    if (r.status === 404) {
      // sem documentos novos: o ADN responde vazio para o NSU informado
      return { status: 404, documentos: [], duracaoMs: Date.now() - inicio }
    }

    const json = interpretarJson(r.corpo)
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`ADN respondeu HTTP ${r.status}${json.mensagem ? `: ${json.mensagem}` : ''}`)
    }
    return { status: r.status, ...json, duracaoMs: Date.now() - inicio }
  }

  distribuirPorNsu(ultimoNSU: string): Promise<RespostaDistribuicaoAdn> {
    return this.chamar(`/DFe/${encodeURIComponent(nsuAdn(ultimoNSU))}`)
  }

  eventosDaChave(chaveAcesso: string): Promise<RespostaDistribuicaoAdn> {
    const chave = (chaveAcesso ?? '').replace(/\D/g, '')
    if (chave.length !== 50) return Promise.reject(new Error('Chave de acesso da NFS-e deve ter 50 dígitos'))
    return this.chamar(`/NFSe/${chave}/Eventos`)
  }

  /**
   * Sonda um endereço do ambiente nacional usando o mesmo certificado, e devolve status e um
   * pedaço do corpo. Serve para ler o Swagger oficial — que exige mTLS e por isso não abre no
   * navegador — em vez de adivinhar caminho de API. Só aceita os hosts oficiais.
   */
  async sondar(urlCompleta: string): Promise<{ url: string; status: number; corpo: string }> {
    const url = new URL(urlCompleta)
    const permitidos = ['adn.nfse.gov.br', 'sefin.nfse.gov.br', 'adn.producaorestrita.nfse.gov.br', 'sefin.producaorestrita.nfse.gov.br']
    if (!permitidos.includes(url.hostname)) throw new Error(`Host fora do ambiente nacional: ${url.hostname}`)
    const r = await this.http('', urlCompleta, 'application/json, text/html, */*')
    return { url: urlCompleta, status: r.status, corpo: r.corpo.slice(0, 400_000) }
  }
}

// ---------- leitura da resposta ----------

/** Procura uma chave pelo nome, sem diferenciar maiúsculas nem acentos de grafia. */
function campo(objeto: Record<string, unknown>, ...nomes: string[]): unknown {
  const mapa = new Map(Object.keys(objeto).map((k) => [k.toLowerCase(), k]))
  for (const nome of nomes) {
    const real = mapa.get(nome.toLowerCase())
    if (real !== undefined && objeto[real] !== undefined && objeto[real] !== null) return objeto[real]
  }
  return undefined
}

const texto = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v))

/** Base64 que pode ou não estar compactado em gzip — aceita os dois. */
export function decodificarDocumento(conteudo: string): string {
  const limpo = conteudo.replace(/\s/g, '')
  // já é XML em texto puro?
  if (limpo.startsWith('<')) return conteudo
  const bruto = Buffer.from(limpo, 'base64')
  for (const tentar of [gunzipSync, unzipSync, inflateSync]) {
    try {
      return tentar(bruto).toString('utf8')
    } catch {
      // tenta o próximo formato
    }
  }
  const comoTexto = bruto.toString('utf8')
  if (comoTexto.includes('<')) return comoTexto
  throw new Error('Não foi possível decodificar o documento devolvido pelo ADN')
}

/**
 * Lê o JSON do ADN. Tolerante de propósito: os manuais garantem a semântica (lote de até 50,
 * ultNSU, maxNSU, XML por documento) mas o Swagger, que traz os nomes exatos, exige certificado.
 */
export function interpretarJson(corpo: string): Omit<RespostaDistribuicaoAdn, 'status' | 'duracaoMs'> {
  if (!corpo.trim()) return { documentos: [] }
  let raiz: unknown
  try {
    raiz = JSON.parse(corpo)
  } catch {
    throw new Error('O ADN devolveu uma resposta que não é JSON')
  }
  if (Array.isArray(raiz)) raiz = { LoteDFe: raiz }
  if (typeof raiz !== 'object' || raiz === null) return { documentos: [] }
  const o = raiz as Record<string, unknown>

  const lote = campo(o, 'LoteDFe', 'Lote', 'DFe', 'Documentos', 'DocumentosFiscais', 'Itens')
  const itens: Record<string, unknown>[] = Array.isArray(lote)
    ? (lote as Record<string, unknown>[])
    : lote && typeof lote === 'object'
      ? [lote as Record<string, unknown>]
      : []

  const documentos: DocumentoServicoDistribuido[] = []
  for (const item of itens) {
    if (!item || typeof item !== 'object') continue
    const conteudo = texto(campo(item, 'ArquivoXml', 'DocumentoXml', 'Xml', 'ConteudoXml', 'Documento', 'DocZip', 'Conteudo'))
    if (!conteudo) continue
    documentos.push({
      nsu: texto(campo(item, 'NSU', 'Nsu')),
      chaveAcesso: texto(campo(item, 'ChaveAcesso', 'Chave', 'ChaveNFSe'))?.replace(/\D/g, '') || undefined,
      xml: decodificarDocumento(conteudo),
    })
  }

  const mensagens = campo(o, 'Mensagem', 'Mensagens', 'Erros', 'Erro', 'Alertas', 'Message')

  // O ADN não devolve ultNSU/maxNSU no topo da resposta (confirmado numa execução real, cujo
  // formato foi: StatusProcessamento, LoteDFe, Alertas, Erros, TipoAmbiente, VersaoAplicativo,
  // DataHoraProcessamento). O NSU vem em cada documento do lote, então o "último NSU da
  // sequência encontrada" de que fala o manual é o maior NSU do lote.
  const nsusDoLote = documentos.map((d) => Number(d.nsu)).filter((n) => Number.isFinite(n) && n > 0)
  const ultNSUDoTopo = texto(campo(o, 'ultNSU', 'UltimoNSU', 'UltNSU', 'NSUFinal'))
  const ultNSU = ultNSUDoTopo ?? (nsusDoLote.length ? String(Math.max(...nsusDoLote)) : undefined)

  return {
    ultNSU,
    maxNSU: texto(campo(o, 'maxNSU', 'MaiorNSU', 'MaxNSU', 'NSUMaximo')),
    documentos,
    mensagem: Array.isArray(mensagens)
      ? mensagens.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ') || undefined
      : texto(mensagens),
    // registra o formato real recebido — chaves do topo e de um item do lote
    formatoRecebido: [...Object.keys(o), ...(itens[0] ? Object.keys(itens[0]).map((k) => `item:${k}`) : [])],
  }
}
