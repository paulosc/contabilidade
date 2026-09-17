/**
 * Leitura do XML da NFS-e do padrão nacional.
 *
 * Leiaute oficial: pacote "NFSe-ESQUEMAS_XSD" v1.01 (09/02/2026) do Portal Nacional da NFS-e —
 * `NFSe_v1.01.xsd` e `tiposComplexos_v1.01.xsd`, namespace `http://www.sped.fazenda.gov.br/nfse`.
 *
 * Estrutura que interessa (nomes conforme o XSD):
 *   NFSe > infNFSe            @Id = "NFS" + chave de 50 dígitos
 *     nNFSe, dhProc, cStat, ambGer, nDFSe, xLocEmi, xLocPrestacao
 *     emit                    prestador: CNPJ/CPF, IM, xNome, xFant
 *     valores                 vBC, pAliqAplic, vISSQN, vTotalRet, vLiq
 *     DPS > infDPS            dhEmi, serie, nDPS, dCompet, tpEmit, cLocEmi
 *       prest                 prestador declarado na DPS
 *       toma                  tomador: CNPJ/CPF/NIF, IM, xNome
 *       serv > cServ          cTribNac, cTribMun, xDescServ, cNBS
 *       valores > vServPrest  vServ, vReceb
 */
import { caminho, descendente, filho, numeroFilho, textoFilho, type NoXml } from './xml'
import { lerChaveNfse } from '../providers/fiscal/AdnContribuintesProvider'

export type TipoDocumentoServico = 'nfse' | 'evento' | 'desconhecido'

export interface DadosNotaServicoLidos {
  chaveAcesso: string
  numero?: string
  /** Série e número da DPS que originou a NFS-e */
  serieDps?: string
  numeroDps?: string
  dataEmissao?: Date
  dataProcessamento?: Date
  /** Competência no formato YYYY-MM */
  competencia?: string
  situacao?: string
  ambienteGerador?: string
  municipioEmissao?: string
  municipioPrestacao?: string
  codigoMunicipio?: string
  cnpjPrestador?: string
  razaoSocialPrestador?: string
  inscricaoMunicipalPrestador?: string
  cnpjTomador?: string
  razaoSocialTomador?: string
  descricaoServico?: string
  codigoTributacaoNacional?: string
  codigoTributacaoMunicipal?: string
  /** Valor do serviço prestado (DPS > valores > vServPrest > vServ) */
  valorServico?: number
  /** Base de cálculo, alíquota e ISSQN (infNFSe > valores) */
  baseCalculo?: number
  aliquota?: number
  valorIss?: number
  valorRetencoes?: number
  /** Valor líquido da NFS-e */
  valorLiquido?: number
}

export interface DadosEventoServicoLidos {
  chaveAcesso: string
  tipoEvento: string
  descricao: string
  numeroSequencial: string
  dataEvento?: Date
}

export interface DocumentoServicoLido {
  tipo: TipoDocumentoServico
  chaveAcesso?: string
  nota?: DadosNotaServicoLidos
  evento?: DadosEventoServicoLidos
}

/** Situações possíveis da NFS-e (tipo TStat do leiaute nacional). */
const SITUACOES: Record<string, string> = {
  '100': 'NFS-e Gerada',
  '102': 'NFS-e de Decisão Judicial',
  '103': 'NFS-e Avulsa',
  '107': 'NFS-e MEI',
}

/** Eventos da NFS-e nacional mais comuns. */
const EVENTOS: Record<string, string> = {
  '101101': 'Cancelamento de NFS-e',
  '101103': 'Cancelamento por substituição',
  '105102': 'Cancelamento por ofício',
  '202201': 'Confirmação do prestador',
  '203201': 'Confirmação do tomador',
  '204201': 'Confirmação do intermediário',
  '205201': 'Rejeição do tomador',
  '206201': 'Rejeição do intermediário',
}

const soDigitos = (v?: string) => (v ? v.replace(/\D/g, '') : undefined)

function paraData(valor?: string): Date | undefined {
  if (!valor) return undefined
  const t = valor.trim()
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T12:00:00-03:00` : t)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Chave de acesso a partir do atributo Id do infNFSe: "NFS" + 50 dígitos. */
function chaveDoInfNFSe(infNFSe?: NoXml): string | undefined {
  const id = infNFSe?.atributos.id ?? ''
  const so = id.replace(/\D/g, '')
  return so.length === 50 ? so : undefined
}

const cnpjOuCpf = (no?: NoXml) => soDigitos(textoFilho(no, 'cnpj') ?? textoFilho(no, 'cpf'))

/** Descobre o tipo pela raiz do XML. */
export function tipoDoDocumentoServico(raiz?: NoXml): TipoDocumentoServico {
  switch (raiz?.nome) {
    case 'nfse':
      return 'nfse'
    case 'evento':
    case 'proceventonfse':
      return 'evento'
    default:
      return descendente(raiz, 'infnfse') ? 'nfse' : descendente(raiz, 'infevento') ? 'evento' : 'desconhecido'
  }
}

/** Lê um DF-e de serviço vindo do ADN. */
export function lerDocumentoServico(raiz: NoXml): DocumentoServicoLido {
  const tipo = tipoDoDocumentoServico(raiz)

  if (tipo === 'nfse') {
    const infNFSe = descendente(raiz, 'infnfse')
    const chave = chaveDoInfNFSe(infNFSe)
    if (!chave) return { tipo: 'desconhecido' }

    const emit = filho(infNFSe, 'emit')
    const valoresNfse = filho(infNFSe, 'valores')
    const infDPS = caminho(infNFSe, 'dps', 'infdps')
    const toma = filho(infDPS, 'toma')
    const cServ = caminho(infDPS, 'serv', 'cserv')
    const vServPrest = caminho(infDPS, 'valores', 'vservprest')
    const daChave = lerChaveNfse(chave)
    const cStat = textoFilho(infNFSe, 'cstat')
    const dCompet = textoFilho(infDPS, 'dcompet')

    return {
      tipo,
      chaveAcesso: chave,
      nota: {
        chaveAcesso: chave,
        numero: textoFilho(infNFSe, 'nnfse') ?? daChave?.numero,
        serieDps: textoFilho(infDPS, 'serie'),
        numeroDps: textoFilho(infDPS, 'ndps'),
        dataEmissao: paraData(textoFilho(infDPS, 'dhemi')),
        dataProcessamento: paraData(textoFilho(infNFSe, 'dhproc')),
        competencia: dCompet ? dCompet.slice(0, 7) : daChave?.competencia,
        situacao: cStat ? (SITUACOES[cStat] ?? `Situação ${cStat}`) : undefined,
        ambienteGerador: textoFilho(infNFSe, 'ambger'),
        municipioEmissao: textoFilho(infNFSe, 'xlocemi'),
        municipioPrestacao: textoFilho(infNFSe, 'xlocprestacao'),
        codigoMunicipio: daChave?.codigoMunicipio,
        cnpjPrestador: cnpjOuCpf(emit),
        razaoSocialPrestador: textoFilho(emit, 'xnome'),
        inscricaoMunicipalPrestador: textoFilho(emit, 'im'),
        cnpjTomador: cnpjOuCpf(toma),
        razaoSocialTomador: textoFilho(toma, 'xnome'),
        descricaoServico: textoFilho(cServ, 'xdescserv'),
        codigoTributacaoNacional: textoFilho(cServ, 'ctribnac'),
        codigoTributacaoMunicipal: textoFilho(caminho(cServ, 'ctribmun'), 'ctribmun') ?? textoFilho(cServ, 'ctribmun'),
        valorServico: numeroFilho(vServPrest, 'vserv'),
        baseCalculo: numeroFilho(valoresNfse, 'vbc'),
        aliquota: numeroFilho(valoresNfse, 'paliqaplic'),
        valorIss: numeroFilho(valoresNfse, 'vissqn'),
        valorRetencoes: numeroFilho(valoresNfse, 'vtotalret'),
        valorLiquido: numeroFilho(valoresNfse, 'vliq'),
      },
    }
  }

  if (tipo === 'evento') {
    const infEvento = descendente(raiz, 'infevento')
    const chave = soDigitos(textoFilho(infEvento, 'chnfse') ?? textoFilho(infEvento, 'chaveacesso'))
    if (!chave || chave.length !== 50) return { tipo: 'desconhecido' }
    const tpEvento = textoFilho(infEvento, 'tpevento') ?? ''
    return {
      tipo,
      chaveAcesso: chave,
      evento: {
        chaveAcesso: chave,
        tipoEvento: tpEvento,
        descricao: textoFilho(infEvento, 'xevento') ?? EVENTOS[tpEvento] ?? `Evento ${tpEvento}`,
        numeroSequencial: textoFilho(infEvento, 'nseqevento') ?? '1',
        dataEvento: paraData(textoFilho(infEvento, 'dhevento')),
      },
    }
  }

  return { tipo: 'desconhecido' }
}

/** Eventos que derrubam a NFS-e. */
export const eventoCancelaNfse = (tipoEvento: string): boolean =>
  tipoEvento === '101101' || tipoEvento === '101103' || tipoEvento === '105102'
