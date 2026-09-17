/**
 * DPS — Declaração de Prestação de Serviços — e pedidos de registro de evento da NFS-e nacional.
 *
 * Tudo aqui segue o leiaute oficial v1.01 (NFSe-ESQUEMAS_XSD-v1.01-20260209 e Anexo I do
 * SEFIN/ADN): ordem dos elementos, identificadores e domínios dos códigos. A ordem importa —
 * o SEFIN valida contra o XSD (E1235) — por isso o XML é montado de um modelo tipado, nunca
 * por recorte de texto.
 *
 * "Gerar uma nota igual": o DPS original vem embutido no XML de toda NFS-e nacional
 * (NFSe/infNFSe/DPS). `lerDpsDeNfse` traz esse DPS para o modelo; a tela ajusta o que muda
 * (competência, valor, descrição) e `montarDps` remonta o XML já com numeração nova.
 */
import { analisarXml, caminho, filho, textoFilho, type NoXml } from './xml'

export const VERSAO_LEIAUTE = '1.01'
export const NAMESPACE_NFSE = 'http://www.sped.fazenda.gov.br/nfse'
/** Versão do aplicativo (tag verAplic): até 20 caracteres */
export const VER_APLIC = 'Contabilidade_1.0'

export type AmbienteNfse = 'producao' | 'homologacao'

export interface EnderecoDps {
  /** Código IBGE, 7 dígitos (endereço nacional) */
  codigoMunicipio?: string
  cep?: string
  /** Endereço no exterior */
  codigoPais?: string
  codigoPostalExterior?: string
  cidadeExterior?: string
  estadoExterior?: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
}

export interface PessoaDps {
  cnpj?: string
  cpf?: string
  nif?: string
  /** Motivo de não informar NIF (tomador no exterior sem NIF) */
  cNaoNIF?: string
  caepf?: string
  inscricaoMunicipal?: string
  nome?: string
  endereco?: EnderecoDps
  fone?: string
  email?: string
}

export interface RegimeTributario {
  /** 1 - Não optante; 2 - MEI; 3 - ME/EPP */
  opSimpNac: string
  regApTribSN?: string
  /** 0 - Nenhum … 9 - Outros */
  regEspTrib: string
}

export interface Substituicao {
  chaveSubstituida: string
  /** 01, 02, 03, 04, 05 ou 99 (TSCodJustSubst) */
  motivo: string
  /** 15 a 255 caracteres, quando informada */
  descricao?: string
}

export interface PisCofinsDps {
  cst: string
  vBCPisCofins?: string
  pAliqPis?: string
  pAliqCofins?: string
  vPis?: string
  vCofins?: string
  tpRetPisCofins?: string
}

export interface DadosDps {
  ambiente: AmbienteNfse
  /** AAAA-MM-DDThh:mm:ss±hh:mm — hora local com o fuso */
  dhEmi: string
  verAplic?: string
  /** 1 a 5 dígitos */
  serie: string
  /** 1 a 15 dígitos, sem zeros à esquerda */
  numero: string
  /** AAAA-MM-DD */
  competencia: string
  /** 1 - Prestador; 2 - Tomador; 3 - Intermediário */
  tpEmit: string
  codigoMunicipioEmissao: string
  substituicao?: Substituicao
  prestador: PessoaDps & { regime: RegimeTributario }
  tomador?: PessoaDps
  intermediario?: PessoaDps
  servico: {
    codigoMunicipioPrestacao?: string
    codigoPaisPrestacao?: string
    /** 6 dígitos: item, subitem e desdobro (LC 116/2003) */
    cTribNac: string
    cTribMun?: string
    descricao: string
    cNBS?: string
    cIntContrib?: string
    infoCompl?: { idDocTec?: string; docRef?: string; xInfComp?: string }
  }
  valores: {
    vServ: string
    vReceb?: string
    vDescIncond?: string
    vDescCond?: string
    tribMun: {
      /** 1 - Tributável; 2 - Imunidade; 3 - Exportação; 4 - Não incidência */
      tribISSQN: string
      cPaisResult?: string
      tpImunidade?: string
      /** 1 - Não retido; 2 - Retido pelo tomador; 3 - Retido pelo intermediário */
      tpRetISSQN: string
      pAliq?: string
    }
    tribFed?: { piscofins?: PisCofinsDps; vRetCP?: string; vRetIRRF?: string; vRetCSLL?: string }
    totTrib: {
      vTotTrib?: { fed: string; est: string; mun: string }
      pTotTrib?: { fed: string; est: string; mun: string }
      indTotTrib?: '0'
      pTotTribSN?: string
    }
  }
}

// ---------- identificadores ----------

const soDigitos = (v?: string) => (v ?? '').replace(/\D/g, '')

/**
 * Id do DPS (TSIdDPS): "DPS" + Cód.Mun (7) + Tipo de Inscrição Federal (1: CPF=1, CNPJ=2) +
 * Inscrição Federal (14, CPF com zeros à esquerda) + Série (5) + Número (15).
 */
export function idDps(codigoMunicipio: string, inscricao: string, serie: string, numero: string): string {
  const doc = soDigitos(inscricao)
  const tipo = doc.length === 11 ? '1' : '2'
  return `DPS${soDigitos(codigoMunicipio).padStart(7, '0')}${tipo}${doc.padStart(14, '0')}${soDigitos(serie).padStart(5, '0')}${soDigitos(numero).padStart(15, '0')}`
}

/** Id do pedido de registro de evento (TSIdPedRegEvt): "PRE" + chave (50) + tipo do evento (6). */
export const idPedidoEvento = (chave: string, tipoEvento: string): string => `PRE${soDigitos(chave)}${tipoEvento}`

// ---------- validação de domínio ----------

export class ErroDps extends Error {}

const exigir = (cond: unknown, msg: string) => {
  if (!cond) throw new ErroDps(msg)
}

/** Regras do leiaute que dá para conferir antes de mandar — melhor um erro claro aqui que um E1235 lá. */
export function validarDps(d: DadosDps): void {
  exigir(/^\d{1,5}$/.test(d.serie), 'Série do DPS deve ter de 1 a 5 dígitos')
  exigir(/^[1-9]\d{0,14}$/.test(d.numero), 'Número do DPS deve ter de 1 a 15 dígitos, sem zeros à esquerda')
  exigir(/^\d{4}-\d{2}-\d{2}$/.test(d.competencia), 'Competência deve estar no formato AAAA-MM-DD')
  exigir(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(d.dhEmi), 'Data de emissão deve estar no formato AAAA-MM-DDThh:mm:ss±hh:mm')
  exigir(/^\d{7}$/.test(soDigitos(d.codigoMunicipioEmissao)), 'Código IBGE do município emissor deve ter 7 dígitos')
  exigir(['1', '2', '3'].includes(d.tpEmit), 'Emitente do DPS inválido')
  const p = d.prestador
  exigir(soDigitos(p.cnpj).length === 14 || soDigitos(p.cpf).length === 11 || p.nif || p.cNaoNIF, 'Prestador sem CNPJ/CPF')
  exigir(['1', '2', '3'].includes(p.regime.opSimpNac), 'Situação do prestador perante o Simples Nacional inválida')
  exigir(['0', '1', '2', '3', '4', '5', '6', '9'].includes(p.regime.regEspTrib), 'Regime especial de tributação inválido')
  if (d.tomador) {
    const t = d.tomador
    exigir(soDigitos(t.cnpj).length === 14 || soDigitos(t.cpf).length === 11 || t.nif || t.cNaoNIF, 'Tomador sem CNPJ/CPF')
    exigir(t.nome?.trim(), 'Tomador sem nome')
  }
  exigir(/^\d{6}$/.test(soDigitos(d.servico.cTribNac)), 'Código de tributação nacional deve ter 6 dígitos')
  exigir(d.servico.descricao.trim().length >= 1 && d.servico.descricao.length <= 2000, 'Descrição do serviço deve ter de 1 a 2000 caracteres')
  exigir(d.servico.codigoMunicipioPrestacao || d.servico.codigoPaisPrestacao, 'Informe o município (ou país) da prestação')
  exigir(/^(0|0\.\d{2}|[1-9]\d{0,14}(\.\d{2})?)$/.test(d.valores.vServ), 'Valor do serviço deve ter até 2 casas decimais, com ponto')
  exigir(Number(d.valores.vServ) > 0, 'Valor do serviço deve ser maior que zero')
  exigir(['1', '2', '3', '4'].includes(d.valores.tribMun.tribISSQN), 'Tributação do ISSQN inválida')
  exigir(['1', '2', '3'].includes(d.valores.tribMun.tpRetISSQN), 'Tipo de retenção do ISSQN inválido')
  const t = d.valores.totTrib
  exigir(t.vTotTrib || t.pTotTrib || t.indTotTrib === '0' || t.pTotTribSN, 'Informe os totais aproximados dos tributos')
  if (d.substituicao) {
    exigir(/^\d{50}$/.test(soDigitos(d.substituicao.chaveSubstituida)), 'Chave da NFS-e substituída deve ter 50 dígitos')
    exigir(['01', '02', '03', '04', '05', '99'].includes(d.substituicao.motivo), 'Motivo da substituição inválido')
    if (d.substituicao.descricao) exigir(d.substituicao.descricao.length >= 15 && d.substituicao.descricao.length <= 255, 'Descrição do motivo deve ter de 15 a 255 caracteres')
  }
}

// ---------- montagem do XML ----------

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Tag só se houver valor: os opcionais do leiaute não podem ir vazios. */
const tag = (nome: string, valor?: string): string => (valor === undefined || valor === '' ? '' : `<${nome}>${esc(valor)}</${nome}>`)

/** Valor monetário/percentual no formato do leiaute (ponto decimal, 2 casas). */
export const decimal = (v: number | string | undefined): string | undefined => {
  if (v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toFixed(2)
}

/** Texto do leiaute (TSString): sem espaços nas pontas, sem quebras duplicadas. */
const texto = (v?: string) => v?.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()

function xmlEndereco(e?: EnderecoDps): string {
  if (!e) return ''
  const nac = e.codigoMunicipio ? `<endNac>${tag('cMun', soDigitos(e.codigoMunicipio))}${tag('CEP', soDigitos(e.cep))}</endNac>` : ''
  const ext = !e.codigoMunicipio && e.codigoPais
    ? `<endExt>${tag('cPais', e.codigoPais)}${tag('cEndPost', e.codigoPostalExterior)}${tag('xCidade', e.cidadeExterior)}${tag('xEstProvReg', e.estadoExterior)}</endExt>`
    : ''
  return `<end>${nac}${ext}${tag('xLgr', texto(e.logradouro))}${tag('nro', texto(e.numero))}${tag('xCpl', texto(e.complemento))}${tag('xBairro', texto(e.bairro))}</end>`
}

function xmlIdentificacao(p: PessoaDps): string {
  if (soDigitos(p.cnpj).length === 14) return tag('CNPJ', soDigitos(p.cnpj))
  if (soDigitos(p.cpf).length === 11) return tag('CPF', soDigitos(p.cpf))
  if (p.nif) return tag('NIF', p.nif)
  return tag('cNaoNIF', p.cNaoNIF)
}

function xmlPessoa(nome: 'toma' | 'interm', p?: PessoaDps): string {
  if (!p) return ''
  return (
    `<${nome}>` +
    xmlIdentificacao(p) +
    tag('CAEPF', soDigitos(p.caepf)) +
    tag('IM', texto(p.inscricaoMunicipal)) +
    tag('xNome', texto(p.nome)) +
    xmlEndereco(p.endereco) +
    tag('fone', soDigitos(p.fone)) +
    tag('email', texto(p.email)) +
    `</${nome}>`
  )
}

/** Monta o XML do DPS (sem assinatura) na ordem exata do TCInfDPS. */
export function montarDps(d: DadosDps): { xml: string; id: string } {
  validarDps(d)
  const p = d.prestador
  const id = idDps(d.codigoMunicipioEmissao, p.cnpj ?? p.cpf ?? '', d.serie, d.numero)
  const s = d.servico
  const v = d.valores
  const tm = v.tribMun
  const tf = v.tribFed
  const pc = tf?.piscofins
  const tt = v.totTrib

  const prest =
    '<prest>' +
    xmlIdentificacao(p) +
    tag('CAEPF', soDigitos(p.caepf)) +
    tag('IM', texto(p.inscricaoMunicipal)) +
    tag('xNome', texto(p.nome)) +
    xmlEndereco(p.endereco) +
    tag('fone', soDigitos(p.fone)) +
    tag('email', texto(p.email)) +
    `<regTrib>${tag('opSimpNac', p.regime.opSimpNac)}${tag('regApTribSN', p.regime.regApTribSN)}${tag('regEspTrib', p.regime.regEspTrib)}</regTrib>` +
    '</prest>'

  const serv =
    '<serv>' +
    `<locPrest>${s.codigoMunicipioPrestacao ? tag('cLocPrestacao', soDigitos(s.codigoMunicipioPrestacao)) : tag('cPaisPrestacao', s.codigoPaisPrestacao)}</locPrest>` +
    `<cServ>${tag('cTribNac', soDigitos(s.cTribNac))}${tag('cTribMun', texto(s.cTribMun))}${tag('xDescServ', texto(s.descricao))}${tag('cNBS', soDigitos(s.cNBS))}${tag('cIntContrib', texto(s.cIntContrib))}</cServ>` +
    (s.infoCompl && (s.infoCompl.idDocTec || s.infoCompl.docRef || s.infoCompl.xInfComp)
      ? `<infoCompl>${tag('idDocTec', texto(s.infoCompl.idDocTec))}${tag('docRef', texto(s.infoCompl.docRef))}${tag('xInfComp', texto(s.infoCompl.xInfComp))}</infoCompl>`
      : '') +
    '</serv>'

  const piscofins = pc
    ? `<piscofins>${tag('CST', pc.cst)}${tag('vBCPisCofins', decimal(pc.vBCPisCofins))}${tag('pAliqPis', decimal(pc.pAliqPis))}${tag('pAliqCofins', decimal(pc.pAliqCofins))}${tag('vPis', decimal(pc.vPis))}${tag('vCofins', decimal(pc.vCofins))}${tag('tpRetPisCofins', pc.tpRetPisCofins)}</piscofins>`
    : ''
  const tribFed =
    tf && (pc || tf.vRetCP || tf.vRetIRRF || tf.vRetCSLL)
      ? `<tribFed>${piscofins}${tag('vRetCP', decimal(tf.vRetCP))}${tag('vRetIRRF', decimal(tf.vRetIRRF))}${tag('vRetCSLL', decimal(tf.vRetCSLL))}</tribFed>`
      : ''
  const totTrib = tt.vTotTrib
    ? `<vTotTrib>${tag('vTotTribFed', decimal(tt.vTotTrib.fed))}${tag('vTotTribEst', decimal(tt.vTotTrib.est))}${tag('vTotTribMun', decimal(tt.vTotTrib.mun))}</vTotTrib>`
    : tt.pTotTrib
      ? `<pTotTrib>${tag('pTotTribFed', decimal(tt.pTotTrib.fed))}${tag('pTotTribEst', decimal(tt.pTotTrib.est))}${tag('pTotTribMun', decimal(tt.pTotTrib.mun))}</pTotTrib>`
      : tt.pTotTribSN
        ? tag('pTotTribSN', decimal(tt.pTotTribSN))
        : tag('indTotTrib', '0')
  const descontos = v.vDescIncond || v.vDescCond ? `<vDescCondIncond>${tag('vDescIncond', decimal(v.vDescIncond))}${tag('vDescCond', decimal(v.vDescCond))}</vDescCondIncond>` : ''

  const valores =
    '<valores>' +
    `<vServPrest>${tag('vReceb', decimal(v.vReceb))}${tag('vServ', decimal(v.vServ))}</vServPrest>` +
    descontos +
    '<trib>' +
    `<tribMun>${tag('tribISSQN', tm.tribISSQN)}${tag('cPaisResult', tm.cPaisResult)}${tag('tpImunidade', tm.tpImunidade)}${tag('tpRetISSQN', tm.tpRetISSQN)}${tag('pAliq', decimal(tm.pAliq))}</tribMun>` +
    tribFed +
    `<totTrib>${totTrib}</totTrib>` +
    '</trib>' +
    '</valores>'

  const subst = d.substituicao
    ? `<subst>${tag('chSubstda', soDigitos(d.substituicao.chaveSubstituida))}${tag('cMotivo', d.substituicao.motivo)}${tag('xMotivo', texto(d.substituicao.descricao))}</subst>`
    : ''

  const xml =
    `<DPS xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_LEIAUTE}">` +
    `<infDPS Id="${id}">` +
    tag('tpAmb', d.ambiente === 'producao' ? '1' : '2') +
    tag('dhEmi', d.dhEmi) +
    tag('verAplic', d.verAplic ?? VER_APLIC) +
    tag('serie', d.serie) +
    tag('nDPS', d.numero) +
    tag('dCompet', d.competencia) +
    tag('tpEmit', d.tpEmit) +
    tag('cLocEmi', soDigitos(d.codigoMunicipioEmissao)) +
    subst +
    prest +
    xmlPessoa('toma', d.tomador) +
    xmlPessoa('interm', d.intermediario) +
    serv +
    valores +
    '</infDPS>' +
    '</DPS>'
  return { xml, id }
}

// ---------- leitura do DPS embutido numa NFS-e ----------

function lerEndereco(no?: NoXml): EnderecoDps | undefined {
  if (!no) return undefined
  const nac = filho(no, 'endNac')
  const ext = filho(no, 'endExt')
  return {
    codigoMunicipio: textoFilho(nac, 'cMun'),
    cep: textoFilho(nac, 'CEP'),
    codigoPais: textoFilho(ext, 'cPais'),
    codigoPostalExterior: textoFilho(ext, 'cEndPost'),
    cidadeExterior: textoFilho(ext, 'xCidade'),
    estadoExterior: textoFilho(ext, 'xEstProvReg'),
    logradouro: textoFilho(no, 'xLgr') ?? '',
    numero: textoFilho(no, 'nro') ?? '',
    complemento: textoFilho(no, 'xCpl'),
    bairro: textoFilho(no, 'xBairro') ?? '',
  }
}

function lerPessoa(no?: NoXml): PessoaDps | undefined {
  if (!no) return undefined
  return {
    cnpj: textoFilho(no, 'CNPJ'),
    cpf: textoFilho(no, 'CPF'),
    nif: textoFilho(no, 'NIF'),
    cNaoNIF: textoFilho(no, 'cNaoNIF'),
    caepf: textoFilho(no, 'CAEPF'),
    inscricaoMunicipal: textoFilho(no, 'IM'),
    nome: textoFilho(no, 'xNome'),
    endereco: lerEndereco(filho(no, 'end')),
    fone: textoFilho(no, 'fone'),
    email: textoFilho(no, 'email'),
  }
}

/** Grupos do DPS que a emissão ainda não remonta; se a nota-modelo os tiver, avisamos. */
const GRUPOS_NAO_COBERTOS: Array<[string[], string]> = [
  [['serv', 'comExt'], 'comércio exterior'],
  [['serv', 'obra'], 'obra'],
  [['serv', 'atvEvento'], 'evento'],
  [['valores', 'vDedRed'], 'deduções/reduções da base de cálculo'],
  [['valores', 'trib', 'tribMun', 'exigSusp'], 'exigibilidade suspensa'],
  [['valores', 'trib', 'tribMun', 'BM'], 'benefício municipal'],
  [['IBSCBS'], 'IBS/CBS'],
]

export interface DpsLido {
  dados: DadosDps
  /** Grupos presentes na nota-modelo que não são reproduzidos (o usuário precisa saber) */
  gruposIgnorados: string[]
}

/** Lê o DPS embutido numa NFS-e nacional para servir de modelo a uma nova emissão. */
export function lerDpsDeNfse(xmlNfse: string): DpsLido {
  const raiz = analisarXml(xmlNfse)
  const infNFSe = raiz.nome === 'infnfse' ? raiz : (filho(raiz, 'infNFSe') ?? caminho(raiz, 'NFSe', 'infNFSe'))
  const infDPS = caminho(infNFSe, 'DPS', 'infDPS') ?? caminho(raiz, 'infDPS')
  if (!infDPS) throw new ErroDps('O XML não contém um DPS')

  const prest = filho(infDPS, 'prest')
  const regTrib = filho(prest, 'regTrib')
  const serv = filho(infDPS, 'serv')
  const cServ = filho(serv, 'cServ')
  const locPrest = filho(serv, 'locPrest')
  const infoCompl = filho(serv, 'infoCompl')
  const valores = filho(infDPS, 'valores')
  const vDesc = filho(valores, 'vDescCondIncond')
  const trib = filho(valores, 'trib')
  const tribMun = filho(trib, 'tribMun')
  const tribFed = filho(trib, 'tribFed')
  const pc = filho(tribFed, 'piscofins')
  const totTrib = filho(trib, 'totTrib')
  const vTot = filho(totTrib, 'vTotTrib')
  const pTot = filho(totTrib, 'pTotTrib')

  const gruposIgnorados = GRUPOS_NAO_COBERTOS.filter(([c]) => caminho(infDPS, ...c)).map(([, nome]) => nome)

  const prestador = lerPessoa(prest)!
  const dados: DadosDps = {
    ambiente: textoFilho(infDPS, 'tpAmb') === '2' ? 'homologacao' : 'producao',
    dhEmi: textoFilho(infDPS, 'dhEmi') ?? '',
    verAplic: VER_APLIC,
    serie: textoFilho(infDPS, 'serie') ?? '',
    numero: textoFilho(infDPS, 'nDPS') ?? '',
    competencia: textoFilho(infDPS, 'dCompet') ?? '',
    tpEmit: textoFilho(infDPS, 'tpEmit') ?? '1',
    codigoMunicipioEmissao: textoFilho(infDPS, 'cLocEmi') ?? '',
    prestador: {
      ...prestador,
      regime: {
        opSimpNac: textoFilho(regTrib, 'opSimpNac') ?? '',
        regApTribSN: textoFilho(regTrib, 'regApTribSN'),
        regEspTrib: textoFilho(regTrib, 'regEspTrib') ?? '',
      },
    },
    tomador: lerPessoa(filho(infDPS, 'toma')),
    intermediario: lerPessoa(filho(infDPS, 'interm')),
    servico: {
      codigoMunicipioPrestacao: textoFilho(locPrest, 'cLocPrestacao'),
      codigoPaisPrestacao: textoFilho(locPrest, 'cPaisPrestacao'),
      cTribNac: textoFilho(cServ, 'cTribNac') ?? '',
      cTribMun: textoFilho(cServ, 'cTribMun'),
      descricao: textoFilho(cServ, 'xDescServ') ?? '',
      cNBS: textoFilho(cServ, 'cNBS'),
      cIntContrib: textoFilho(cServ, 'cIntContrib'),
      infoCompl: infoCompl
        ? { idDocTec: textoFilho(infoCompl, 'idDocTec'), docRef: textoFilho(infoCompl, 'docRef'), xInfComp: textoFilho(infoCompl, 'xInfComp') }
        : undefined,
    },
    valores: {
      vServ: textoFilho(filho(valores, 'vServPrest'), 'vServ') ?? '',
      vReceb: textoFilho(filho(valores, 'vServPrest'), 'vReceb'),
      vDescIncond: textoFilho(vDesc, 'vDescIncond'),
      vDescCond: textoFilho(vDesc, 'vDescCond'),
      tribMun: {
        tribISSQN: textoFilho(tribMun, 'tribISSQN') ?? '',
        cPaisResult: textoFilho(tribMun, 'cPaisResult'),
        tpImunidade: textoFilho(tribMun, 'tpImunidade'),
        tpRetISSQN: textoFilho(tribMun, 'tpRetISSQN') ?? '',
        pAliq: textoFilho(tribMun, 'pAliq'),
      },
      tribFed: tribFed
        ? {
            piscofins: pc
              ? {
                  cst: textoFilho(pc, 'CST') ?? '',
                  vBCPisCofins: textoFilho(pc, 'vBCPisCofins'),
                  pAliqPis: textoFilho(pc, 'pAliqPis'),
                  pAliqCofins: textoFilho(pc, 'pAliqCofins'),
                  vPis: textoFilho(pc, 'vPis'),
                  vCofins: textoFilho(pc, 'vCofins'),
                  tpRetPisCofins: textoFilho(pc, 'tpRetPisCofins'),
                }
              : undefined,
            vRetCP: textoFilho(tribFed, 'vRetCP'),
            vRetIRRF: textoFilho(tribFed, 'vRetIRRF'),
            vRetCSLL: textoFilho(tribFed, 'vRetCSLL'),
          }
        : undefined,
      totTrib: {
        vTotTrib: vTot ? { fed: textoFilho(vTot, 'vTotTribFed') ?? '0', est: textoFilho(vTot, 'vTotTribEst') ?? '0', mun: textoFilho(vTot, 'vTotTribMun') ?? '0' } : undefined,
        pTotTrib: pTot ? { fed: textoFilho(pTot, 'pTotTribFed') ?? '0', est: textoFilho(pTot, 'pTotTribEst') ?? '0', mun: textoFilho(pTot, 'pTotTribMun') ?? '0' } : undefined,
        indTotTrib: textoFilho(totTrib, 'indTotTrib') === '0' ? '0' : undefined,
        pTotTribSN: textoFilho(totTrib, 'pTotTribSN'),
      },
    },
  }
  return { dados, gruposIgnorados }
}

// ---------- eventos ----------

export type MotivoCancelamento = '1' | '2' | '9'
export const MOTIVOS_CANCELAMENTO: Record<MotivoCancelamento, string> = {
  '1': 'Erro na emissão',
  '2': 'Serviço não prestado',
  '9': 'Outros',
}
export const MOTIVOS_SUBSTITUICAO: Record<string, string> = {
  '01': 'Desenquadramento de NFS-e do Simples Nacional',
  '02': 'Enquadramento de NFS-e no Simples Nacional',
  '03': 'Inclusão retroativa de imunidade/isenção',
  '04': 'Exclusão retroativa de imunidade/isenção',
  '05': 'Rejeição pelo tomador ou intermediário responsável pelo recolhimento',
  '99': 'Outros',
}
export const TIPO_EVENTO_CANCELAMENTO = '101101'

export interface PedidoCancelamento {
  ambiente: AmbienteNfse
  /** AAAA-MM-DDThh:mm:ss±hh:mm */
  dhEvento: string
  autor: { cnpj?: string; cpf?: string }
  chave: string
  motivo: MotivoCancelamento
  /** 15 a 255 caracteres */
  descricao: string
  verAplic?: string
}

/** Pedido de registro do evento de cancelamento (e101101), sem assinatura. */
export function montarPedidoCancelamento(p: PedidoCancelamento): { xml: string; id: string } {
  const chave = soDigitos(p.chave)
  exigir(chave.length === 50, 'Chave de acesso da NFS-e deve ter 50 dígitos')
  exigir(['1', '2', '9'].includes(p.motivo), 'Motivo do cancelamento inválido')
  const descricao = texto(p.descricao) ?? ''
  exigir(descricao.length >= 15 && descricao.length <= 255, 'A justificativa do cancelamento deve ter de 15 a 255 caracteres')
  exigir(soDigitos(p.autor.cnpj).length === 14 || soDigitos(p.autor.cpf).length === 11, 'Autor do evento sem CNPJ/CPF')
  const id = idPedidoEvento(chave, TIPO_EVENTO_CANCELAMENTO)
  const xml =
    `<pedRegEvento xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_LEIAUTE}">` +
    `<infPedReg Id="${id}">` +
    tag('tpAmb', p.ambiente === 'producao' ? '1' : '2') +
    tag('verAplic', p.verAplic ?? VER_APLIC) +
    tag('dhEvento', p.dhEvento) +
    (soDigitos(p.autor.cnpj).length === 14 ? tag('CNPJAutor', soDigitos(p.autor.cnpj)) : tag('CPFAutor', soDigitos(p.autor.cpf))) +
    tag('chNFSe', chave) +
    `<e101101>${tag('xDesc', 'Cancelamento de NFS-e')}${tag('cMotivo', p.motivo)}${tag('xMotivo', descricao)}</e101101>` +
    '</infPedReg>' +
    '</pedRegEvento>'
  return { xml, id }
}

/** Data/hora local de Brasília no formato do leiaute (o SEFIN valida o fuso informado). */
export function agoraBrasilia(agora = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(agora)
  const g = (t: string) => partes.find((x) => x.type === t)?.value ?? '00'
  const hora = g('hour') === '24' ? '00' : g('hour')
  // Brasília não tem horário de verão desde 2019: UTC-03:00 o ano inteiro
  return `${g('year')}-${g('month')}-${g('day')}T${hora}:${g('minute')}:${g('second')}-03:00`
}
