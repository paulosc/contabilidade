/**
 * Calendário de obrigações de um cliente do escritório — conta pura, sem banco.
 *
 * Cada obrigação diz a quem se aplica (pelo perfil fiscal da empresa), quando vence e o que
 * acontece quando o dia cai em fim de semana ou feriado: umas antecipam, outras prorrogam, e a
 * diferença está na norma de cada uma (citada em `base`). Só entram prazos nacionais: ISS próprio,
 * taxas e alvarás têm data municipal e o escritório cadastra à parte.
 *
 * "Dia útil" aqui é dia com expediente bancário: segunda a sexta, fora os feriados nacionais,
 * Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi. Feriado estadual ou municipal
 * não entra — se o banco da praça fechar, o prazo real pode mudar.
 */

export type Regime = 'simples' | 'mei' | 'presumido' | 'real'

export interface PerfilFiscal {
  regime: Regime
  temEmpregados: boolean
  temProLabore: boolean
  /** Tem o que declarar na EFD-Reinf: retenções, aluguéis, lucros distribuídos (R-4010) */
  temReinf: boolean
}

export type Ajuste = 'antecipa' | 'prorroga' | 'nenhum'
export type Area = 'fiscal' | 'pessoal' | 'contabil'

export interface Obrigacao {
  codigo: string
  nome: string
  area: Area
  /** 'legal' tem prazo em norma; 'interna' é rotina do escritório */
  tipo: 'legal' | 'interna'
  /** Período a que se refere: 'AAAA-MM', 'AAAA-Tn' ou 'AAAA' */
  competencia: string
  /** 'AAAA-MM-DD', já ajustado para dia útil */
  vencimento: string
  base: string
}

// ---------- dias úteis ----------

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const data = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia))
const maisDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano) */
export function pascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return data(ano, mes, dia)
}

const cacheFeriados = new Map<number, Set<string>>()

/** Dias sem expediente bancário no ano */
export function feriados(ano: number): Set<string> {
  const pronto = cacheFeriados.get(ano)
  if (pronto) return pronto
  const p = pascoa(ano)
  const lista = [
    data(ano, 1, 1), // Confraternização Universal
    maisDias(p, -48), // Carnaval (segunda)
    maisDias(p, -47), // Carnaval (terça)
    maisDias(p, -2), // Sexta-feira Santa
    data(ano, 4, 21), // Tiradentes
    data(ano, 5, 1), // Dia do Trabalho
    maisDias(p, 60), // Corpus Christi
    data(ano, 9, 7), // Independência
    data(ano, 10, 12), // Nossa Senhora Aparecida
    data(ano, 11, 2), // Finados
    data(ano, 11, 15), // Proclamação da República
    data(ano, 11, 20), // Consciência Negra (Lei 14.759/2023)
    data(ano, 12, 25), // Natal
  ]
  const conjunto = new Set(lista.map(iso))
  cacheFeriados.set(ano, conjunto)
  return conjunto
}

export const ehDiaUtil = (d: Date): boolean => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !feriados(d.getUTCFullYear()).has(iso(d))

function ajustar(d: Date, ajuste: Ajuste): Date {
  if (ajuste === 'nenhum') return d
  let r = d
  while (!ehDiaUtil(r)) r = maisDias(r, ajuste === 'antecipa' ? -1 : 1)
  return r
}

const ultimoDiaDoMes = (ano: number, mes: number) => data(ano, mes + 1, 0)
const ultimoDiaUtil = (ano: number, mes: number) => ajustar(ultimoDiaDoMes(ano, mes), 'antecipa')

/** 5º dia útil para pagamento de salário: sábado conta (IN SRT 1/1989), domingo e feriado não. */
function quintoDiaUtilDeSalario(ano: number, mes: number): Date {
  let d = data(ano, mes, 1)
  let contados = 0
  for (;;) {
    if (d.getUTCDay() !== 0 && !feriados(ano).has(iso(d))) contados++
    if (contados === 5) return d
    d = maisDias(d, 1)
  }
}

// ---------- catálogo ----------

interface Definicao {
  codigo: string
  nome: string
  area: Area
  tipo: 'legal' | 'interna'
  base: string
  aplica: (p: PerfilFiscal) => boolean
}

interface Mensal extends Definicao {
  /** Vencimento no mês SEGUINTE ao da competência */
  vence: (ano: number, mes: number) => Date
}

const diaFixo = (dia: number, ajuste: Ajuste) => (ano: number, mes: number) => ajustar(data(ano, mes, dia), ajuste)
const temFolha = (p: PerfilFiscal) => p.temEmpregados || p.temProLabore

const MENSAIS: Mensal[] = [
  { codigo: 'fechamento_faturamento', nome: 'Fechar o faturamento do mês (notas emitidas e canceladas)', area: 'fiscal', tipo: 'interna', base: 'Rotina do escritório', aplica: () => true, vence: diaFixo(5, 'prorroga') },
  { codigo: 'salarios', nome: 'Pagamento de salários e entrega dos holerites', area: 'pessoal', tipo: 'legal', base: 'CLT, art. 459, § 1º — até o 5º dia útil', aplica: (p) => p.temEmpregados, vence: quintoDiaUtilDeSalario },
  { codigo: 'folha', nome: 'Calcular e fechar a folha (salários e pró-labore)', area: 'pessoal', tipo: 'interna', base: 'Rotina do escritório — antes do eSocial', aplica: temFolha, vence: diaFixo(10, 'antecipa') },
  { codigo: 'esocial', nome: 'eSocial — eventos periódicos e fechamento (S-1200, S-1210, S-1299)', area: 'pessoal', tipo: 'legal', base: 'Manual de Orientação do eSocial — até o dia 15, antecipando quando não for útil', aplica: temFolha, vence: diaFixo(15, 'antecipa') },
  { codigo: 'efd_reinf', nome: 'EFD-Reinf (R-2000 e R-4000, inclusive lucros no R-4010)', area: 'fiscal', tipo: 'legal', base: 'IN RFB 2.043/2021, art. 6º — até o dia 15', aplica: (p) => p.temReinf, vence: diaFixo(15, 'prorroga') },
  { codigo: 'envio_guias', nome: 'Enviar as guias do mês ao cliente', area: 'fiscal', tipo: 'interna', base: 'Rotina do escritório — com folga antes do dia 20', aplica: () => true, vence: diaFixo(16, 'antecipa') },
  { codigo: 'pgdas', nome: 'PGDAS-D — apuração do Simples Nacional', area: 'fiscal', tipo: 'legal', base: 'Resolução CGSN 140/2018, art. 38 — até o vencimento do DAS', aplica: (p) => p.regime === 'simples', vence: diaFixo(20, 'prorroga') },
  { codigo: 'das', nome: 'DAS — pagamento do Simples Nacional', area: 'fiscal', tipo: 'legal', base: 'Resolução CGSN 140/2018, art. 40 — dia 20, prorrogando quando não for útil', aplica: (p) => p.regime === 'simples', vence: diaFixo(20, 'prorroga') },
  { codigo: 'das_mei', nome: 'DAS-MEI', area: 'fiscal', tipo: 'legal', base: 'Resolução CGSN 140/2018 — dia 20, prorrogando quando não for útil', aplica: (p) => p.regime === 'mei', vence: diaFixo(20, 'prorroga') },
  { codigo: 'darf_previdenciario', nome: 'DARF da DCTFWeb (INSS e IRRF da folha)', area: 'pessoal', tipo: 'legal', base: 'Lei 8.212/1991, art. 30, I, "b" e § 2º — dia 20, antecipando quando não for útil', aplica: (p) => temFolha(p) || p.temReinf, vence: diaFixo(20, 'antecipa') },
  { codigo: 'fgts', nome: 'FGTS Digital — guia do mês', area: 'pessoal', tipo: 'legal', base: 'Lei 8.036/1990, art. 15 — até o dia 20', aplica: (p) => p.temEmpregados, vence: diaFixo(20, 'antecipa') },
  { codigo: 'pis_cofins', nome: 'DARF de PIS e Cofins', area: 'fiscal', tipo: 'legal', base: 'Lei 11.933/2009, art. 18 — dia 25, antecipando quando não for útil', aplica: (p) => p.regime === 'presumido' || p.regime === 'real', vence: diaFixo(25, 'antecipa') },
  { codigo: 'dctfweb', nome: 'DCTFWeb — transmitir a declaração', area: 'pessoal', tipo: 'legal', base: 'IN RFB 2.237/2024 — último dia útil do mês seguinte (na prática, antes do DARF do dia 20)', aplica: (p) => temFolha(p) || p.temReinf, vence: ultimoDiaUtil },
  { codigo: 'conciliacao', nome: 'Conciliação bancária e lançamentos contábeis', area: 'contabil', tipo: 'interna', base: 'Rotina do escritório', aplica: (p) => p.regime !== 'mei', vence: ultimoDiaUtil },
  { codigo: 'balancete', nome: 'Balancete do mês', area: 'contabil', tipo: 'interna', base: 'Rotina do escritório', aplica: (p) => p.regime !== 'mei', vence: ultimoDiaUtil },
]

interface Anual extends Definicao {
  /** Mês do vencimento e data, dado o ano do VENCIMENTO; a competência é o ano anterior quando `anoAnterior` */
  mes: number
  vence: (ano: number) => Date
  anoAnterior: boolean
}

const ANUAIS: Anual[] = [
  { codigo: 'informe_rendimentos', nome: 'Informe de rendimentos a empregados e sócios', area: 'pessoal', tipo: 'legal', base: 'IN RFB 2.060/2021 — último dia útil de fevereiro', aplica: temFolha, mes: 2, vence: (a) => ultimoDiaUtil(a, 2), anoAnterior: true },
  { codigo: 'defis', nome: 'DEFIS — declaração anual do Simples Nacional', area: 'fiscal', tipo: 'legal', base: 'Resolução CGSN 140/2018, art. 72 — até 31 de março', aplica: (p) => p.regime === 'simples', mes: 3, vence: (a) => data(a, 3, 31), anoAnterior: true },
  { codigo: 'dasn_simei', nome: 'DASN-SIMEI — declaração anual do MEI', area: 'fiscal', tipo: 'legal', base: 'Resolução CGSN 140/2018, art. 109 — até 31 de maio', aplica: (p) => p.regime === 'mei', mes: 5, vence: (a) => data(a, 5, 31), anoAnterior: true },
  { codigo: 'ecd', nome: 'ECD — escrituração contábil digital', area: 'contabil', tipo: 'legal', base: 'IN RFB 2.003/2021 — último dia útil de junho', aplica: (p) => p.regime === 'presumido' || p.regime === 'real', mes: 6, vence: (a) => ultimoDiaUtil(a, 6), anoAnterior: true },
  { codigo: 'ecf', nome: 'ECF — escrituração contábil fiscal', area: 'contabil', tipo: 'legal', base: 'IN RFB 2.004/2021 — último dia útil de julho', aplica: (p) => p.regime === 'presumido' || p.regime === 'real', mes: 7, vence: (a) => ultimoDiaUtil(a, 7), anoAnterior: true },
  { codigo: 'decimo_terceiro_1', nome: '13º salário — 1ª parcela', area: 'pessoal', tipo: 'legal', base: 'Lei 4.749/1965, art. 2º — até 30 de novembro', aplica: (p) => p.temEmpregados, mes: 11, vence: (a) => ajustar(data(a, 11, 30), 'antecipa'), anoAnterior: false },
  { codigo: 'decimo_terceiro_2', nome: '13º salário — 2ª parcela', area: 'pessoal', tipo: 'legal', base: 'Lei 4.749/1965, art. 1º — até 20 de dezembro', aplica: (p) => p.temEmpregados, mes: 12, vence: (a) => ajustar(data(a, 12, 20), 'antecipa'), anoAnterior: false },
  { codigo: 'encerramento', nome: 'Balanço, DRE e carta de responsabilidade da administração', area: 'contabil', tipo: 'interna', base: 'Resolução CFC 1.590/2020, art. 3º — no encerramento do exercício', aplica: (p) => p.regime !== 'mei', mes: 3, vence: (a) => ultimoDiaUtil(a, 3), anoAnterior: true },
]

/** IRPJ e CSLL trimestrais (lucro presumido e real trimestral): último dia útil do mês seguinte ao trimestre. */
const TRIMESTRAL: Definicao = { codigo: 'irpj_csll', nome: 'DARF de IRPJ e CSLL do trimestre (quota única ou 1ª quota)', area: 'fiscal', tipo: 'legal', base: 'Lei 9.430/1996, art. 5º — último dia útil do mês seguinte ao trimestre', aplica: (p) => p.regime === 'presumido' || p.regime === 'real' }

const mesAnterior = (ano: number, mes: number): [number, number] => (mes === 1 ? [ano - 1, 12] : [ano, mes - 1])

/** Tudo o que vence no mês informado ('AAAA-MM') para uma empresa com este perfil, em ordem de vencimento. */
export function obrigacoesQueVencemEm(perfil: PerfilFiscal, mesDoVencimento: string): Obrigacao[] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mesDoVencimento)
  if (!m) throw new Error('Mês inválido')
  const ano = Number(m[1])
  const mes = Number(m[2])
  const [anoComp, mesComp] = mesAnterior(ano, mes)
  const competenciaMensal = `${anoComp}-${String(mesComp).padStart(2, '0')}`
  const sem = ({ aplica: _a, ...resto }: Definicao) => resto

  const lista: Obrigacao[] = []
  for (const o of MENSAIS) {
    if (!o.aplica(perfil)) continue
    const { vence: _v, ...def } = o
    lista.push({ ...sem(def), competencia: competenciaMensal, vencimento: iso(o.vence(ano, mes)) })
  }
  for (const o of ANUAIS) {
    if (o.mes !== mes || !o.aplica(perfil)) continue
    const { vence: _v, mes: _m, anoAnterior: _x, ...def } = o
    lista.push({ ...sem(def), competencia: String(o.anoAnterior ? ano - 1 : ano), vencimento: iso(o.vence(ano)) })
  }
  if ([1, 4, 7, 10].includes(mes) && TRIMESTRAL.aplica(perfil)) {
    const trimestre = mes === 1 ? 4 : (mes - 1) / 3
    lista.push({ ...sem(TRIMESTRAL), competencia: `${mes === 1 ? ano - 1 : ano}-T${trimestre}`, vencimento: iso(ultimoDiaUtil(ano, mes)) })
  }
  return lista.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.codigo.localeCompare(b.codigo))
}

export type SituacaoObrigacao = 'feita' | 'dispensada' | 'atrasada' | 'vence_hoje' | 'proxima' | 'futura'

/** Situação de uma obrigação na data de hoje ('AAAA-MM-DD'). "Próxima" = vence em até 5 dias. */
export function situacaoDaObrigacao(vencimento: string, marcacao: 'feita' | 'dispensada' | undefined, hoje: string): SituacaoObrigacao {
  if (marcacao) return marcacao
  if (vencimento < hoje) return 'atrasada'
  if (vencimento === hoje) return 'vence_hoje'
  const dias = (Date.parse(vencimento) - Date.parse(hoje)) / 86_400_000
  return dias <= 5 ? 'proxima' : 'futura'
}
