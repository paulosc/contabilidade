/**
 * Integra Contador (Serpro) — a via oficial da Receita Federal para gerar DAS e DARF por API.
 *
 * Contrato lido da documentação oficial (apicenter.estaleiro.serpro.gov.br, API Integra
 * Contador) e conferido contra o ambiente Trial do próprio Serpro:
 *   Autenticação  POST https://autenticacao.sapi.serpro.gov.br/authenticate
 *                 mTLS com o e-CNPJ usado na contratação · Authorization: Basic key:secret
 *                 Role-Type: TERCEIROS · grant_type=client_credentials
 *                 → { access_token, jwt_token, expires_in }
 *   Chamadas      POST {base}/{Apoiar|Consultar|Declarar|Emitir|Monitorar}
 *                 Authorization: Bearer … · jwt_token: … (dispensado no Trial)
 *                 corpo: contratante, autorPedidoDados, contribuinte, pedidoDados{idSistema,
 *                 idServico, versaoSistema, dados (JSON como string)}
 *   Resposta      { status, mensagens[{codigo,texto}], dados (JSON como string) }
 *
 * Serviços usados: PGDASD/GERARDAS12 (DAS de declaração já transmitida), PGDASD/
 * CONSULTIMADECREC14 (recibo e declaração do período), DCTFWEB/GERARGUIA31 e
 * GERARGUIAANDAMENTO313 (DARF). Este módulo NÃO transmite declaração: apurar e declarar é ato
 * do contador; aqui só se emite a guia do que já foi declarado.
 */
import { Agent, request as httpsRequest } from 'node:https'

export const SERPRO_URLS = {
  producao: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1',
  trial: 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1',
} as const
export const SERPRO_AUTENTICACAO = 'https://autenticacao.sapi.serpro.gov.br/authenticate'
/** Token público do ambiente de demonstração, publicado na documentação do Serpro. */
export const SERPRO_TOKEN_TRIAL = '06aef429-a981-3ec5-a1f8-71d38d86481e'
/** CNPJ de teste que o Trial aceita para emissão. */
export const SERPRO_CNPJ_TRIAL = '00000000000100'

export type AmbienteSerpro = 'producao' | 'trial'
export type RotaSerpro = 'Apoiar' | 'Consultar' | 'Declarar' | 'Emitir' | 'Monitorar'

export interface MensagemSerpro {
  codigo: string
  texto: string
}

export interface RespostaSerpro<T = unknown> {
  httpStatus: number
  status?: number
  mensagens: MensagemSerpro[]
  dados?: T
  ok: boolean
}

export class ErroSerpro extends Error {
  constructor(
    mensagem: string,
    readonly httpStatus?: number,
    readonly mensagens: MensagemSerpro[] = [],
  ) {
    super(mensagem)
  }
}

// ---------- leitura das respostas (puro, testável) ----------

/** O campo `dados` vem como JSON dentro de string; aqui ele já sai como objeto. */
export function interpretarResposta<T = unknown>(httpStatus: number, corpo: string): RespostaSerpro<T> {
  let o: Record<string, unknown> = {}
  try {
    const v = JSON.parse(corpo) as unknown
    if (v && typeof v === 'object') o = v as Record<string, unknown>
  } catch {
    // gateway devolve HTML/texto em alguns erros
  }
  const mensagens: MensagemSerpro[] = Array.isArray(o.mensagens)
    ? o.mensagens.map((m) => ({ codigo: String((m as MensagemSerpro)?.codigo ?? ''), texto: String((m as MensagemSerpro)?.texto ?? '') }))
    : []
  let dados: unknown
  if (typeof o.dados === 'string' && o.dados.trim()) {
    try {
      dados = JSON.parse(o.dados)
    } catch {
      dados = o.dados
    }
  } else if (o.dados && typeof o.dados === 'object') dados = o.dados
  const status = typeof o.status === 'number' ? o.status : undefined
  return { httpStatus, status, mensagens, dados: dados as T | undefined, ok: httpStatus >= 200 && httpStatus < 300 && (status === undefined || (status >= 200 && status < 300)) }
}

/** Mensagem legível para quem está na tela, a partir do que o Serpro devolveu. */
export function explicarFalha(r: RespostaSerpro, corpo = ''): string {
  if (r.httpStatus === 429) return 'O Serpro limitou as requisições (HTTP 429). Aguarde um minuto e tente de novo.'
  if (r.httpStatus === 401) return 'O Serpro recusou as credenciais (HTTP 401). Confira a consumer key e a consumer secret.'
  if (r.httpStatus === 403) return 'Acesso negado pelo Serpro (HTTP 403): o serviço pode não estar no contrato, ou falta procuração eletrônica no e-CAC para este contribuinte.'
  const textos = r.mensagens.map((m) => `${m.codigo} ${m.texto}`.trim()).filter(Boolean)
  if (textos.length) return textos.join(' · ')
  const limpo = corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
  return limpo || `O Serpro respondeu HTTP ${r.httpStatus}.`
}

export interface DasGerado {
  pdf: Buffer
  cnpj?: string
  numeroDocumento?: string
  /** 'AAAA-MM-DD' */
  vencimento?: string
  dataLimiteAcolhimento?: string
  total?: number
  observacoes: string[]
}

const dataIso = (v?: string) => (v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : undefined)

/** GERARDAS12 → dados: [{ pdf, cnpjCompleto, detalhamentoDas{…} }] */
export function lerDasGerado(dados: unknown): DasGerado {
  const item = (Array.isArray(dados) ? dados[0] : dados) as
    | { pdf?: string; cnpjCompleto?: string; detalhamentoDas?: { numeroDocumento?: string; dataVencimento?: string; dataLimiteAcolhimento?: string; valores?: { total?: number }; observacao1?: string; observacao2?: string; observacao3?: string } }
    | undefined
  if (!item?.pdf) throw new ErroSerpro('O Serpro respondeu sem o PDF do DAS.')
  const d = item.detalhamentoDas
  return {
    pdf: Buffer.from(item.pdf, 'base64'),
    cnpj: item.cnpjCompleto,
    numeroDocumento: d?.numeroDocumento,
    vencimento: dataIso(d?.dataVencimento),
    dataLimiteAcolhimento: dataIso(d?.dataLimiteAcolhimento),
    total: d?.valores?.total,
    observacoes: [d?.observacao1, d?.observacao2, d?.observacao3].filter((o): o is string => Boolean(o?.trim())),
  }
}

/** DCTFWEB GERARGUIA31 / GERARGUIAANDAMENTO313 → dados: { PDFByteArrayBase64 } */
export function lerDarfGerado(dados: unknown): Buffer {
  const b64 = (dados as { PDFByteArrayBase64?: string } | undefined)?.PDFByteArrayBase64
  if (!b64) throw new ErroSerpro('O Serpro respondeu sem o PDF do documento de arrecadação.')
  return Buffer.from(b64, 'base64')
}

export interface DeclaracaoPgdasd {
  numeroDeclaracao?: string
  recibo?: { nomeArquivo: string; pdf: Buffer }
  declaracao?: { nomeArquivo: string; pdf: Buffer }
}

/** CONSULTIMADECREC14 → dados: { numeroDeclaracao, recibo{nomeArquivo,pdf}, declaracao{…} } */
export function lerUltimaDeclaracao(dados: unknown): DeclaracaoPgdasd {
  const o = (dados ?? {}) as { numeroDeclaracao?: string; recibo?: { nomeArquivo?: string; pdf?: string }; declaracao?: { nomeArquivo?: string; pdf?: string } }
  const arquivo = (a?: { nomeArquivo?: string; pdf?: string }) => (a?.pdf ? { nomeArquivo: a.nomeArquivo ?? 'documento.pdf', pdf: Buffer.from(a.pdf, 'base64') } : undefined)
  return { numeroDeclaracao: o.numeroDeclaracao, recibo: arquivo(o.recibo), declaracao: arquivo(o.declaracao) }
}

/** 'AAAA-MM' → 'AAAAMM' (formato do periodoApuracao do PGDAS-D) */
export const periodoSerpro = (periodo: string): string => {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new ErroSerpro('Competência inválida: use AAAA-MM.')
  return periodo.replace('-', '')
}

// ---------- pagamentos, caixa postal e situação fiscal (leitura pura) ----------

/** Um documento de arrecadação pago (PAGTOWEB/PAGAMENTOS71). */
export interface PagamentoReceita {
  numeroDocumento: string
  tipo?: string
  /** 'AAAA-MM-DD' — data contábil da efetivação do pagamento */
  dataArrecadacao?: string
  valorTotal?: number
  codigoReceita?: string
}

const soData = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined)

export function lerPagamentos(dados: unknown): PagamentoReceita[] {
  if (!Array.isArray(dados)) return []
  return dados
    .map((d) => {
      const o = (d ?? {}) as Record<string, unknown>
      const tipo = o.tipo as { descricaoAbreviada?: string; descricao?: string } | undefined
      const receita = o.receitaPrincipal as { codigo?: string } | undefined
      return {
        numeroDocumento: String(o.numeroDocumento ?? '').replace(/\D/g, ''),
        tipo: tipo?.descricaoAbreviada ?? tipo?.descricao,
        dataArrecadacao: soData(o.dataArrecadacao),
        valorTotal: typeof o.valorTotal === 'number' ? o.valorTotal : undefined,
        codigoReceita: receita?.codigo,
      }
    })
    .filter((x) => x.numeroDocumento)
}

/** Uma mensagem da Caixa Postal do e-CAC — só o cabeçalho; o conteúdo não é lido por aqui. */
export interface MensagemCaixaPostal {
  isn: string
  assunto: string
  /** 'AAAA-MM-DD' */
  enviadaEm?: string
  lida: boolean
  /** 'AAAA-MM-DD' — ciência já registrada (pela leitura ou tácita, pelo decurso do prazo) */
  cienciaEm?: string
  relevante: boolean
  origem?: string
}

export interface CaixaPostal {
  mensagens: MensagemCaixaPostal[]
  naoLidas: number
  temMaisPaginas: boolean
}

/** O assunto pode trazer o marcador ++VARIAVEL++, a ser trocado por `valorParametroAssunto`. */
export function lerCaixaPostal(dados: unknown): CaixaPostal {
  const conteudo = ((dados as { conteudo?: unknown[] })?.conteudo?.[0] ?? dados ?? {}) as Record<string, unknown>
  const lista = Array.isArray(conteudo.listaMensagens) ? (conteudo.listaMensagens as Array<Record<string, unknown>>) : []
  const mensagens = lista.map((m) => ({
    isn: String(m.isn ?? ''),
    assunto: String(m.assuntoModelo ?? '').replace('++VARIAVEL++', String(m.valorParametroAssunto ?? '')).trim(),
    enviadaEm: dataIso(String(m.dataEnvio ?? '')),
    lida: String(m.indicadorLeitura ?? '0') === '1',
    cienciaEm: dataIso(String(m.dataCiencia ?? '')),
    relevante: String(m.relevancia ?? '1') === '2',
    origem: m.descricaoOrigem ? String(m.descricaoOrigem) : undefined,
  }))
  return { mensagens, naoLidas: mensagens.filter((m) => !m.lida).length, temMaisPaginas: String(conteudo.indicadorUltimaPagina ?? 'S') === 'N' }
}

// ---------- cliente ----------

export interface CredenciaisSerpro {
  ambiente: AmbienteSerpro
  /** Produção: credenciais do contrato e o e-CNPJ do contratante */
  consumerKey?: string
  consumerSecret?: string
  pfxBase64?: string
  senha?: string
  /** CNPJ de quem contratou o Serpro (14 dígitos) */
  contratante: string
  /** CNPJ/CPF de quem faz o pedido; sem procuração, tem que ser o próprio contribuinte */
  autor: string
  timeoutMs?: number
}

interface Tokens {
  accessToken: string
  jwtToken?: string
  expiraEm: number
}

const tipoDe = (doc: string): 1 | 2 => (doc.replace(/\D/g, '').length === 11 ? 1 : 2)

export class SerproIntegraContador {
  private agente?: Agent
  private tokens?: Tokens
  private readonly timeoutMs: number

  constructor(private readonly cfg: CredenciaisSerpro) {
    this.timeoutMs = cfg.timeoutMs ?? 90_000
  }

  private obterAgente(): Agent | undefined {
    if (this.cfg.ambiente === 'trial') return undefined
    if (!this.agente) {
      if (!this.cfg.pfxBase64) throw new ErroSerpro('Certificado digital não cadastrado.')
      this.agente = new Agent({ pfx: Buffer.from(this.cfg.pfxBase64, 'base64'), passphrase: this.cfg.senha, keepAlive: true, maxSockets: 2, minVersion: 'TLSv1.2' })
    }
    return this.agente
  }

  private http(url: string, cabecalhos: Record<string, string>, corpo: string, comCertificado: boolean): Promise<{ status: number; corpo: string }> {
    const alvo = new URL(url)
    const dados = Buffer.from(corpo, 'utf8')
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          method: 'POST',
          hostname: alvo.hostname,
          port: alvo.port || 443,
          path: alvo.pathname + alvo.search,
          headers: { ...cabecalhos, 'Content-Length': dados.length, 'User-Agent': 'contabilidade-fiscal/1.0' },
          agent: comCertificado ? this.obterAgente() : undefined,
          timeout: this.timeoutMs,
        },
        (res) => {
          const partes: Buffer[] = []
          res.on('data', (c: Buffer) => partes.push(c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }))
        },
      )
      req.on('timeout', () => req.destroy(new ErroSerpro(`O Serpro não respondeu em ${Math.round(this.timeoutMs / 1000)}s.`)))
      req.on('error', (e: NodeJS.ErrnoException) =>
        reject(/mac verify failure/i.test(e.message) ? new ErroSerpro('Senha do certificado incorreta.') : e instanceof ErroSerpro ? e : new ErroSerpro(`Falha de conexão com o Serpro: ${e.message}`)),
      )
      req.write(dados)
      req.end()
    })
  }

  /** Autentica no Serpro (produção). No Trial o token é público e fixo. */
  async autenticar(forcar = false): Promise<Tokens> {
    if (this.cfg.ambiente === 'trial') return { accessToken: SERPRO_TOKEN_TRIAL, expiraEm: Number.MAX_SAFE_INTEGER }
    if (!forcar && this.tokens && this.tokens.expiraEm > Date.now() + 30_000) return this.tokens
    if (!this.cfg.consumerKey || !this.cfg.consumerSecret) throw new ErroSerpro('Credenciais do Serpro não cadastradas.')
    const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`, 'utf8').toString('base64')
    const r = await this.http(
      SERPRO_AUTENTICACAO,
      { Authorization: `Basic ${basic}`, 'Role-Type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded' },
      'grant_type=client_credentials',
      true,
    )
    let o: { access_token?: string; jwt_token?: string; expires_in?: number } = {}
    try {
      o = JSON.parse(r.corpo) as typeof o
    } catch {
      // resposta fora do JSON
    }
    if (r.status < 200 || r.status >= 300 || !o.access_token) {
      throw new ErroSerpro(
        r.status === 401 || r.status === 403
          ? 'O Serpro recusou a autenticação: confira a consumer key/secret e se o certificado é o mesmo e-CNPJ usado na contratação.'
          : `Falha ao autenticar no Serpro (HTTP ${r.status}).`,
        r.status,
      )
    }
    this.tokens = { accessToken: o.access_token, jwtToken: o.jwt_token, expiraEm: Date.now() + (o.expires_in ?? 600) * 1000 }
    return this.tokens
  }

  /** Uma chamada a um serviço. Em 401, renova o token uma vez e repete. */
  async chamar<T = unknown>(rota: RotaSerpro, contribuinte: string, idSistema: string, idServico: string, dados: Record<string, unknown> | null, versaoSistema = '1.0'): Promise<RespostaSerpro<T>> {
    const pessoa = (doc: string) => ({ numero: doc.replace(/\D/g, ''), tipo: tipoDe(doc) })
    const corpo = JSON.stringify({
      contratante: pessoa(this.cfg.contratante),
      autorPedidoDados: pessoa(this.cfg.autor),
      contribuinte: pessoa(contribuinte),
      // alguns serviços não têm dados de entrada e exigem o campo vazio
      pedidoDados: { idSistema, idServico, versaoSistema, dados: dados === null ? '' : JSON.stringify(dados) },
    })
    for (let tentativa = 1; ; tentativa++) {
      const t = await this.autenticar(tentativa > 1)
      const cabecalhos: Record<string, string> = { Authorization: `Bearer ${t.accessToken}`, 'Content-Type': 'application/json' }
      if (t.jwtToken) cabecalhos.jwt_token = t.jwtToken
      const r = await this.http(`${SERPRO_URLS[this.cfg.ambiente]}/${rota}`, cabecalhos, corpo, false)
      if (r.status === 401 && tentativa === 1 && this.cfg.ambiente === 'producao') continue
      const resposta = interpretarResposta<T>(r.status, r.corpo)
      if (!resposta.ok) throw new ErroSerpro(explicarFalha(resposta, r.corpo), r.status, resposta.mensagens)
      return resposta
    }
  }

  /** PGDASD/GERARDAS12 — DAS do período de uma declaração já transmitida. */
  async gerarDas(contribuinte: string, periodo: string, dataConsolidacao?: string): Promise<DasGerado> {
    const dados: Record<string, unknown> = { periodoApuracao: periodoSerpro(periodo) }
    if (dataConsolidacao) dados.dataConsolidacao = dataConsolidacao.replace(/-/g, '')
    return lerDasGerado((await this.chamar('Emitir', contribuinte, 'PGDASD', 'GERARDAS12', dados)).dados)
  }

  /** PGDASD/CONSULTIMADECREC14 — última declaração e recibo do período. */
  async ultimaDeclaracao(contribuinte: string, periodo: string): Promise<DeclaracaoPgdasd> {
    return lerUltimaDeclaracao((await this.chamar('Consultar', contribuinte, 'PGDASD', 'CONSULTIMADECREC14', { periodoApuracao: periodoSerpro(periodo) })).dados)
  }

  /**
   * DCTFWEB — documento de arrecadação (DARF). Com o número do recibo, é a guia da declaração
   * transmitida (GERARGUIA31); sem ele, a da declaração em andamento (GERARGUIAANDAMENTO313).
   */
  async gerarDarfDctfweb(contribuinte: string, periodo: string, numeroReciboEntrega?: number, categoria = 'GERAL_MENSAL'): Promise<Buffer> {
    const [anoPA, mesPA] = periodoSerpro(periodo).match(/^(\d{4})(\d{2})$/)!.slice(1)
    const dados: Record<string, unknown> = { categoria, anoPA, mesPA }
    if (numeroReciboEntrega) dados.numeroReciboEntrega = numeroReciboEntrega
    const servico = numeroReciboEntrega ? 'GERARGUIA31' : 'GERARGUIAANDAMENTO313'
    return lerDarfGerado((await this.chamar('Emitir', contribuinte, 'DCTFWEB', servico, dados)).dados)
  }

  /**
   * PAGTOWEB/PAGAMENTOS71 — documentos de arrecadação pagos, procurados pelo número (até 100 por
   * chamada). Uma consulta só responde por todas as guias em aberto.
   */
  async pagamentosDosDocumentos(contribuinte: string, numeros: string[]): Promise<PagamentoReceita[]> {
    const lista = [...new Set(numeros.map((n) => n.replace(/\D/g, '')).filter((n) => n.length > 0 && n.length <= 17))].slice(0, 100)
    if (!lista.length) return []
    const r = await this.chamar('Consultar', contribuinte, 'PAGTOWEB', 'PAGAMENTOS71', { numeroDocumentoLista: lista, primeiroDaPagina: 0, tamanhoDaPagina: 100 })
    return lerPagamentos(r.dados)
  }

  /**
   * CAIXAPOSTAL/MSGCONTRIBUINTE61 — cabeçalhos das mensagens mais recentes (até 50).
   * De propósito NÃO existe aqui o MSGDETALHAMENTO62: abrir o detalhe pela API caracteriza ciência
   * da intimação (Decreto 70.235/1972, art. 23, § 2º, III). Ler o conteúdo é decisão de quem
   * responde pela empresa, no e-CAC.
   */
  async caixaPostal(contribuinte: string): Promise<CaixaPostal> {
    const r = await this.chamar('Consultar', contribuinte, 'CAIXAPOSTAL', 'MSGCONTRIBUINTE61', { statusLeitura: '0', indicadorPagina: '0' })
    return lerCaixaPostal(r.dados)
  }

  /**
   * SITFIS — relatório de situação fiscal em PDF. É assíncrono: pede-se o protocolo
   * (SOLICITARPROTOCOLO91), espera-se o tempo indicado e emite-se (RELATORIOSITFIS92), que pode
   * responder 202 pedindo mais espera.
   */
  async relatorioSituacaoFiscal(contribuinte: string, esperar: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms))): Promise<Buffer> {
    const pedido = await this.chamar<{ protocoloRelatorio?: string; tempoEspera?: number }>('Apoiar', contribuinte, 'SITFIS', 'SOLICITARPROTOCOLO91', null, '2.0')
    const protocolo = pedido.dados?.protocoloRelatorio
    if (!protocolo) throw new ErroSerpro('A Receita não devolveu o protocolo do relatório de situação fiscal. Tente de novo em alguns minutos.', pedido.httpStatus, pedido.mensagens)
    let espera = Math.min(Math.max(pedido.dados?.tempoEspera ?? 2000, 1000), 15_000)
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      await esperar(espera)
      const r = await this.chamar<{ pdf?: string; tempoEspera?: number }>('Emitir', contribuinte, 'SITFIS', 'RELATORIOSITFIS92', { protocoloRelatorio: protocolo }, '2.0')
      if (r.dados?.pdf) return Buffer.from(r.dados.pdf, 'base64')
      espera = Math.min(Math.max(r.dados?.tempoEspera ?? 4000, 1000), 15_000)
    }
    throw new ErroSerpro('O relatório de situação fiscal ainda não ficou pronto na Receita. Tente de novo em alguns minutos.')
  }

  encerrar(): void {
    this.agente?.destroy()
    this.agente = undefined
  }
}
