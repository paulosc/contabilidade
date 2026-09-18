/**
 * Guias de pagamento que o escritório entrega ao cliente: DAS (Simples Nacional), DARF
 * (receitas federais) e recibo de honorários.
 *
 * DAS e DARF só a Receita Federal emite — o número do documento e o código de barras nascem lá
 * (PGDAS-D, DCTFWeb, Sicalc). Este módulo NÃO gera essas guias: ele lê o PDF oficial que o
 * contador já emitiu e tira dele o que o cliente precisa para pagar e acompanhar. Nada é
 * deduzido: tudo vem do texto do documento, e o valor é conferido com o que está codificado no
 * próprio código de barras (padrão FEBRABAN de arrecadação, 44 posições).
 *
 * O recibo de honorários é documento do próprio escritório, então esse o sistema gera
 * (ver reciboHonorarios.ts).
 */

export type TipoGuia = 'das' | 'darf' | 'honorarios' | 'outro'

export interface ItemComposicao {
  codigo: string
  denominacao: string
  principal: number
  total: number
}

export interface GuiaLida {
  tipo: TipoGuia
  /** CNPJ/CPF do contribuinte impresso na guia, só dígitos */
  documentoContribuinte?: string
  contribuinte?: string
  /** Número do documento de arrecadação (DAS/DARF) ou número do recibo */
  numeroDocumento?: string
  /** Período de apuração / competência, 'AAAA-MM' */
  periodo?: string
  /** 'AAAA-MM-DD' */
  vencimento?: string
  emissao?: string
  valor?: number
  /** 48 dígitos (4 blocos de 11 + DV), como se digita no banco */
  linhaDigitavel?: string
  /** 44 dígitos */
  codigoBarras?: string
  /** Os quatro dígitos verificadores da linha digitável conferem */
  linhaDigitavelValida?: boolean
  composicao: ItemComposicao[]
  descricao?: string
  /** Quem emitiu (recibo de honorários) */
  emitente?: string
  observacoes?: string
  /** O que não foi possível ler — a tela mostra para o usuário conferir no PDF */
  avisos: string[]
}

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', marco: '03', 'março': '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

/** "1.114,22" → 1114.22 */
export const valorBr = (v: string): number => Number(v.replace(/\./g, '').replace(',', '.'))

/** "21/09/2026" → "2026-09-21" */
const dataIso = (v: string): string => v.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1')

// ---------- código de barras de arrecadação (FEBRABAN) ----------

function dvModulo10(bloco: string): number {
  let soma = 0
  let peso = 2
  for (let i = bloco.length - 1; i >= 0; i--) {
    const p = Number(bloco[i]) * peso
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p
    peso = peso === 2 ? 1 : 2
  }
  return (10 - (soma % 10)) % 10
}

function dvModulo11(bloco: string): number {
  let soma = 0
  let peso = 2
  for (let i = bloco.length - 1; i >= 0; i--) {
    soma += Number(bloco[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  if (resto === 0 || resto === 1) return 0
  if (resto === 10) return 1
  return 11 - resto
}

export interface LinhaArrecadacao {
  linhaDigitavel: string
  codigoBarras: string
  valor: number
  valida: boolean
}

/**
 * Lê a linha digitável de um documento de arrecadação (começa com 8): quatro blocos de 11
 * dígitos, cada um com seu DV. O 3º dígito diz como o DV é calculado (6/7 = módulo 10,
 * 8/9 = módulo 11) e as posições 5–15 do código de barras trazem o valor.
 */
export function lerLinhaArrecadacao(texto: string): LinhaArrecadacao | undefined {
  const blocos = [...texto.matchAll(/(?<!\d)(\d{11})[ -](\d)(?!\d)/g)].map((m) => ({ bloco: m[1], dv: Number(m[2]) }))
  const inicio = blocos.findIndex((b) => b.bloco.startsWith('8'))
  if (inicio < 0 || blocos.length < inicio + 4) return undefined
  const quatro = blocos.slice(inicio, inicio + 4)
  const codigoBarras = quatro.map((b) => b.bloco).join('')
  const identificadorValor = codigoBarras[2]
  const dv = identificadorValor === '6' || identificadorValor === '7' ? dvModulo10 : dvModulo11
  return {
    linhaDigitavel: quatro.map((b) => `${b.bloco}${b.dv}`).join(''),
    codigoBarras,
    valor: Number(codigoBarras.slice(4, 15)) / 100,
    valida: quatro.every((b) => dv(b.bloco) === b.dv),
  }
}

/** "858000000119142203282622640720262574169951320258" → "85800000011-9 14220328262-2 …" */
export const formatarLinhaDigitavel = (linha: string): string =>
  soDigitos(linha).replace(/(\d{11})(\d)/g, '$1-$2 ').trim()

// ---------- leitura ----------

function tipoDaGuia(texto: string): TipoGuia {
  const t = texto.replace(/\s+/g, ' ')
  if (/Documento de Arrecada[çc][ãa]o do Simples Nacional/i.test(t)) return 'das'
  if (/Documento de Arrecada[çc][ãa]o de Receitas Federais/i.test(t)) return 'darf'
  if (/RECIBO DE HONOR[ÁA]RIOS/i.test(t)) return 'honorarios'
  return 'outro'
}

function periodoDe(texto: string): string | undefined {
  const porExtenso = /\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/(\d{4})\b/i.exec(texto)
  if (porExtenso) return `${porExtenso[2]}-${MESES[porExtenso[1].toLowerCase()]}`
  const pa = /PA:\s*(\d{2})\/(\d{4})/.exec(texto)
  if (pa) return `${pa[2]}-${pa[1]}`
  return undefined
}

/** Linhas "1001 IRPJ - SIMPLES NACIONAL 44,57 44,57" da composição do documento. */
function composicaoDe(texto: string): ItemComposicao[] {
  const itens: ItemComposicao[] = []
  for (const m of texto.matchAll(/^(\d{4}) (.+?) ([\d.]+,\d{2})(?: [\d.]+,\d{2})*? ([\d.]+,\d{2})$/gm)) {
    itens.push({ codigo: m[1], denominacao: m[2].trim(), principal: valorBr(m[3]), total: valorBr(m[4]) })
  }
  return itens
}

function lerArrecadacao(texto: string, tipo: 'das' | 'darf'): GuiaLida {
  const avisos: string[] = []
  const linha = lerLinhaArrecadacao(texto)
  const cnpj = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.exec(texto)?.[0]
  const contribuinte = cnpj ? new RegExp(`${cnpj.replace(/[./-]/g, '\\$&')} +(.+)`).exec(texto)?.[1]?.trim() : undefined
  const numero = /\b\d{2}\.\d{2}\.\d{5}\.\d{7}-\d\b/.exec(texto)?.[0]
  const vencimento = /Pagar at[ée]:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto)?.[1] ?? /Pagar este documento at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto)?.[1]
  const valorImpresso = /Valor:\s*([\d.]+,\d{2})/.exec(texto)?.[1] ?? /Valor Total do Documento\s*([\d.]+,\d{2})/.exec(texto)?.[1]
  const observacoes = /N[ºo] Recibo Declara[çc][ãa]o:\s*\d+/.exec(texto)?.[0]

  let valor = valorImpresso ? valorBr(valorImpresso) : undefined
  if (linha) {
    if (!linha.valida) avisos.push('Os dígitos verificadores da linha digitável não conferem — confira no PDF antes de pagar.')
    if (valor !== undefined && Math.abs(valor - linha.valor) > 0.004) {
      avisos.push(`O valor impresso (${valorImpresso}) difere do valor no código de barras.`)
    }
    // o código de barras é o que o banco lê: na dúvida, ele manda
    valor = linha.valor
  } else avisos.push('Não foi possível ler a linha digitável.')

  let composicao = composicaoDe(texto)
  const soma = composicao.reduce((s, i) => s + i.total, 0)
  if (composicao.length && valor !== undefined && Math.abs(soma - valor) > 0.009) {
    // leitura parcial da tabela engana mais do que ajuda
    composicao = []
    avisos.push('A composição por tributo não pôde ser lida com segurança.')
  }

  if (!numero) avisos.push('Número do documento não encontrado.')
  if (!vencimento) avisos.push('Data de vencimento não encontrada.')
  if (valor === undefined) avisos.push('Valor não encontrado.')

  return {
    tipo,
    documentoContribuinte: cnpj ? soDigitos(cnpj) : undefined,
    contribuinte,
    numeroDocumento: numero,
    periodo: periodoDe(texto),
    vencimento: vencimento ? dataIso(vencimento) : undefined,
    valor,
    linhaDigitavel: linha?.linhaDigitavel,
    codigoBarras: linha?.codigoBarras,
    linhaDigitavelValida: linha?.valida,
    composicao,
    descricao: tipo === 'das' ? 'DAS — Simples Nacional' : composicao[0]?.denominacao ? `DARF — ${composicao[0].denominacao}` : 'DARF',
    observacoes,
    avisos,
  }
}

function lerHonorarios(texto: string): GuiaLida {
  const avisos: string[] = []
  const numero = /N[ºo°]\s*(\d{3,})/.exec(texto)?.[1]
  const emissao = /(\d{2}\/\d{2}\/\d{4})\s*Emiss[ãa]o|Emiss[ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto)
  const vencimento = /Vencimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})|(\d{2}\/\d{2}\/\d{4})\s*Vencimento/i.exec(texto)
  const descricao = /(Honor[áa]rios?[^\n\d]*?(?:\d{2}[ /]\d{4})?)(?=\d?\s*$)/im.exec(texto)?.[1]?.trim() ?? /(Honor[áa]ri[^\n]+)/i.exec(texto)?.[1]?.trim()
  const competencia = /\b(\d{2})[ /](\d{4})\b/.exec(descricao ?? '')
  const total = /Sub-?Total\s*([\d.]+,\d{2})/i.exec(texto)?.[1] ?? /Total\s*([\d.]+,\d{2})/i.exec(texto)?.[1]
  // sem rótulo confiável, o valor é a quantia que mais se repete no recibo (item, subtotal, total)
  const quantias = [...texto.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d,])/g)].map((m) => m[1]).filter((q) => valorBr(q) > 0)
  const maisFrequente = [...new Set(quantias)].sort((a, b) => quantias.filter((q) => q === b).length - quantias.filter((q) => q === a).length)[0]
  const valorTexto = total && valorBr(total) > 0 ? total : maisFrequente
  const emitente = /^(.+?)\s*\n?\s*CPF\s*:/im.exec(texto)?.[1]?.trim() ?? /^(.*\bCONT[ÁA]B\w*.*)$/im.exec(texto)?.[1]?.trim()
  const cliente = /^(.+)\n.*\n.*\n?Cliente/m.exec(texto)?.[1]?.trim()

  if (!vencimento) avisos.push('Data de vencimento não encontrada.')
  if (!valorTexto) avisos.push('Valor não encontrado.')

  return {
    tipo: 'honorarios',
    contribuinte: cliente,
    numeroDocumento: numero,
    periodo: competencia ? `${competencia[2]}-${competencia[1]}` : undefined,
    emissao: emissao ? dataIso(emissao[1] ?? emissao[2]) : undefined,
    vencimento: vencimento ? dataIso(vencimento[1] ?? vencimento[2]) : undefined,
    valor: valorTexto ? valorBr(valorTexto) : undefined,
    composicao: [],
    descricao: descricao ?? 'Honorários contábeis',
    emitente,
    avisos,
  }
}

/** Lê o texto extraído de um PDF de guia e devolve o que dá para afirmar a partir dele. */
export function lerGuia(texto: string): GuiaLida {
  const tipo = tipoDaGuia(texto)
  if (tipo === 'das' || tipo === 'darf') return lerArrecadacao(texto, tipo)
  if (tipo === 'honorarios') return lerHonorarios(texto)

  // Documento desconhecido: ainda assim tenta a linha de arrecadação, que é padronizada.
  const linha = lerLinhaArrecadacao(texto)
  return {
    tipo: 'outro',
    valor: linha?.valor,
    linhaDigitavel: linha?.linhaDigitavel,
    codigoBarras: linha?.codigoBarras,
    linhaDigitavelValida: linha?.valida,
    composicao: [],
    avisos: ['Tipo de documento não reconhecido: confira e complete os dados pelo PDF.'],
  }
}

/** Id estável: reenviar o mesmo PDF não duplica a guia. */
export function idDaGuia(guia: GuiaLida, hashPdf: string): string {
  const numero = soDigitos(guia.numeroDocumento ?? '')
  if ((guia.tipo === 'das' || guia.tipo === 'darf') && numero) return `${guia.tipo}-${numero}`
  if (guia.tipo === 'honorarios' && numero) return `hon-${numero}`
  return `pdf-${hashPdf.slice(0, 24)}`
}

// ---------- valor por extenso (para o recibo de honorários) ----------

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

function ate999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const partes: string[] = []
  const c = Math.floor(n / 100)
  const resto = n % 100
  if (c) partes.push(CENTENAS[c])
  if (resto < 20) {
    if (resto) partes.push(UNIDADES[resto])
  } else {
    const d = Math.floor(resto / 10)
    const u = resto % 10
    partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d])
  }
  return partes.join(' e ')
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero'
  const milhoes = Math.floor(n / 1_000_000)
  const milhares = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  const partes: string[] = []
  if (milhoes) partes.push(`${ate999(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`)
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`)
  if (resto) partes.push(ate999(resto))
  // "e" antes do último grupo quando ele é redondo na centena ou menor que cem
  if (partes.length > 1 && resto && (resto < 100 || resto % 100 === 0)) {
    const ultimo = partes.pop()!
    return `${partes.join(', ')} e ${ultimo}`
  }
  return partes.join(', ')
}

/** 265 → "duzentos e sessenta e cinco reais"; 1114.22 → "mil, cento e quatorze reais e vinte e dois centavos". */
export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(valor * 100)
  const reais = Math.floor(centavosTotais / 100)
  const centavos = centavosTotais % 100
  const partes: string[] = []
  if (reais) {
    const redondoEmMilhao = reais >= 1_000_000 && reais % 1_000_000 === 0
    partes.push(`${inteiroPorExtenso(reais)} ${reais === 1 ? 'real' : redondoEmMilhao ? 'de reais' : 'reais'}`)
  }
  if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`)
  return partes.length ? partes.join(' e ') : 'zero real'
}
