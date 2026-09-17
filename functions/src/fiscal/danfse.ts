/**
 * DANFSe — Documento Auxiliar da NFS-e, gerado a partir do XML da própria nota.
 *
 * A API nacional de geração do DANFSe foi sobrestada em 03/08/2026 (Nota Técnica nº 008/2026,
 * SE/CGNFS-e, v1.02 de 14/07/2026). A NT determina que os sistemas emissores gerem o documento
 * internamente e fixa o leiaute: A4 retrato, página única, blocos na ordem do Anexo I, tamanhos
 * mínimos de fonte, QR Code para a consulta pública e a regra de que só se imprime o que consta
 * no XML (campo sem dado vira "-"). Este módulo segue essa NT. Onde ela cita Arial e Microsoft
 * Sans Serif, usamos Liberation Sans, que é métrica-compatível com a Arial e tem licença livre.
 *
 * Medidas: a NT dá tudo em centímetros a partir da borda da página; o PDF trabalha em pontos.
 */
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analisarXml, caminho, filho, textoFilho, type NoXml } from './xml'

// ---------- tabelas de descrição (texto oficial dos esquemas XSD v1.01) ----------

const TP_EMIT: Record<string, string> = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' }
const TP_AMB: Record<string, string> = { '1': 'Produção', '2': 'Homologação' }
const AMB_GER: Record<string, string> = { '1': 'Prefeitura', '2': 'Sistema Nacional da NFS-e' }
const C_STAT: Record<string, string> = {
  '100': 'NFS-e Gerada',
  '102': 'NFS-e de Decisão Judicial',
  '103': 'NFS-e Avulsa',
  '107': 'NFS-e MEI',
}
const FIN_NFSE: Record<string, string> = { '0': 'NFS-e regular' }
const OP_SIMP_NAC: Record<string, string> = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
}
const REG_AP_TRIB_SN: Record<string, string> = {
  '1': 'Regime de apuração dos tributos federais e municipal pelo SN',
  '2': 'Regime de apuração dos tributos federais pelo SN e ISSQN por fora do SN conforme respectiva legislação municipal do tributo',
  '3': 'Regime de apuração dos tributos federais e municipal por fora do SN conforme respectivas legislações federal e municipal de cada tributo',
}
const REG_ESP_TRIB: Record<string, string> = {
  '0': 'Nenhum',
  '1': 'Ato Cooperado (Cooperativa)',
  '2': 'Estimativa',
  '3': 'Microempresa Municipal',
  '4': 'Notário ou Registrador',
  '5': 'Profissional Autônomo',
  '6': 'Sociedade de Profissionais',
  '9': 'Outros',
}
const TRIB_ISSQN: Record<string, string> = {
  '1': 'Operação tributável',
  '2': 'Imunidade',
  '3': 'Exportação de serviço',
  '4': 'Não Incidência',
}
const TP_RET_ISSQN: Record<string, string> = { '1': 'Não Retido', '2': 'Retido pelo Tomador', '3': 'Retido pelo Intermediário' }
const TP_IMUNIDADE: Record<string, string> = {
  '0': 'Imunidade (tipo não informado na nota de origem)',
  '1': 'Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)',
  '2': 'Templos de qualquer culto (CF88, Art 150, VI, b)',
  '3': 'Patrimônio, renda ou serviços dos partidos políticos, inclusive suas fundações, das entidades sindicais dos trabalhadores, das instituições de educação e de assistência social, sem fins lucrativos, atendidos os requisitos da lei (CF88, Art 150, VI, c)',
  '4': 'Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)',
  '5': 'Fonogramas e videofonogramas musicais produzidos no Brasil (CF88, Art 150, VI, e)',
}
const TP_SUSP: Record<string, string> = {
  '1': 'Exigibilidade Suspensa por Decisão Judicial',
  '2': 'Exigibilidade Suspensa por Processo Administrativo',
}
const TP_BM: Record<string, string> = {
  '1': 'Isenção',
  '2': 'Redução da BC em %',
  '3': 'Redução da BC em R$',
  '4': 'Alíquota Diferenciada',
}
const TP_RET_PIS_COFINS: Record<string, string> = {
  '0': 'PIS/COFINS/CSLL Não Retidos',
  '1': 'PIS/COFINS Retidos',
  '2': 'PIS/COFINS Não Retidos',
  '3': 'PIS/COFINS/CSLL Retidos',
  '4': 'PIS/COFINS Retidos, CSLL Não Retido',
  '5': 'PIS Retido, COFINS/CSLL Não Retido',
  '6': 'COFINS Retido, PIS/CSLL Não Retido',
  '7': 'PIS Não Retido, COFINS/CSLL Retidos',
  '8': 'PIS/COFINS Não Retidos, CSLL Retido',
  '9': 'COFINS Não Retido, PIS/CSLL Retidos',
}

// ---------- recursos embarcados ----------

const ASSETS = join(__dirname, '..', '..', 'assets')
let municipios: Record<string, [string, string]> | undefined

/** Nome e UF de um município pelo código IBGE (tabela embarcada, servicodados.ibge.gov.br). */
export function municipioIbge(codigo?: string): { nome: string; uf: string } | undefined {
  if (!codigo) return undefined
  municipios ??= JSON.parse(readFileSync(join(ASSETS, 'municipios-ibge.json'), 'utf8')) as Record<string, [string, string]>
  const m = municipios[codigo.replace(/\D/g, '')]
  return m ? { nome: m[0], uf: m[1] } : undefined
}

// ---------- formatação ----------

const TRACO = '-'
const cm = (v: number) => v * (72 / 2.54)

const soDigitos = (v?: string) => (v ?? '').replace(/\D/g, '')

export function formatarDocumento(cnpj?: string, cpf?: string, nif?: string): string {
  const c = soDigitos(cnpj)
  if (c.length === 14) return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  const p = soDigitos(cpf)
  if (p.length === 11) return p.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return nif?.trim() || TRACO
}

export function formatarCep(cep?: string): string {
  const d = soDigitos(cep)
  return d.length === 8 ? d.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3') : cep?.trim() || TRACO
}

/** "16990.00" → "16.990,00". Campo vazio vira traço, como manda a NT (nota 12). */
export function formatarValor(v?: string): string {
  if (v === undefined || v === '') return TRACO
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatarPercentual(v?: string): string {
  if (v === undefined || v === '') return TRACO
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : v
}

/** "2026-09-02T16:19:40-03:00" → "02/09/2026 16:19:40" — sem converter fuso: é a hora que está no XML. */
export function formatarDataHora(v?: string): string {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/)
  if (!m) return v?.trim() || TRACO
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : `${m[3]}/${m[2]}/${m[1]}`
}

export function formatarData(v?: string): string {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v?.trim() || TRACO
}

/** "010401" → "01.04.01" (item.subitem.desdobro da LC 116/2003). */
export function formatarTribNac(v?: string): string {
  const d = soDigitos(v)
  return d.length === 6 ? `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}` : v?.trim() || TRACO
}

function formatarNbs(v?: string): string {
  const d = soDigitos(v)
  return d.length === 9 ? `${d[0]}.${d.slice(1, 5)}.${d.slice(5, 7)}.${d.slice(7)}` : v?.trim() || TRACO
}

const descrever = (tabela: Record<string, string>, codigo?: string) => (codigo ? (tabela[codigo] ?? codigo) : TRACO)
const ou = (v?: string) => (v?.trim() ? v.trim() : TRACO)

// ---------- leitura do XML ----------

interface Pessoa {
  documento: string
  im: string
  fone: string
  nome: string
  municipioUf: string
  ibgeCep: string
  endereco: string
  email: string
}

export interface DadosDanfse {
  chave: string
  tpAmb: string
  ambGer: string
  municipioEmitente: string
  nNFSe: string
  dCompet: string
  dhProc: string
  nDPS: string
  serie: string
  dhEmi: string
  tpEmit: string
  cStat: string
  finNFSe: string
  prestador: Pessoa & { simplesNacional: string; regimeApuracao: string }
  tomador?: Pessoa
  destinatario?: Pessoa
  /** O destinatário é o próprio tomador (nota 3 da NT) */
  destinatarioEhTomador: boolean
  intermediario?: Pessoa
  servico: { codigos: string; nbs: string; localPrestacao: string; descricaoCodigo: string; descricao: string }
  issqn?: {
    tipo: string
    localIncidencia: string
    regimeEspecial: string
    imunidade: string
    suspensao: string
    processo: string
    beneficio: string
    calculoBm: string
    deducoes: string
    descontoIncond: string
    baseCalculo: string
    aliquota: string
    retencao: string
    valor: string
    /** linha do regime/imunidade/suspensão tem algum dado (nota 5) */
    temLinhaRegime: boolean
    temLinhaBeneficio: boolean
  }
  federal: { irrf: string; cp: string; sociais: string; pis: string; cofins: string; descricaoRetencao: string; imprimirPisCofins: boolean }
  ibsCbs: Record<string, string>
  total: { servico: string; descIncond: string; descCond: string; retencoes: string; liquido: string; ibsCbs: string; totalNota: string }
  informacoesComplementares: string
}

function lerPessoa(no: NoXml | undefined, enderecoAlternativo?: NoXml): Pessoa | undefined {
  if (!no) return undefined
  const end = filho(no, 'end') ?? enderecoAlternativo
  const nac = filho(end, 'endNac') ?? end
  const ext = filho(end, 'endExt')
  const codMun = textoFilho(nac, 'cMun')
  const mun = municipioIbge(codMun)
  const municipioUf = ext
    ? [textoFilho(ext, 'xCidade'), textoFilho(ext, 'xEstProvReg')].filter(Boolean).join(' / ') || TRACO
    : mun
      ? `${mun.nome} / ${textoFilho(nac, 'UF') ?? mun.uf}`
      : [textoFilho(nac, 'xMun'), textoFilho(nac, 'UF')].filter(Boolean).join(' / ') || TRACO
  const ibgeCep = ext
    ? [textoFilho(ext, 'cPais'), textoFilho(ext, 'cEndPost')].filter(Boolean).join(' / ') || TRACO
    : codMun
      ? `${codMun} / ${formatarCep(textoFilho(nac, 'CEP'))}`
      : TRACO
  const endereco =
    [textoFilho(end, 'xLgr'), textoFilho(end, 'nro'), textoFilho(end, 'xCpl'), textoFilho(end, 'xBairro')]
      .map((v) => v?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(', ') || TRACO
  return {
    documento: formatarDocumento(textoFilho(no, 'CNPJ'), textoFilho(no, 'CPF'), textoFilho(no, 'NIF')),
    im: ou(textoFilho(no, 'IM')),
    fone: ou(textoFilho(no, 'fone')),
    nome: ou(textoFilho(no, 'xNome')),
    municipioUf,
    ibgeCep,
    endereco,
    email: ou(textoFilho(no, 'email')),
  }
}

function localComPais(nome?: string, codMun?: string, pais?: string): string {
  const mun = municipioIbge(codMun)
  const partes = [nome ?? mun?.nome, mun?.uf, pais ?? (nome || mun ? 'BR' : undefined)].filter(Boolean)
  return partes.length ? partes.join(' / ') : TRACO
}

/** Lê do XML da NFS-e tudo o que o DANFSe imprime. Só o que está no XML — nada é deduzido. */
export function lerDadosDanfse(xml: string): DadosDanfse {
  const raiz = analisarXml(xml)
  const infNFSe = raiz.nome === 'infnfse' ? raiz : (filho(raiz, 'infNFSe') ?? caminho(raiz, 'NFSe', 'infNFSe'))
  if (!infNFSe) throw new Error('XML não é uma NFS-e do padrão nacional (sem infNFSe)')
  const chave = (infNFSe.atributos['Id'] ?? infNFSe.atributos['id'] ?? '').replace(/^NFS/i, '')
  const emit = filho(infNFSe, 'emit')
  const infDPS = caminho(infNFSe, 'DPS', 'infDPS')
  const prest = filho(infDPS, 'prest')
  const toma = filho(infDPS, 'toma')
  const interm = filho(infDPS, 'interm')
  const serv = filho(infDPS, 'serv')
  const cServ = filho(serv, 'cServ')
  const valoresDps = filho(infDPS, 'valores')
  const valoresNfse = filho(infNFSe, 'valores')
  const trib = filho(valoresDps, 'trib')
  const tribMun = filho(trib, 'tribMun')
  const tribFed = filho(trib, 'tribFed')
  const pisCofins = filho(tribFed, 'piscofins')
  const totTrib = filho(trib, 'totTrib')
  const ibscbsDps = filho(infDPS, 'IBSCBS')
  const ibscbsNfse = filho(infNFSe, 'IBSCBS')
  const dest = filho(ibscbsDps, 'dest')

  // O prestador do DPS costuma vir só com CNPJ/IM; quando o emitente é o próprio prestador,
  // o bloco emit da NFS-e traz nome e endereço dele — ainda é conteúdo do XML.
  const tpEmit = textoFilho(infDPS, 'tpEmit') ?? ''
  const prestNo: NoXml | undefined = prest
    ? tpEmit === '1' && emit
      ? { ...prest, filhos: [...prest.filhos, ...emit.filhos.filter((f) => !prest.filhos.some((p) => p.nome === f.nome))] }
      : prest
    : emit
  const prestador = lerPessoa(prestNo, tpEmit === '1' ? filho(emit, 'enderNac') : undefined)!
  const regTrib = filho(prest, 'regTrib')

  const tomador = lerPessoa(toma)
  const destinatario = lerPessoa(dest)
  const destinatarioEhTomador =
    !!destinatario && !!tomador && destinatario.documento === tomador.documento && destinatario.documento !== TRACO

  const tribISSQN = textoFilho(tribMun, 'tribISSQN')
  const exigSusp = filho(tribMun, 'exigSusp')
  const bm = filho(tribMun, 'BM')
  const vDedRed = filho(valoresDps, 'vDedRed')
  const vDesc = filho(valoresDps, 'vDescCondIncond')
  const regimeEspecial = textoFilho(regTrib, 'regEspTrib')
  const imunidade = textoFilho(tribMun, 'tpImunidade')
  const tpSusp = textoFilho(exigSusp, 'tpSusp')
  const nProcesso = textoFilho(exigSusp, 'nProcesso')
  const tpBM = textoFilho(valoresNfse, 'tpBM') ?? textoFilho(bm, 'tpBM')
  const calculoBm = textoFilho(valoresNfse, 'vCalcBM') ?? textoFilho(bm, 'vRedBCBM')
  const deducoes = textoFilho(vDedRed, 'vDR') ?? textoFilho(valoresNfse, 'vCalcDR') ?? textoFilho(valoresNfse, 'vDR')
  const descontoIncond = textoFilho(vDesc, 'vDescIncond')

  const issqn =
    tribISSQN === '1' || tribISSQN === undefined
      ? {
          tipo: descrever(TRIB_ISSQN, tribISSQN),
          localIncidencia: localComPais(textoFilho(infNFSe, 'xLocIncid'), textoFilho(infNFSe, 'cLocIncid'), textoFilho(tribMun, 'cPaisResult')),
          regimeEspecial: regimeEspecial !== undefined && regimeEspecial !== '0' ? descrever(REG_ESP_TRIB, regimeEspecial) : TRACO,
          imunidade: descrever(TP_IMUNIDADE, imunidade),
          suspensao: descrever(TP_SUSP, tpSusp),
          processo: ou(nProcesso),
          beneficio: descrever(TP_BM, tpBM),
          calculoBm: formatarValor(calculoBm),
          deducoes: formatarValor(deducoes),
          descontoIncond: formatarValor(descontoIncond),
          baseCalculo: formatarValor(textoFilho(valoresNfse, 'vBC')),
          aliquota: formatarPercentual(textoFilho(valoresNfse, 'pAliqAplic')),
          retencao: descrever(TP_RET_ISSQN, textoFilho(tribMun, 'tpRetISSQN')),
          valor: formatarValor(textoFilho(valoresNfse, 'vISSQN')),
          temLinhaRegime: (regimeEspecial !== undefined && regimeEspecial !== '0') || !!imunidade || !!tpSusp || !!nProcesso,
          temLinhaBeneficio: !!tpBM || !!calculoBm || !!deducoes || !!descontoIncond,
        }
      : undefined

  // Nota 6 da NT: linha PIS/COFINS impressa para competência até o fim de 2026.
  const dCompet = textoFilho(infDPS, 'dCompet')
  const tpRetPisCofins = textoFilho(pisCofins, 'tpRetPisCofins')
  const vRetCSLL = Number(textoFilho(tribFed, 'vRetCSLL') ?? 0)
  const vPis = textoFilho(pisCofins, 'vPis')
  const vCofins = textoFilho(pisCofins, 'vCofins')
  const pisCofinsRetidos = tpRetPisCofins === '1'
  const sociais =
    textoFilho(tribFed, 'vRetCSLL') === undefined && !pisCofinsRetidos
      ? TRACO
      : formatarValor(String(vRetCSLL + (pisCofinsRetidos ? Number(vPis ?? 0) + Number(vCofins ?? 0) : 0)))
  const federal = {
    irrf: formatarValor(textoFilho(tribFed, 'vRetIRRF')),
    cp: formatarValor(textoFilho(tribFed, 'vRetCP')),
    sociais,
    pis: pisCofinsRetidos ? formatarValor('0') : formatarValor(vPis),
    cofins: pisCofinsRetidos ? formatarValor('0') : formatarValor(vCofins),
    descricaoRetencao: descrever(TP_RET_PIS_COFINS, tpRetPisCofins),
    imprimirPisCofins: !dCompet || dCompet <= '2026-12-31',
  }

  // IBS/CBS: leitura direta das tags; fica "-" enquanto a nota não trouxer o grupo.
  const ibsVal = filho(ibscbsNfse, 'valores')
  const uf = filho(ibsVal, 'uf')
  const mun = filho(ibsVal, 'mun')
  const fed = filho(ibsVal, 'fed')
  const totC = filho(ibscbsNfse, 'totCIBS')
  const gIBS = filho(totC, 'gIBS')
  const gCBS = filho(totC, 'gCBS')
  const gIBSCBS = caminho(ibscbsDps, 'valores', 'trib', 'gIBSCBS')
  const pct = (a?: string, b?: string, c?: string) => {
    const v = [a, b, c].filter((x) => x !== undefined)
    return v.length ? v.map((x) => formatarPercentual(x)).join(' / ') : TRACO
  }
  const vIBSTot = textoFilho(gIBS, 'vIBSTot')
  const vCBS = textoFilho(gCBS, 'vCBS')
  const localIncid = municipioIbge(textoFilho(ibscbsNfse, 'cLocalidadeIncid'))
  const exclusoes = [descontoIncond, textoFilho(ibsVal, 'vCalcReeRepRes'), textoFilho(valoresNfse, 'vISSQN'), vPis, vCofins]
    .filter((x) => x !== undefined)
    .reduce((s, x) => s + Number(x), 0)
  const ibsCbs: Record<string, string> = {
    cst: [textoFilho(gIBSCBS, 'CST'), textoFilho(gIBSCBS, 'cClassTrib')].filter(Boolean).join(' / ') || TRACO,
    indicador:
      [textoFilho(ibscbsDps, 'cIndOp'), textoFilho(ibscbsNfse, 'cLocalidadeIncid'), localIncid ? `${localIncid.nome} / ${localIncid.uf}` : textoFilho(ibscbsNfse, 'xLocalidadeIncid')]
        .filter(Boolean)
        .join(' / ') || TRACO,
    exclusoes: ibscbsNfse ? formatarValor(String(exclusoes)) : TRACO,
    baseCalculo: formatarValor(textoFilho(ibsVal, 'vBC')),
    reducoesAliquota: pct(textoFilho(uf, 'pRedAliqUF'), textoFilho(mun, 'pRedAliqMun'), textoFilho(fed, 'pRedAliqCBS')),
    aliquotasIbs: pct(textoFilho(uf, 'pIBSUF'), textoFilho(mun, 'pIBSMun')),
    aliqEfetMun: formatarPercentual(textoFilho(mun, 'pAliqEfetMun')),
    vIbsMun: formatarValor(textoFilho(filho(gIBS, 'gIBSMunTot'), 'vIBSMun')),
    aliqEfetUf: formatarPercentual(textoFilho(uf, 'pAliqEfetUF')),
    vIbsUf: formatarValor(textoFilho(filho(gIBS, 'gIBSUFTot'), 'vIBSUF')),
    vIbsTot: formatarValor(vIBSTot),
    pCbs: formatarPercentual(textoFilho(fed, 'pCBS')),
    pAliqEfetCbs: formatarPercentual(textoFilho(fed, 'pAliqEfetCBS')),
    vCbs: formatarValor(vCBS),
  }

  const totalIbsCbs = vIBSTot !== undefined || vCBS !== undefined ? formatarValor(String(Number(vIBSTot ?? 0) + Number(vCBS ?? 0))) : TRACO
  const total = {
    servico: formatarValor(textoFilho(filho(valoresDps, 'vServPrest'), 'vServ')),
    descIncond: formatarValor(descontoIncond),
    descCond: formatarValor(textoFilho(vDesc, 'vDescCond')),
    retencoes: formatarValor(textoFilho(valoresNfse, 'vTotalRet')),
    liquido: formatarValor(textoFilho(valoresNfse, 'vLiq')),
    ibsCbs: totalIbsCbs,
    totalNota: formatarValor(textoFilho(totC, 'vTotNF')),
  }

  // Informações complementares: união dos campos, na ordem e com os separadores que a NT fixa,
  // e a linha obrigatória dos totais aproximados dos tributos (Lei 12.741/2012).
  const infoCompl = filho(serv, 'infoCompl')
  const subst = filho(infDPS, 'subst')
  const obra = filho(serv, 'obra')
  const imovel = filho(ibscbsDps, 'imovel')
  const evento = filho(serv, 'atvEvento')
  const partesInfo: string[] = []
  const add = (rotulo: string, v?: string) => v?.trim() && partesInfo.push(`${rotulo} ${v.trim()}`)
  add('Inf. Cont.:', textoFilho(infoCompl, 'xInfComp'))
  add('NFS-e Subst.:', textoFilho(subst, 'chSubstda'))
  add('Doc. Ref.:', textoFilho(infoCompl, 'docRef'))
  add('Cod. Obra:', textoFilho(obra, 'cObra'))
  add('Insc. Imob.:', textoFilho(obra, 'inscImobFisc') ?? textoFilho(imovel, 'inscImobFisc'))
  add('Cod. Evt.:', textoFilho(evento, 'idAtvEvt'))
  add('Doc. Tec.:', textoFilho(infoCompl, 'idDocTec'))
  add('Núm. Ped.:', textoFilho(infoCompl, 'xPed'))
  add('Item Ped.:', textoFilho(filho(infoCompl, 'gItemPed'), 'xItemPed'))
  add('Inf. A. T. Mun.:', textoFilho(infNFSe, 'xOutInf'))
  const vTot = filho(totTrib, 'vTotTrib')
  const pTot = filho(totTrib, 'pTotTrib')
  const pSN = textoFilho(totTrib, 'pTotTribSN')
  const totais = vTot
    ? `Federais: R$ ${formatarValor(textoFilho(vTot, 'vTotTribFed'))}; Estaduais: R$ ${formatarValor(textoFilho(vTot, 'vTotTribEst'))}; Municipais: R$ ${formatarValor(textoFilho(vTot, 'vTotTribMun'))}`
    : pTot
      ? `Federais: ${formatarPercentual(textoFilho(pTot, 'pTotTribFed'))}; Estaduais: ${formatarPercentual(textoFilho(pTot, 'pTotTribEst'))}; Municipais: ${formatarPercentual(textoFilho(pTot, 'pTotTribMun'))}`
      : pSN
        ? `Simples Nacional: ${formatarPercentual(pSN)}`
        : 'Federais: -; Estaduais: -; Municipais: -'
  partesInfo.push(`Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${totais}`)

  const codMunEmit = textoFilho(filho(emit, 'enderNac'), 'cMun') ?? textoFilho(infDPS, 'cLocEmi')
  const ufEmit = textoFilho(filho(emit, 'enderNac'), 'UF') ?? municipioIbge(codMunEmit)?.uf
  const codTribNac = textoFilho(cServ, 'cTribNac')

  return {
    chave,
    tpAmb: textoFilho(infDPS, 'tpAmb') ?? '1',
    ambGer: descrever(AMB_GER, textoFilho(infNFSe, 'ambGer')),
    // a NT manda omitir o município no cabeçalho quando o item do código nacional é 99
    municipioEmitente:
      codTribNac?.startsWith('99') ? '' : `Município: ${textoFilho(infNFSe, 'xLocEmi') ?? municipioIbge(codMunEmit)?.nome ?? TRACO} / ${ufEmit ?? TRACO}`,
    nNFSe: ou(textoFilho(infNFSe, 'nNFSe')),
    dCompet: formatarData(dCompet),
    dhProc: formatarDataHora(textoFilho(infNFSe, 'dhProc')),
    nDPS: ou(textoFilho(infDPS, 'nDPS')),
    serie: ou(textoFilho(infDPS, 'serie')),
    dhEmi: formatarDataHora(textoFilho(infDPS, 'dhEmi')),
    tpEmit: descrever(TP_EMIT, tpEmit || undefined),
    cStat: descrever(C_STAT, textoFilho(infNFSe, 'cStat')),
    finNFSe: descrever(FIN_NFSE, textoFilho(ibscbsDps, 'finNFSe')),
    prestador: {
      ...prestador,
      simplesNacional: descrever(OP_SIMP_NAC, textoFilho(regTrib, 'opSimpNac')),
      regimeApuracao: descrever(REG_AP_TRIB_SN, textoFilho(regTrib, 'regApTribSN')),
    },
    tomador,
    destinatario,
    destinatarioEhTomador,
    intermediario: lerPessoa(interm),
    servico: {
      codigos: [formatarTribNac(codTribNac), textoFilho(cServ, 'cTribMun')].filter(Boolean).join(' / '),
      nbs: formatarNbs(textoFilho(cServ, 'cNBS')),
      localPrestacao: localComPais(
        textoFilho(infNFSe, 'xLocPrestacao'),
        textoFilho(filho(serv, 'locPrest'), 'cLocPrestacao'),
        textoFilho(filho(serv, 'locPrest'), 'cPaisPrestacao'),
      ),
      descricaoCodigo: textoFilho(infNFSe, 'xTribMun') || textoFilho(infNFSe, 'xTribNac') || TRACO,
      descricao: ou(textoFilho(cServ, 'xDescServ')),
    },
    issqn,
    federal,
    ibsCbs,
    total,
    informacoesComplementares: partesInfo.join(' | '),
  }
}

// ---------- desenho ----------

export interface OpcoesDanfse {
  /** Marca d'água em diagonal (itens 2.5.1 e 2.5.2 da NT) */
  marcaDagua?: 'CANCELADA' | 'SUBSTITUÍDA'
}

const FONTE = 'Sans'
const NEGRITO = 'SansBold'
const CINZA_CLARO = '#F2F2F2' // 5% de densidade
const PRETO = '#000000'
const X0 = cm(0.3)
const LARGURA = cm(20.4)
const COL = [cm(0.3), cm(5.41), cm(10.51), cm(15.62)]
const LARG_COL = cm(5.09)
const ALTURA_CAMPO = cm(0.63)
const ALTURA_TITULO = cm(0.3)
const ALTURA_LINHA_SUPRIMIDA = cm(0.32)
const RESPIRO = cm(0.06)

class Desenhista {
  y = cm(0.3)
  constructor(private doc: PDFKit.PDFDocument) {}

  private caixa(x: number, y: number, w: number, h: number, sombreada = false) {
    if (sombreada) this.doc.rect(x, y, w, h).fill(CINZA_CLARO)
    this.doc.lineWidth(0.5).strokeColor(PRETO).rect(x, y, w, h).stroke()
    this.doc.fillColor(PRETO)
  }

  /** Um campo: rótulo em negrito 6pt e conteúdo 7pt numa linha, com reticências se não couber. */
  campo(x: number, y: number, w: number, rotulo: string, valor: string, opcoes: { h?: number; sombreado?: boolean; rotuloMaiusculo?: boolean; multilinha?: boolean } = {}) {
    const h = opcoes.h ?? ALTURA_CAMPO
    this.caixa(x, y, w, h, opcoes.sombreado)
    this.doc.font(NEGRITO).fontSize(opcoes.rotuloMaiusculo ? 7 : 6).text(rotulo, x + RESPIRO, y + cm(0.05), { width: w - 2 * RESPIRO, lineBreak: false, ellipsis: true })
    const yValor = y + cm(0.05) + (opcoes.rotuloMaiusculo ? 8 : 7)
    this.doc.font(FONTE).fontSize(7)
    if (opcoes.multilinha) {
      this.doc.text(valor, x + RESPIRO, yValor, { width: w - 2 * RESPIRO, height: h - (yValor - y) - cm(0.04), ellipsis: true, lineGap: 0.5 })
    } else {
      this.doc.text(valor, x + RESPIRO, yValor, { width: w - 2 * RESPIRO, lineBreak: false, ellipsis: true })
    }
  }

  /** Título de bloco ocupando a primeira coluna da linha (como no Anexo I da NT). */
  tituloNaColuna(y: number, titulo: string, h = ALTURA_CAMPO) {
    this.caixa(COL[0], y, LARG_COL, h, true)
    this.doc.font(NEGRITO).fontSize(7).text(titulo, COL[0] + RESPIRO, y + h / 2 - 4, { width: LARG_COL - 2 * RESPIRO, lineBreak: false, ellipsis: true })
  }

  /** Faixa de título ocupando a largura toda. */
  faixa(titulo: string, h = ALTURA_TITULO) {
    this.caixa(X0, this.y, LARGURA, h, true)
    this.doc.font(NEGRITO).fontSize(7).text(titulo, X0 + RESPIRO, this.y + h / 2 - 4, { width: LARGURA - 2 * RESPIRO, lineBreak: false })
    this.y += h
  }

  /** Linha de bloco suprimido (notas 2, 3 e 4 da NT): só o aviso, em caixa alta. */
  linhaSuprimida(texto: string) {
    this.caixa(X0, this.y, LARGURA, ALTURA_LINHA_SUPRIMIDA, true)
    this.doc.font(NEGRITO).fontSize(7).text(texto, X0 + RESPIRO, this.y + ALTURA_LINHA_SUPRIMIDA / 2 - 4, { width: LARGURA - 2 * RESPIRO, lineBreak: false, ellipsis: true })
    this.y += ALTURA_LINHA_SUPRIMIDA
  }

  /** Uma linha de até 4 células; `largura` em número de colunas. */
  linha(celulas: Array<{ rotulo: string; valor: string; colunas?: number; sombreado?: boolean }>, titulo?: string) {
    let coluna = 0
    if (titulo) {
      this.tituloNaColuna(this.y, titulo)
      coluna = 1
    }
    for (const c of celulas) {
      const n = c.colunas ?? 1
      const x = COL[coluna]
      const w = coluna + n >= 4 ? X0 + LARGURA - x : COL[coluna + n] - x
      this.campo(x, this.y, w, c.rotulo, c.valor, { sombreado: c.sombreado })
      coluna += n
    }
    this.y += ALTURA_CAMPO
  }

  pessoa(titulo: string, p: Pessoa | undefined, aviso: string, extras?: Array<{ rotulo: string; valor: string; colunas?: number }>) {
    if (!p) {
      this.linhaSuprimida(aviso)
      return
    }
    this.linha([{ rotulo: 'CNPJ / CPF / NIF', valor: p.documento }, { rotulo: 'Indicador Municipal (Inscrição)', valor: p.im }, { rotulo: 'Telefone', valor: p.fone }], titulo)
    this.linha([{ rotulo: 'Nome / Nome Empresarial', valor: p.nome, colunas: 2 }, { rotulo: 'Município / Sigla UF', valor: p.municipioUf }, { rotulo: 'Código IBGE / CEP', valor: p.ibgeCep }])
    this.linha([{ rotulo: 'Endereço', valor: p.endereco, colunas: 2 }, { rotulo: 'E-mail', valor: p.email, colunas: 2 }])
    if (extras) this.linha(extras)
  }
}

/** Gera o PDF do DANFSe a partir do XML da NFS-e. Página única, A4, conforme a NT 008/2026. */
export async function gerarDanfse(xml: string, opcoes: OpcoesDanfse = {}): Promise<Buffer> {
  const d = lerDadosDanfse(xml)
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `DANFSe ${d.nNFSe}`, Author: 'Sistema Nacional NFS-e' } })
  const partes: Buffer[] = []
  doc.on('data', (c: Buffer) => partes.push(c))
  const fim = new Promise<void>((ok) => doc.on('end', () => ok()))

  doc.registerFont(FONTE, join(ASSETS, 'LiberationSans-Regular.ttf'))
  doc.registerFont(NEGRITO, join(ASSETS, 'LiberationSans-Bold.ttf'))
  const g = new Desenhista(doc)

  // borda da página, 1pt (item 2.2.3)
  const margem = cm(0.15)
  doc.lineWidth(1).strokeColor(PRETO).rect(margem, margem, doc.page.width - 2 * margem, doc.page.height - 2 * margem).stroke()

  // ---- cabeçalho (item 2.4.3) ----
  const yCab = cm(0.3)
  const hCab = cm(1.16)
  doc.rect(X0, yCab, LARGURA, hCab).fill(CINZA_CLARO)
  doc.lineWidth(0.5).strokeColor(PRETO).rect(X0, yCab, LARGURA, hCab).stroke().fillColor(PRETO)
  doc.image(join(ASSETS, 'logo-nfse.png'), cm(0.49), cm(0.44), { fit: [cm(4), cm(0.85)], valign: 'center' })
  doc.font(NEGRITO).fontSize(9)
  const xDesc = cm(5.41)
  const wDesc = cm(10.19)
  if (d.tpAmb === '2') {
    doc.text('DANFSe v2.0', xDesc, yCab + cm(0.1), { width: wDesc, align: 'center', lineBreak: false })
    doc.text('Documento Auxiliar da NFS-e', xDesc, yCab + cm(0.42), { width: wDesc, align: 'center', lineBreak: false })
    doc.fillColor('#FF0000').text('NFS-e SEM VALIDADE JURÍDICA', xDesc, yCab + cm(0.76), { width: wDesc, align: 'center', lineBreak: false }).fillColor(PRETO)
  } else {
    doc.text('DANFSe v2.0', xDesc, yCab + cm(0.28), { width: wDesc, align: 'center', lineBreak: false })
    doc.text('Documento Auxiliar da NFS-e', xDesc, yCab + cm(0.62), { width: wDesc, align: 'center', lineBreak: false })
  }
  const xMun = cm(15.62)
  const wMun = cm(5.09)
  doc.lineWidth(0.5).rect(xMun, yCab, wMun, hCab).stroke()
  doc.font(FONTE).fontSize(8).text(d.municipioEmitente, xMun + RESPIRO, yCab + cm(0.12), { width: wMun - 2 * RESPIRO, lineBreak: false, ellipsis: true })
  doc.fontSize(6).text(`Ambiente gerador: ${d.ambGer}`, xMun + RESPIRO, cm(0.93), { width: wMun - 2 * RESPIRO, lineBreak: false, ellipsis: true })
  doc.text(`Tipo de ambiente: ${descrever(TP_AMB, d.tpAmb)}`, xMun + RESPIRO, cm(1.16), { width: wMun - 2 * RESPIRO, lineBreak: false, ellipsis: true })

  // ---- dados da NFS-e (item 2.1.2), com o QR Code à direita ----
  g.y = cm(1.48)
  const yDados = g.y
  const wIdent = cm(15.3)
  g.campo(X0, g.y, wIdent, 'CHAVE DE ACESSO DA NFS-e', d.chave || TRACO, { h: cm(0.77), rotuloMaiusculo: true })
  g.y += cm(0.77)
  const w3 = wIdent / 3
  const linhaIdent = (campos: Array<[string, string, boolean?]>) => {
    campos.forEach(([rotulo, valor, sombreado], i) => g.campo(X0 + i * w3, g.y, w3, rotulo, valor, { h: cm(0.67), rotuloMaiusculo: true, sombreado }))
    g.y += cm(0.67)
  }
  linhaIdent([['NÚMERO DA NFS-e', d.nNFSe], ['COMPETÊNCIA DA NFS-e', d.dCompet], ['DATA E HORA DA EMISSÃO DA NFS-e', d.dhProc]])
  linhaIdent([['NÚMERO DA DPS', d.nDPS], ['SÉRIE DA DPS', d.serie], ['DATA E HORA DA EMISSÃO DA DPS', d.dhEmi]])
  linhaIdent([['EMITENTE DA NFS-e', d.tpEmit, true], ['SITUAÇÃO DA NFS-e', d.cStat], ['FINALIDADE', d.finNFSe]])
  const hDados = g.y - yDados
  // quadro do QR Code (mínimo 1,52 cm) e do texto de autenticidade
  const xQr = X0 + wIdent
  const wQr = LARGURA - wIdent
  doc.lineWidth(0.5).rect(xQr, yDados, wQr, hDados).stroke()
  const qr = await QRCode.toBuffer(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${d.chave}`, { errorCorrectionLevel: 'M', margin: 0, width: 360 })
  const ladoQr = cm(1.6)
  doc.image(qr, xQr + (wQr - ladoQr) / 2, yDados + cm(0.15), { width: ladoQr, height: ladoQr })
  doc.font(FONTE).fontSize(6).text(
    'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e',
    xQr + RESPIRO,
    yDados + cm(0.15) + ladoQr + cm(0.1),
    { width: wQr - 2 * RESPIRO, align: 'center', height: hDados - ladoQr - cm(0.3), ellipsis: true },
  )

  // ---- pessoas ----
  g.pessoa('PRESTADOR / FORNECEDOR', d.prestador, '', [
    { rotulo: 'Simples Nacional na Data de Competência', valor: d.prestador.simplesNacional, colunas: 2 },
    { rotulo: 'Regime de Apuração Tributária pelo SN', valor: d.prestador.regimeApuracao, colunas: 2 },
  ])
  g.pessoa('TOMADOR / ADQUIRENTE', d.tomador, 'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')
  if (d.destinatarioEhTomador) g.linhaSuprimida('O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO')
  else g.pessoa('DESTINATÁRIO DA OPERAÇÃO', d.destinatario, 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')
  g.pessoa('INTERMEDIÁRIO DA OPERAÇÃO', d.intermediario, 'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e')

  // ---- serviço prestado: a descrição cresce com o espaço que sobrar na página ----
  g.linha(
    [
      { rotulo: 'Código de Tributação Nacional / Municipal', valor: d.servico.codigos },
      { rotulo: 'Código da NBS', valor: d.servico.nbs },
      { rotulo: 'Local da Prestação / Sigla UF / País', valor: d.servico.localPrestacao },
    ],
    'SERVIÇO PRESTADO',
  )
  const yDescricaoCodigo = g.y
  g.y += cm(0.38)
  const yDescricao = g.y
  g.y += ALTURA_CAMPO // altura mínima; ajustada no fim

  // Os blocos seguintes têm altura fixa: medimos para saber quanto sobra para a descrição.
  const alturaIssqn = d.issqn ? ALTURA_CAMPO * (1 + (d.issqn.temLinhaRegime ? 1 : 0) + (d.issqn.temLinhaBeneficio ? 1 : 0) + 1) : ALTURA_LINHA_SUPRIMIDA
  const alturaFederal = ALTURA_CAMPO * (d.federal.imprimirPisCofins ? 2 : 1)
  const alturaIbsCbs = ALTURA_CAMPO * 4
  const alturaTotal = ALTURA_CAMPO * 2
  const alturaInfoTitulo = cm(0.39)
  const alturaInfoMinima = cm(0.8)
  const fimUtil = doc.page.height - cm(0.3)
  const sobra = fimUtil - (g.y + alturaIssqn + alturaFederal + alturaIbsCbs + alturaTotal + alturaInfoTitulo + alturaInfoMinima)
  // a sobra vai metade para a descrição do serviço, metade para as informações complementares
  const extraDescricao = Math.max(0, sobra) * 0.55
  const alturaDescricao = ALTURA_CAMPO + extraDescricao
  g.y = yDescricao + alturaDescricao

  doc.lineWidth(0.5).rect(X0, yDescricaoCodigo, LARGURA, cm(0.38)).stroke()
  doc.font(FONTE).fontSize(7).text(d.servico.descricaoCodigo, X0 + RESPIRO, yDescricaoCodigo + cm(0.08), { width: LARGURA - 2 * RESPIRO, lineBreak: false, ellipsis: true })
  g.campo(X0, yDescricao, LARGURA, 'Descrição do Serviço', d.servico.descricao, { h: alturaDescricao, multilinha: true })

  // ---- tributação municipal (ISSQN) ----
  if (!d.issqn) {
    g.linhaSuprimida('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN')
  } else {
    g.linha(
      [
        { rotulo: 'Tipo de Tributação do ISSQN', valor: d.issqn.tipo },
        { rotulo: 'Município / Sigla UF / País da Incidência do ISSQN', valor: d.issqn.localIncidencia, colunas: 2 },
      ],
      'TRIBUTAÇÃO MUNICIPAL (ISSQN)',
    )
    if (d.issqn.temLinhaRegime) {
      g.linha([
        { rotulo: 'Regime Especial de Tributação do ISSQN', valor: d.issqn.regimeEspecial },
        { rotulo: 'Tipo de Imunidade do ISSQN', valor: d.issqn.imunidade },
        { rotulo: 'Suspensão da Exigibilidade do ISSQN', valor: d.issqn.suspensao },
        { rotulo: 'Número Processo Suspensão', valor: d.issqn.processo },
      ])
    }
    if (d.issqn.temLinhaBeneficio) {
      g.linha([
        { rotulo: 'Benefício Municipal', valor: d.issqn.beneficio },
        { rotulo: 'Cálculo do BM', valor: d.issqn.calculoBm },
        { rotulo: 'Total Deduções/Reduções', valor: d.issqn.deducoes },
        { rotulo: 'Desconto Incondicionado', valor: d.issqn.descontoIncond },
      ])
    }
    g.linha([
      { rotulo: 'BC ISSQN', valor: d.issqn.baseCalculo },
      { rotulo: 'Alíquota Aplicada', valor: d.issqn.aliquota },
      { rotulo: 'Retenção do ISSQN', valor: d.issqn.retencao },
      { rotulo: 'ISSQN Apurado', valor: d.issqn.valor },
    ])
  }

  // ---- tributação federal ----
  g.linha(
    [
      { rotulo: 'IRRF', valor: d.federal.irrf },
      { rotulo: 'Contribuição Previdenciária - Retida', valor: d.federal.cp },
      { rotulo: 'Contribuições Sociais - Retidas', valor: d.federal.sociais },
    ],
    'TRIBUTAÇÃO FEDERAL (EXCETO CBS)',
  )
  if (d.federal.imprimirPisCofins) {
    g.linha([
      { rotulo: 'PIS - Débito Apuração Própria', valor: d.federal.pis },
      { rotulo: 'COFINS - Débito Apuração Própria', valor: d.federal.cofins },
      { rotulo: 'Descrição Contrib. Sociais - Retidas', valor: d.federal.descricaoRetencao, colunas: 2 },
    ])
  }

  // ---- IBS / CBS ----
  const i = d.ibsCbs
  g.linha(
    [
      { rotulo: 'CST / cClassTrib', valor: i.cst },
      { rotulo: 'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', valor: i.indicador, colunas: 2 },
    ],
    'TRIBUTAÇÃO IBS / CBS',
  )
  g.linha([
    { rotulo: 'Exclusões e Reduções da Base de Cálculo', valor: i.exclusoes },
    { rotulo: 'Base de Cálculo Após Exclusões e Reduções', valor: i.baseCalculo },
    { rotulo: 'Red. Alíquota IBS / Red. Alíquota CBS', valor: i.reducoesAliquota },
    { rotulo: 'Alíquota - IBS UF / IBS Mun', valor: i.aliquotasIbs },
  ])
  g.linha([
    { rotulo: 'Alíq. Efetiva Municipal - IBS', valor: i.aliqEfetMun },
    { rotulo: 'Valor Apurado Municipal - IBS', valor: i.vIbsMun },
    { rotulo: 'Alíq. Efetiva Estadual - IBS', valor: i.aliqEfetUf },
    { rotulo: 'Valor Apurado Estadual - IBS', valor: i.vIbsUf },
  ])
  g.linha([
    { rotulo: 'Valor Total Apurado - IBS', valor: i.vIbsTot },
    { rotulo: 'Alíquota - CBS', valor: i.pCbs },
    { rotulo: 'Alíquota Efetiva - CBS', valor: i.pAliqEfetCbs },
    { rotulo: 'Valor Total Apurado - CBS', valor: i.vCbs },
  ])

  // ---- valor total ----
  g.linha(
    [
      { rotulo: 'Valor da Operação / Serviço', valor: d.total.servico },
      { rotulo: 'Desconto Incondicionado', valor: d.total.descIncond },
      { rotulo: 'Desconto Condicionado', valor: d.total.descCond },
    ],
    'VALOR TOTAL DA NFS-e',
  )
  g.linha([
    { rotulo: 'Total das Retenções (ISSQN / Federais)', valor: d.total.retencoes },
    { rotulo: 'Valor Líquido da NFS-e', valor: d.total.liquido },
    { rotulo: 'Total do IBS/CBS', valor: d.total.ibsCbs },
    { rotulo: 'Valor Líquido da NFS-e + IBS/CBS', valor: d.total.totalNota, sombreado: true },
  ])

  // ---- informações complementares: ocupa o que restou da página ----
  g.faixa('INFORMAÇÕES COMPLEMENTARES', alturaInfoTitulo)
  const alturaInfo = Math.max(alturaInfoMinima, fimUtil - g.y)
  doc.lineWidth(0.5).rect(X0, g.y, LARGURA, alturaInfo).stroke()
  doc.font(FONTE).fontSize(7).text(d.informacoesComplementares, X0 + RESPIRO, g.y + cm(0.08), { width: LARGURA - 2 * RESPIRO, height: alturaInfo - cm(0.16), ellipsis: true, lineGap: 0.5 })

  // ---- marca d'água (itens 2.5.1 e 2.5.2): diagonal, ≥ 50pt, cinza K35 ----
  if (opcoes.marcaDagua) {
    doc.save()
    doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] })
    doc.font(FONTE).fontSize(72).fillColor('#A6A6A6')
    doc.text(opcoes.marcaDagua, 0, doc.page.height / 2 - 36, { width: doc.page.width, align: 'center', lineBreak: false })
    doc.restore()
  }

  doc.end()
  await fim
  return Buffer.concat(partes)
}
