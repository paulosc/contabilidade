/**
 * SEFIN Nacional — a interface que recebe o DPS e gera a NFS-e, e que registra eventos.
 *
 * Contrato lido do Swagger oficial (https://sefin.nfse.gov.br/SefinNacional/swagger/docs/v1):
 *   POST /nfse                          { dpsXmlGZipB64 }            → 201 NFSePostResponseSucesso
 *   POST /nfse/{chave}/eventos          { pedidoRegistroEventoXmlGZipB64 } → 201 EventosPostResponseSucesso
 *   GET  /dps/{id}                       → 200 { chaveAcesso } quando o DPS já virou nota; 404 se não
 *   GET  /nfse/{chave}                   → 200 { nfseXmlGZipB64 }
 * Erros de negócio vêm como 400 com `erros: [{ codigo, descricao, complemento }]`.
 * Transporte: TLS com autenticação mútua (certificado ICP-Brasil), JSON, XML em GZip + base64.
 */
import { Agent, request as httpsRequest } from 'node:https'
import { gunzipSync, gzipSync } from 'node:zlib'
import { SEFIN_URLS, type AmbienteFiscal } from './AdnContribuintesProvider'

export interface MensagemSefin {
  codigo: string
  descricao: string
  complemento?: string
}

export interface RespostaEmissao {
  status: number
  chaveAcesso?: string
  idDps?: string
  /** XML da NFS-e gerada, já descompactado */
  nfseXml?: string
  alertas: MensagemSefin[]
  erros: MensagemSefin[]
  tipoAmbiente?: number
  versaoAplicativo?: string
  dataHoraProcessamento?: string
}

export interface RespostaEvento {
  status: number
  /** XML do evento registrado, já descompactado */
  eventoXml?: string
  erros: MensagemSefin[]
  tipoAmbiente?: number
  dataHoraProcessamento?: string
}

export interface ConsultaDps {
  status: number
  chaveAcesso?: string
  idDps?: string
  erros: MensagemSefin[]
}

export interface CredenciaisSefin {
  pfxBase64: string
  senha: string
  ambiente: AmbienteFiscal
  /** Endereço alternativo — existe só para os testes automatizados */
  endpoint?: string
  timeoutMs?: number
}

const TIMEOUT_MS = 90_000

/**
 * Garante a declaração XML com a codificação no início do documento. Os bytes já são UTF-8, mas
 * sem a declaração o SEFIN não reconhece a codificação e rejeita com E1229 ("XML não está
 * utilizando codificação UTF8"). A declaração fica fora do trecho assinado (a assinatura cobre o
 * elemento com o Id), então acrescentá-la depois de assinar não altera o digest.
 */
export function comDeclaracaoUtf8(xml: string): string {
  const semBom = xml.replace(/^\uFEFF/, '').trimStart()
  if (/^<\?xml\b/.test(semBom)) return semBom.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>')
  return `<?xml version="1.0" encoding="UTF-8"?>${semBom}`
}

export const comprimir = (xml: string): string => gzipSync(Buffer.from(comDeclaracaoUtf8(xml), 'utf8')).toString('base64')
export const descomprimir = (b64: string): string => gunzipSync(Buffer.from(b64.replace(/\s/g, ''), 'base64')).toString('utf8')

// ---------- leitura das respostas (puro, testável) ----------

function mensagens(lista: unknown): MensagemSefin[] {
  if (!Array.isArray(lista)) return []
  return lista.map((m) => {
    const o = (m ?? {}) as Record<string, unknown>
    return {
      codigo: String(o.codigo ?? o.Codigo ?? ''),
      descricao: String(o.descricao ?? o.Descricao ?? o.mensagem ?? ''),
      complemento: o.complemento ? String(o.complemento) : undefined,
    }
  })
}

function json(corpo: string): Record<string, unknown> {
  try {
    const v = JSON.parse(corpo) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Erro que não veio no formato JSON de negócio (gateway, 5xx, HTML). */
const erroGenerico = (status: number, corpo: string): MensagemSefin[] => [
  { codigo: `HTTP${status}`, descricao: corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || `SEFIN respondeu HTTP ${status}` },
]

export function interpretarEmissao(status: number, corpo: string): RespostaEmissao {
  const o = json(corpo)
  const erros = mensagens(o.erros)
  const unico = o.erro && typeof o.erro === 'object' ? mensagens([o.erro]) : []
  const base: RespostaEmissao = {
    status,
    alertas: mensagens(o.alertas),
    erros: [...erros, ...unico],
    tipoAmbiente: typeof o.tipoAmbiente === 'number' ? o.tipoAmbiente : undefined,
    versaoAplicativo: o.versaoAplicativo ? String(o.versaoAplicativo) : undefined,
    dataHoraProcessamento: o.dataHoraProcessamento ? String(o.dataHoraProcessamento) : undefined,
    idDps: (o.idDps ?? o.idDPS) ? String(o.idDps ?? o.idDPS) : undefined,
  }
  if (status >= 200 && status < 300) {
    let nfseXml: string | undefined
    if (typeof o.nfseXmlGZipB64 === 'string') {
      try {
        nfseXml = descomprimir(o.nfseXmlGZipB64)
      } catch {
        base.erros.push({ codigo: 'LOCAL', descricao: 'A NFS-e veio num formato que não foi possível descompactar' })
      }
    }
    return { ...base, chaveAcesso: o.chaveAcesso ? String(o.chaveAcesso) : undefined, nfseXml }
  }
  if (!base.erros.length) base.erros = erroGenerico(status, corpo)
  return base
}

export function interpretarEvento(status: number, corpo: string): RespostaEvento {
  const o = json(corpo)
  const erros = [...mensagens(o.erros), ...(o.erro && typeof o.erro === 'object' ? mensagens([o.erro]) : [])]
  const base: RespostaEvento = {
    status,
    erros,
    tipoAmbiente: typeof o.tipoAmbiente === 'number' ? o.tipoAmbiente : undefined,
    dataHoraProcessamento: o.dataHoraProcessamento ? String(o.dataHoraProcessamento) : undefined,
  }
  if (status >= 200 && status < 300) {
    let eventoXml: string | undefined
    if (typeof o.eventoXmlGZipB64 === 'string') {
      try {
        eventoXml = descomprimir(o.eventoXmlGZipB64)
      } catch {
        base.erros.push({ codigo: 'LOCAL', descricao: 'O evento veio num formato que não foi possível descompactar' })
      }
    }
    return { ...base, eventoXml }
  }
  if (!base.erros.length) base.erros = erroGenerico(status, corpo)
  return base
}

export function interpretarConsultaDps(status: number, corpo: string): ConsultaDps {
  const o = json(corpo)
  if (status === 404) return { status, erros: [] }
  const erros = [...mensagens(o.erros), ...(o.erro && typeof o.erro === 'object' ? mensagens([o.erro]) : [])]
  return {
    status,
    chaveAcesso: o.chaveAcesso ? String(o.chaveAcesso) : undefined,
    idDps: o.idDps ? String(o.idDps) : undefined,
    erros: status >= 200 && status < 300 ? erros : erros.length ? erros : erroGenerico(status, corpo),
  }
}

export type SituacaoConvenio = 'conveniado' | 'sem_convenio' | 'indeterminado'

export interface ConsultaConvenio {
  situacao: SituacaoConvenio
  status: number
  /** Onde a consulta foi respondida (SEFIN ou ADN), para o diagnóstico */
  fonte?: string
  detalhe?: string
}

/**
 * Resposta de GET /parametros_municipais/{codigoMunicipio}/convenio (Manual dos Contribuintes —
 * Emissor Público API, item 1.2.1). Só afirma "sem convênio" quando o sistema diz isso com todas
 * as letras (404, ou mensagem de convênio inexistente/inativo); o resto fica "indeterminado" e a
 * emissão segue — quem decide, no fim, é a validação do próprio SEFIN.
 */
export function interpretarConvenio(status: number, corpo: string): ConsultaConvenio {
  const o = json(corpo)
  const texto = [...mensagens(o.erros), ...(o.erro && typeof o.erro === 'object' ? mensagens([o.erro]) : [])]
    .map((e) => `${e.codigo} ${e.descricao} ${e.complemento ?? ''}`)
    .join(' ')
  const semConvenio = /E0037|E0038|inexistente|n[aã]o (est[aá] )?ativo|n[aã]o encontrad|n[aã]o possui conv[eê]nio/i
  if (status === 404) return { situacao: 'sem_convenio', status, detalhe: texto || 'Município sem convênio neste ambiente.' }
  if (status >= 200 && status < 300) {
    if (semConvenio.test(texto) || semConvenio.test(corpo.slice(0, 500))) return { situacao: 'sem_convenio', status, detalhe: texto || corpo.slice(0, 200) }
    return { situacao: 'conveniado', status, detalhe: corpo.slice(0, 300) }
  }
  if (semConvenio.test(texto)) return { situacao: 'sem_convenio', status, detalhe: texto }
  return { situacao: 'indeterminado', status, detalhe: texto || corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) }
}

/** Texto para a tela a partir das mensagens do SEFIN. */
export const resumirErros = (erros: MensagemSefin[]): string =>
  erros.map((e) => `${e.codigo ? `${e.codigo} — ` : ''}${e.descricao}${e.complemento ? ` (${e.complemento})` : ''}`).join(' · ')

// ---------- cliente ----------

interface RespostaHttp {
  status: number
  corpo: string
}

export class SefinNacionalClient {
  private agente?: Agent
  private readonly timeoutMs: number

  constructor(private readonly cfg: CredenciaisSefin) {
    this.timeoutMs = cfg.timeoutMs ?? TIMEOUT_MS
  }

  private obterAgente(): Agent {
    if (!this.agente) {
      this.agente = new Agent({
        pfx: Buffer.from(this.cfg.pfxBase64, 'base64'),
        passphrase: this.cfg.senha,
        keepAlive: true,
        maxSockets: 2,
        minVersion: 'TLSv1.2',
      })
    }
    return this.agente
  }

  private get base(): string {
    return (this.cfg.endpoint ?? SEFIN_URLS[this.cfg.ambiente]).replace(/\/+$/, '')
  }

  private http(metodo: 'GET' | 'POST', caminho: string, corpoJson?: unknown): Promise<RespostaHttp> {
    return this.httpUrl(metodo, this.base + caminho, corpoJson)
  }

  private httpUrl(metodo: 'GET' | 'POST', endereco: string, corpoJson?: unknown): Promise<RespostaHttp> {
    const url = new URL(endereco)
    const corpo = corpoJson === undefined ? undefined : Buffer.from(JSON.stringify(corpoJson), 'utf8')
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          method: metodo,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'contabilidade-fiscal/1.0',
            ...(corpo ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': corpo.length } : {}),
          },
          agent: this.obterAgente(),
          timeout: this.timeoutMs,
        },
        (res) => {
          const partes: Buffer[] = []
          res.on('data', (c: Buffer) => partes.push(c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }))
        },
      )
      req.on('timeout', () => req.destroy(new Error(`SEFIN não respondeu em ${Math.round(this.timeoutMs / 1000)}s`)))
      req.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'ERR_OSSL_PKCS12_MAC_VERIFY_FAILURE' || /mac verify failure/i.test(e.message)) {
          reject(new Error('Senha do certificado incorreta'))
        } else reject(e)
      })
      if (corpo) req.write(corpo)
      req.end()
    })
  }

  /** POST /nfse — síncrono: manda o DPS assinado, volta a NFS-e. */
  async emitir(dpsXmlAssinado: string): Promise<RespostaEmissao> {
    const r = await this.http('POST', '/nfse', { dpsXmlGZipB64: comprimir(dpsXmlAssinado) })
    return interpretarEmissao(r.status, r.corpo)
  }

  /** POST /nfse/{chave}/eventos — registra um evento (cancelamento etc.). */
  async registrarEvento(chaveAcesso: string, pedidoXmlAssinado: string): Promise<RespostaEvento> {
    const chave = chaveAcesso.replace(/\D/g, '')
    const r = await this.http('POST', `/nfse/${chave}/eventos`, { pedidoRegistroEventoXmlGZipB64: comprimir(pedidoXmlAssinado) })
    return interpretarEvento(r.status, r.corpo)
  }

  /** GET /dps/{id} — este DPS já virou NFS-e? Protege contra reenvio duplicado. */
  async consultarDps(idDps: string): Promise<ConsultaDps> {
    const r = await this.http('GET', `/dps/${encodeURIComponent(idDps)}`)
    return interpretarConsultaDps(r.status, r.corpo)
  }

  /** GET /nfse/{chave} — a NFS-e completa (XML) pela chave. */
  async consultarNfse(chaveAcesso: string): Promise<RespostaEmissao> {
    const r = await this.http('GET', `/nfse/${chaveAcesso.replace(/\D/g, '')}`)
    return interpretarEmissao(r.status, r.corpo)
  }

  /**
   * O município emissor tem convênio ativo NESTE ambiente? A rota do manual é
   * GET /parametros_municipais/{codigoMunicipio}/convenio; ela é tentada no SEFIN e, se ele não a
   * servir (404 de rota), na API de parametrização do ADN do mesmo ambiente. Erro de rede não
   * impede a emissão: vira "indeterminado".
   */
  async consultarConvenio(codigoMunicipio: string): Promise<ConsultaConvenio> {
    const codigo = codigoMunicipio.replace(/\D/g, '')
    const caminho = `/parametros_municipais/${codigo}/convenio`
    const adn = this.cfg.ambiente === 'producao' ? 'https://adn.nfse.gov.br/parametrizacao' : 'https://adn.producaorestrita.nfse.gov.br/parametrizacao'
    const tentativas: Array<[string, string]> = [
      ['SEFIN', this.base + caminho],
      ['ADN', adn + caminho],
      ['ADN', `${adn}/${codigo}/convenio`],
    ]
    let ultima: ConsultaConvenio = { situacao: 'indeterminado', status: 0 }
    for (const [fonte, url] of tentativas) {
      try {
        const r = await this.httpUrl('GET', url)
        const c = { ...interpretarConvenio(r.status, r.corpo), fonte }
        // 404 sem corpo de negócio costuma ser "rota inexistente" neste host: tenta o próximo
        const rotaInexistente = r.status === 404 && !/erro|conv[eê]nio|munic/i.test(r.corpo)
        if (!rotaInexistente) return c
        ultima = { ...c, situacao: 'indeterminado' }
      } catch (e) {
        ultima = { situacao: 'indeterminado', status: 0, fonte, detalhe: (e as Error).message }
      }
    }
    return ultima
  }

  encerrar(): void {
    this.agente?.destroy()
    this.agente = undefined
  }
}
