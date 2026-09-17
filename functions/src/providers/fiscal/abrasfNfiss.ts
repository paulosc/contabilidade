/**
 * Adapter do web service municipal de NFS-e no padrão ABRASF 2.02 (plataforma SH3 / nfiss).
 *
 * O WSDL é `document/literal` e o envelope carrega dois parâmetros de texto:
 *   nfseCabecMsg  → <cabecalho versao="2.02"><versaoDados>2.02</versaoDados></cabecalho>
 *   nfseDadosMsg  → o XML da consulta propriamente dita
 *
 * Ambos vão como string dentro do elemento, em CDATA — é o formato que o contrato descreve
 * (`type="xsd:string"`) e o que os exemplos oficiais do município mostram.
 *
 * A resposta vem em `outputXML`, também como texto com o XML de retorno dentro.
 */
import { Agent, request as httpsRequest } from 'node:https'
import { gunzipSync, inflateSync } from 'node:zlib'
import { analisarXml, descendente, escaparXml, filhos, numeroFilho, textoFilho, type NoXml } from '../../fiscal/xml'
import {
  ABRASF_NS_DADOS,
  ABRASF_NS_SERVICO,
  ABRASF_VERSAO,
  dataAbrasf,
  type AbrasfProvider,
  type CredenciaisAbrasf,
  type NotaAbrasf,
  type RespostaConsultaAbrasf,
} from './AbrasfProvider'

const TIMEOUT_MS = 90_000

export class AbrasfNfissProvider implements AbrasfProvider {
  readonly nome = 'abrasf-nfiss'
  private agente?: Agent
  private readonly timeoutMs: number

  constructor(private readonly cfg: CredenciaisAbrasf, opcoes: { timeoutMs?: number } = {}) {
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

  private get url(): string {
    return this.cfg.endpoint || `https://${this.cfg.host}/soap/`
  }

  private http(corpo: string, acao: string): Promise<{ status: number; corpo: string }> {
    const url = new URL(this.url)
    const dados = Buffer.from(corpo, 'utf8')
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Content-Length': String(dados.byteLength),
            SOAPAction: `"${ABRASF_NS_SERVICO}/${acao}"`,
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
            const cod = String(res.headers['content-encoding'] ?? '').toLowerCase()
            try {
              if (cod.includes('gzip')) bruto = gunzipSync(bruto)
              else if (cod.includes('deflate')) bruto = inflateSync(bruto)
            } catch {
              // veio sem compactação apesar do cabeçalho
            }
            resolve({ status: res.statusCode ?? 0, corpo: bruto.toString('utf8') })
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error(`O município não respondeu em ${this.timeoutMs / 1000}s`)))
      req.on('error', reject)
      req.write(dados)
      req.end()
    })
  }

  /** Identificação do prestador, comum às duas consultas. */
  private prestador(): string {
    const doc = this.cfg.documento.replace(/\D/g, '')
    const cpfCnpj = doc.length === 11 ? `<Cpf>${doc}</Cpf>` : `<Cnpj>${doc}</Cnpj>`
    const im = this.cfg.inscricaoMunicipal?.trim()
    return `<CpfCnpj>${cpfCnpj}</CpfCnpj>${im ? `<InscricaoMunicipal>${escaparXml(im)}</InscricaoMunicipal>` : ''}`
  }

  private async consultar(operacao: 'ConsultarNfseServicoPrestado' | 'ConsultarNfseServicoTomado', de: Date, ate: Date, pagina: number) {
    const inicio = Date.now()
    // no ABRASF 2.02 a consulta por tomado identifica a empresa em <Tomador>, e a por prestado
    // em <Prestador>; o restante do leiaute é o mesmo
    const quem = operacao === 'ConsultarNfseServicoPrestado' ? 'Prestador' : 'Tomador'
    const dados =
      `<${operacao}Envio xmlns="${ABRASF_NS_DADOS}">` +
      `<${quem}>${this.prestador()}</${quem}>` +
      `<PeriodoEmissao><DataInicial>${dataAbrasf(de)}</DataInicial><DataFinal>${dataAbrasf(ate)}</DataFinal></PeriodoEmissao>` +
      `<Pagina>${Math.max(1, pagina)}</Pagina>` +
      `</${operacao}Envio>`

    const cabecalho = `<cabecalho xmlns="${ABRASF_NS_DADOS}" versao="${ABRASF_VERSAO}"><versaoDados>${ABRASF_VERSAO}</versaoDados></cabecalho>`

    const envelope =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soap:Body>' +
      `<${operacao}Request xmlns="${ABRASF_NS_SERVICO}">` +
      `<nfseCabecMsg><![CDATA[${cabecalho}]]></nfseCabecMsg>` +
      `<nfseDadosMsg><![CDATA[${dados}]]></nfseDadosMsg>` +
      `</${operacao}Request>` +
      '</soap:Body></soap:Envelope>'

    const r = await this.http(envelope, operacao)
    if (r.status === 403) {
      throw new Error(
        'O município recusou a conexão (HTTP 403). Normalmente o certificado ainda não foi liberado para web service no cadastro do portal.',
      )
    }
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`O município respondeu HTTP ${r.status}${falhaSoap(r.corpo) ? `: ${falhaSoap(r.corpo)}` : ''}`)
    }
    return { ...interpretarResposta(r.corpo), duracaoMs: Date.now() - inicio }
  }

  consultarPrestadas(de: Date, ate: Date, pagina: number): Promise<RespostaConsultaAbrasf> {
    return this.consultar('ConsultarNfseServicoPrestado', de, ate, pagina)
  }

  consultarTomadas(de: Date, ate: Date, pagina: number): Promise<RespostaConsultaAbrasf> {
    return this.consultar('ConsultarNfseServicoTomado', de, ate, pagina)
  }
}

// ---------- leitura da resposta ----------

export function falhaSoap(corpo: string): string | undefined {
  try {
    const falha = descendente(analisarXml(corpo), 'fault')
    if (!falha) return undefined
    return textoFilho(falha, 'faultstring') ?? (falha.texto.trim() || undefined)
  } catch {
    return undefined
  }
}

const soDigitos = (v?: string) => (v ? v.replace(/\D/g, '') : undefined)

function paraData(valor?: string): Date | undefined {
  if (!valor) return undefined
  const t = valor.trim()
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T12:00:00-03:00` : t)
  return Number.isNaN(d.getTime()) ? undefined : d
}

const cpfCnpjDe = (no?: NoXml) => {
  const ident = descendente(no, 'cpfcnpj')
  return soDigitos(textoFilho(ident, 'cnpj') ?? textoFilho(ident, 'cpf'))
}

/** Recorta o XML original de um bloco, para guardar o documento como veio. */
function recortarBloco(corpo: string, tag: string, ocorrencia: number): string | undefined {
  const abre = new RegExp(`<([\\w]+:)?${tag}[\\s>]`, 'g')
  let m: RegExpExecArray | null
  let encontrada = 0
  while ((m = abre.exec(corpo))) {
    if (encontrada++ !== ocorrencia) continue
    const prefixo = m[1] ?? ''
    const fecha = corpo.indexOf(`</${prefixo}${tag}>`, m.index)
    if (fecha < 0) return undefined
    return corpo.slice(m.index, fecha + `</${prefixo}${tag}>`.length)
  }
  return undefined
}

/**
 * Lê o retorno da consulta. O XML de resposta vem embrulhado em `outputXML` como texto, então
 * primeiro desembrulhamos e depois lemos o `ListaNfse`.
 */
export function interpretarResposta(corpoSoap: string): Omit<RespostaConsultaAbrasf, 'duracaoMs'> {
  const raiz = analisarXml(corpoSoap)
  // o conteúdo de outputXML já vem com as entidades expandidas pelo leitor de XML
  const interno = descendente(raiz, 'outputxml')?.texto?.trim()
  const alvoTexto = interno && interno.includes('<') ? interno : corpoSoap
  const alvo = interno && interno.includes('<') ? analisarXml(interno) : raiz

  const mensagens: string[] = []
  for (const m of [...filhos(descendente(alvo, 'listamensagemretorno'), 'mensagemretorno'), ...(descendente(alvo, 'mensagemretorno') ? [descendente(alvo, 'mensagemretorno')!] : [])]) {
    const codigo = textoFilho(m, 'codigo')
    const texto = textoFilho(m, 'mensagem') ?? textoFilho(m, 'correcao')
    const linha = [codigo, texto].filter(Boolean).join(' — ')
    if (linha && !mensagens.includes(linha)) mensagens.push(linha)
  }

  const lista = descendente(alvo, 'listanfse')
  const comps = filhos(lista, 'compnfse')
  const notas: NotaAbrasf[] = []

  comps.forEach((comp, indice) => {
    const infNfse = descendente(comp, 'infnfse')
    const numero = textoFilho(infNfse, 'numero')
    if (!numero) return

    const valoresNfse = descendente(infNfse, 'valoresnfse')
    const decl = descendente(infNfse, 'infdeclaracaoprestacaoservico')
    const rps = descendente(decl, 'identificacaorps')
    const servico = descendente(decl, 'servico')
    const valoresServico = descendente(servico, 'valores')
    const prestadorServico = descendente(infNfse, 'prestadorservico')
    const tomador = descendente(decl, 'tomador')

    notas.push({
      numero,
      codigoVerificacao: textoFilho(infNfse, 'codigoverificacao'),
      dataEmissao: paraData(textoFilho(infNfse, 'dataemissao')),
      competencia: textoFilho(decl, 'competencia')?.slice(0, 7),
      // o bloco de cancelamento só aparece quando a nota foi cancelada
      cancelada: Boolean(descendente(comp, 'nfsecancelamento')),
      numeroRps: textoFilho(rps, 'numero'),
      serieRps: textoFilho(rps, 'serie'),
      cnpjPrestador: cpfCnpjDe(descendente(prestadorServico, 'identificacaoprestador')) ?? cpfCnpjDe(descendente(decl, 'prestador')),
      razaoSocialPrestador: textoFilho(prestadorServico, 'razaosocial'),
      inscricaoMunicipalPrestador: textoFilho(descendente(prestadorServico, 'identificacaoprestador'), 'inscricaomunicipal'),
      cnpjTomador: cpfCnpjDe(descendente(tomador, 'identificacaotomador')),
      razaoSocialTomador: textoFilho(tomador, 'razaosocial'),
      discriminacao: textoFilho(servico, 'discriminacao'),
      itemListaServico: textoFilho(servico, 'itemlistaservico'),
      codigoTributacaoMunicipio: textoFilho(servico, 'codigotributacaomunicipio'),
      codigoMunicipio: textoFilho(servico, 'codigomunicipio'),
      valorServicos: numeroFilho(valoresServico, 'valorservicos'),
      baseCalculo: numeroFilho(valoresNfse, 'basecalculo'),
      aliquota: numeroFilho(valoresNfse, 'aliquota'),
      valorIss: numeroFilho(valoresNfse, 'valoriss'),
      valorLiquido: numeroFilho(valoresNfse, 'valorliquidonfse'),
      xml: recortarBloco(alvoTexto, 'CompNfse', indice) ?? alvoTexto,
    })
  })

  // O ABRASF 2.02 devolve até 50 notas por página; página cheia significa que pode haver mais.
  return { notas, temMaisPaginas: notas.length >= 50, mensagens }
}
