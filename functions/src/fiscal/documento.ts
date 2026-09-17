/**
 * Leitura dos documentos que a SEFAZ devolve no lote do NFeDistribuicaoDFe.
 *
 * A NT 2014.002 (item 3.2, campo B13) diz que o atributo `schema` do docZip identifica o tipo e a
 * versão do documento. São quatro formatos possíveis:
 *   resNFe_v*.xsd          resumo da NF-e (item 3.11.1)
 *   procNFe_v*.xsd         NF-e completa com o protocolo de autorização
 *   resEvento_v*.xsd       resumo de evento (item 3.11.2)
 *   procEventoNFe_v*.xsd   evento completo
 *
 * Nada aqui inventa campo: os nomes vêm dos leiautes citados e do leiaute da NF-e 4.00.
 */
import { caminho, descendente, filho, filhos, numeroFilho, textoFilho, type NoXml } from './xml'
import type { ProdutoNota, StatusNota } from './modelo'

export type TipoDocumentoFiscal = 'nfe' | 'resumo_nfe' | 'evento' | 'resumo_evento' | 'desconhecido'

export interface DadosNotaLidos {
  chaveAcesso: string
  numero?: string
  serie?: string
  modelo?: string
  naturezaOperacao?: string
  tipoOperacao?: string
  dataEmissao?: Date
  cnpjEmitente?: string
  razaoSocialEmitente?: string
  ieEmitente?: string
  ufEmitente?: string
  cnpjDestinatario?: string
  razaoSocialDestinatario?: string
  valorTotal?: number
  protocolo?: string
  dataAutorizacao?: Date
  status: StatusNota
  produtos?: ProdutoNota[]
}

export interface DadosEventoLidos {
  chaveAcesso: string
  tpEvento: string
  descricao: string
  nSeqEvento: string
  dataEvento?: Date
  protocolo?: string
  cnpjAutor?: string
}

export interface DocumentoLido {
  tipo: TipoDocumentoFiscal
  chaveAcesso?: string
  nota?: DadosNotaLidos
  evento?: DadosEventoLidos
}

/** Eventos da NF-e mais comuns na distribuição (códigos do MOC / notas técnicas citadas na NT). */
const EVENTOS: Record<string, string> = {
  '110110': 'Carta de Correção',
  '110111': 'Cancelamento',
  '110112': 'Cancelamento por substituição',
  '110140': 'EPEC',
  '110150': 'Ator interessado na NF-e',
  '210200': 'Confirmação da Operação',
  '210210': 'Ciência da Operação',
  '210220': 'Desconhecimento da Operação',
  '210240': 'Operação não Realizada',
  '610600': 'Averbação',
}

export const descreverEvento = (tpEvento: string, xEvento?: string): string =>
  xEvento?.trim() || EVENTOS[tpEvento] || `Evento ${tpEvento}`

/** Descobre o tipo pelo atributo `schema`; se ele vier vazio, cai para a tag raiz do XML. */
export function tipoPeloSchema(schema: string, raiz?: NoXml): TipoDocumentoFiscal {
  const s = (schema ?? '').toLowerCase()
  if (s.startsWith('resnfe')) return 'resumo_nfe'
  if (s.startsWith('procnfe')) return 'nfe'
  if (s.startsWith('resevento')) return 'resumo_evento'
  if (s.startsWith('proceventonfe')) return 'evento'
  switch (raiz?.nome) {
    case 'resnfe':
      return 'resumo_nfe'
    case 'nfeproc':
      return 'nfe'
    case 'resevento':
      return 'resumo_evento'
    case 'proceventonfe':
      return 'evento'
    default:
      return 'desconhecido'
  }
}

const soDigitos = (v?: string) => (v ? v.replace(/[^0-9A-Za-z]/g, '') : undefined)

/** Datas da NF-e vêm em UTC no formato AAAA-MM-DDThh:mm:ssTZD; dEmi antigo vem só com a data. */
function paraData(valor?: string): Date | undefined {
  if (!valor) return undefined
  const texto = valor.trim()
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(texto) ? `${texto}T12:00:00-03:00` : texto)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Chave de acesso do procNFe: atributo Id do infNFe ("NFe" + 44 dígitos). */
function chaveDoInfNFe(infNFe?: NoXml): string | undefined {
  const id = infNFe?.atributos.id ?? ''
  const so = id.replace(/\D/g, '')
  return so.length === 44 ? so : undefined
}

const cnpjOuCpf = (no?: NoXml) => soDigitos(textoFilho(no, 'cnpj') ?? textoFilho(no, 'cpf'))

/** Situação da NF-e informada no resumo (campo cSitNFe, item 3.11.1). */
function statusDoResumo(cSitNFe?: string): StatusNota {
  switch (cSitNFe) {
    case '2':
      return 'denegada'
    case '3':
      return 'cancelada'
    default:
      return 'resumo'
  }
}

function lerProdutos(infNFe?: NoXml): ProdutoNota[] | undefined {
  const itens = filhos(infNFe, 'det')
  if (itens.length === 0) return undefined
  return itens.map((det) => {
    const prod = filho(det, 'prod')
    return {
      codigo: textoFilho(prod, 'cprod'),
      descricao: textoFilho(prod, 'xprod') ?? '',
      ncm: textoFilho(prod, 'ncm'),
      cfop: textoFilho(prod, 'cfop'),
      unidade: textoFilho(prod, 'ucom'),
      quantidade: numeroFilho(prod, 'qcom'),
      valorUnitario: numeroFilho(prod, 'vuncom'),
      valorTotal: numeroFilho(prod, 'vprod'),
    }
  })
}

/** Lê um XML já descompactado do lote e devolve os dados que guardamos no Firestore. */
export function lerDocumento(xml: string, schema: string, raiz: NoXml): DocumentoLido {
  const tipo = tipoPeloSchema(schema, raiz)

  if (tipo === 'resumo_nfe') {
    const chave = soDigitos(textoFilho(raiz, 'chnfe'))
    if (!chave) return { tipo: 'desconhecido' }
    return {
      tipo,
      chaveAcesso: chave,
      nota: {
        chaveAcesso: chave,
        numero: String(Number(chave.slice(25, 34))),
        serie: String(Number(chave.slice(22, 25))),
        modelo: chave.slice(20, 22),
        cnpjEmitente: cnpjOuCpf(raiz),
        razaoSocialEmitente: textoFilho(raiz, 'xnome'),
        ieEmitente: textoFilho(raiz, 'ie'),
        ufEmitente: ufPelaChave(chave),
        dataEmissao: paraData(textoFilho(raiz, 'dhemi')),
        tipoOperacao: textoFilho(raiz, 'tpnf'),
        valorTotal: numeroFilho(raiz, 'vnf'),
        protocolo: textoFilho(raiz, 'nprot'),
        dataAutorizacao: paraData(textoFilho(raiz, 'dhrecbto')),
        status: statusDoResumo(textoFilho(raiz, 'csitnfe')),
      },
    }
  }

  if (tipo === 'nfe') {
    const infNFe = caminho(raiz, 'nfe', 'infnfe') ?? descendente(raiz, 'infnfe')
    const chave = chaveDoInfNFe(infNFe)
    if (!chave) return { tipo: 'desconhecido' }
    const ide = filho(infNFe, 'ide')
    const emit = filho(infNFe, 'emit')
    const dest = filho(infNFe, 'dest')
    const infProt = descendente(filho(raiz, 'protnfe'), 'infprot')
    const total = descendente(filho(infNFe, 'total'), 'icmstot')
    const cStat = textoFilho(infProt, 'cstat')
    return {
      tipo,
      chaveAcesso: chave,
      nota: {
        chaveAcesso: chave,
        numero: textoFilho(ide, 'nnf'),
        serie: textoFilho(ide, 'serie'),
        modelo: textoFilho(ide, 'mod') ?? chave.slice(20, 22),
        naturezaOperacao: textoFilho(ide, 'natop'),
        tipoOperacao: textoFilho(ide, 'tpnf'),
        dataEmissao: paraData(textoFilho(ide, 'dhemi') ?? textoFilho(ide, 'demi')),
        cnpjEmitente: cnpjOuCpf(emit),
        razaoSocialEmitente: textoFilho(emit, 'xnome'),
        ieEmitente: textoFilho(emit, 'ie'),
        ufEmitente: textoFilho(filho(emit, 'enderemit'), 'uf') ?? ufPelaChave(chave),
        cnpjDestinatario: cnpjOuCpf(dest),
        razaoSocialDestinatario: textoFilho(dest, 'xnome'),
        valorTotal: numeroFilho(total, 'vnf'),
        protocolo: textoFilho(infProt, 'nprot'),
        dataAutorizacao: paraData(textoFilho(infProt, 'dhrecbto')),
        // 100 = autorizado, 110/301/302 = denegado (leiaute da NF-e 4.00)
        status: cStat === '110' || cStat === '301' || cStat === '302' ? 'denegada' : 'autorizada',
        produtos: lerProdutos(infNFe),
      },
    }
  }

  if (tipo === 'resumo_evento' || tipo === 'evento') {
    const base = tipo === 'resumo_evento' ? raiz : (descendente(raiz, 'infevento') ?? raiz)
    const chave = soDigitos(textoFilho(base, 'chnfe'))
    if (!chave) return { tipo: 'desconhecido' }
    const tpEvento = textoFilho(base, 'tpevento') ?? ''
    const infProt = descendente(filho(raiz, 'retevento'), 'infevento')
    return {
      tipo,
      chaveAcesso: chave,
      evento: {
        chaveAcesso: chave,
        tpEvento,
        descricao: descreverEvento(tpEvento, textoFilho(base, 'xevento') ?? textoFilho(infProt, 'xevento')),
        nSeqEvento: textoFilho(base, 'nseqevento') ?? '1',
        dataEvento: paraData(textoFilho(base, 'dhevento')),
        protocolo: textoFilho(base, 'nprot') ?? textoFilho(infProt, 'nprot'),
        cnpjAutor: cnpjOuCpf(base),
      },
    }
  }

  return { tipo: 'desconhecido' }
}

/** UF do emitente pelos 2 primeiros dígitos da chave (código IBGE). */
export function ufPelaChave(chave: string): string | undefined {
  const mapa: Record<string, string> = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
  }
  return mapa[chave.slice(0, 2)]
}

/** Cancelamento (110111) e cancelamento por substituição (110112) derrubam a nota. */
export const eventoCancelaNota = (tpEvento: string): boolean => tpEvento === '110111' || tpEvento === '110112'
