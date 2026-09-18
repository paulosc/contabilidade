/**
 * 13º salário (gratificação de Natal) — conta pura.
 *
 * Decreto 10.854/2021 (que regulamenta as Leis 4.090/1962 e 4.749/1965):
 *   art. 76     1/12 da remuneração de dezembro por mês de serviço no ano; fração de 15 dias ou
 *               mais conta como mês inteiro; pagamento até 20 de dezembro;
 *   art. 77     quem tem salário variável soma 1/11 dos variáveis devidos até novembro;
 *   art. 78     adiantamento (1ª parcela) entre fevereiro e novembro: metade do salário do mês
 *               anterior; § 4º — admitido no ano: metade de 1/12 por mês de serviço;
 *               § 3º — o adiantamento é abatido da gratificação devida;
 *   art. 81     faltas legais e justificadas não reduzem os avos.
 * INSS: incide sobre o valor total, só no pagamento final e em separado do salário do mês
 *   (Lei 8.212/1991, art. 28, § 7º; Decreto 3.048/1999, art. 214, §§ 6º e 7º).
 * IRRF: exclusivo na fonte, sobre o valor total, em separado dos demais rendimentos, no
 *   pagamento final (Lei 7.713/1988, art. 26; Lei 8.134/1990, art. 16). As deduções são as do
 *   próprio 13º, e o desconto simplificado vale quando mais benéfico (Perguntas e Respostas IRPF
 *   2026 da Receita, pergunta 332). A redução da Lei 15.270/2025 também se aplica (Lei 9.250/1995,
 *   art. 3º-A, § 3º).
 * FGTS: incide na 1ª e na 2ª parcela (Lei 8.036/1990, art. 15).
 *
 * Fora daqui, de propósito: 13º na rescisão (art. 82), afastamento por benefício previdenciário
 * (parte do 13º é paga pelo INSS) e o ajuste de janeiro dos variáveis (art. 77, parágrafo único).
 */
import { arredondar, calcularIrrf, inssProgressivo, type DetalheIrrf } from './calculo'
import { tabelaFgts, tabelaInss, tabelaIrrf } from './tabelas'

export class ErroDecimoTerceiro extends Error {}

const diasDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate()

/**
 * Avos do ano: meses com 15 dias ou mais de serviço, da admissão até `ateMes` (inclusive).
 * `mesesSemDireito` são os meses em que o empregado não ficou à disposição (afastamentos sem
 * direito), informados por quem conhece o caso — faltas legais e justificadas NÃO entram aí.
 */
export function avosDoAno(ano: number, dataAdmissao: string, ateMes = 12, mesesSemDireito = 0): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataAdmissao)
  if (!m) throw new ErroDecimoTerceiro('Data de admissão inválida.')
  const [anoAdm, mesAdm, diaAdm] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (anoAdm > ano) return 0
  let avos = 0
  for (let mes = 1; mes <= Math.min(Math.max(ateMes, 0), 12); mes++) {
    if (anoAdm < ano || mes > mesAdm) avos++
    else if (mes === mesAdm && diasDoMes(ano, mes) - diaAdm + 1 >= 15) avos++
  }
  return Math.max(0, avos - Math.max(0, Math.floor(mesesSemDireito)))
}

export interface EntradaDecimoTerceiro {
  ano: number
  tipo: 'empregado' | 'aprendiz'
  /** 'AAAA-MM-DD' */
  dataAdmissao: string
  /** Remuneração fixa devida em dezembro (na 1ª parcela, a do mês anterior ao pagamento) */
  salario: number
  /** Soma dos variáveis (horas extras, comissões...) devidos de janeiro a novembro */
  variaveisAteNovembro?: number
  mesesSemDireito?: number
  dependentes?: number
  pensaoAlimenticia?: number
  /** Mês em que a 1ª parcela é (ou foi) paga: de 2 a 11 */
  mesDoAdiantamento?: number
  /** Valor efetivamente pago na 1ª parcela, quando diferente do calculado aqui */
  adiantamentoPago?: number
}

export interface DecimoTerceiro {
  avos: number
  /** Gratificação devida no ano: fixo × avos/12 + variáveis/11 */
  bruto: number
  primeiraParcela: { mes: number; avos: number; valor: number; fgts: number }
  segundaParcela: { adiantamentoAbatido: number; inss: number; irrf: DetalheIrrf; liquido: number; fgts: number }
  avisos: string[]
}

export function calcularDecimoTerceiro(e: EntradaDecimoTerceiro): DecimoTerceiro {
  if (!(e.salario > 0)) throw new ErroDecimoTerceiro('Informe a remuneração.')
  if (!Number.isInteger(e.ano) || e.ano < 2020) throw new ErroDecimoTerceiro('Ano inválido.')
  const mesDoAdiantamento = e.mesDoAdiantamento ?? 11
  if (mesDoAdiantamento < 2 || mesDoAdiantamento > 11) throw new ErroDecimoTerceiro('O adiantamento é pago entre fevereiro e novembro.')

  const competencia = `${e.ano}-12`
  const avos = avosDoAno(e.ano, e.dataAdmissao, 12, e.mesesSemDireito)
  const avisos: string[] = []
  if (avos === 0) avisos.push('Nenhum mês com 15 dias ou mais de serviço no ano: não há 13º a pagar.')

  const variaveis = arredondar((e.variaveisAteNovembro ?? 0) / 11)
  const bruto = avos === 0 ? 0 : arredondar((e.salario * avos) / 12 + variaveis)

  // 1ª parcela: metade do salário para quem trabalhou o ano todo; metade de 1/12 por mês de serviço
  // até o mês anterior ao pagamento para quem foi admitido (ou ficou afastado) no ano — art. 78, caput e § 4º
  const anoTodo = avosDoAno(e.ano, e.dataAdmissao, 12, 0) === 12 && !(e.mesesSemDireito && e.mesesSemDireito > 0)
  const avosAteOAdiantamento = avosDoAno(e.ano, e.dataAdmissao, mesDoAdiantamento - 1, e.mesesSemDireito)
  const primeiraCalculada = avos === 0 ? 0 : anoTodo ? arredondar(e.salario / 2) : arredondar((e.salario * avosAteOAdiantamento) / 12 / 2)
  const adiantamento = e.adiantamentoPago !== undefined ? arredondar(Math.max(0, e.adiantamentoPago)) : primeiraCalculada
  if (e.adiantamentoPago !== undefined && Math.abs(e.adiantamentoPago - primeiraCalculada) > 0.01) avisos.push(`O adiantamento informado (${adiantamento.toFixed(2)}) difere do calculado pela regra do art. 78 (${primeiraCalculada.toFixed(2)}).`)
  if (adiantamento > bruto) avisos.push('O adiantamento pago é maior que o 13º devido: a diferença é compensada com outros créditos do empregado.')

  const aliquotaFgts = e.tipo === 'aprendiz' ? tabelaFgts(competencia).aliquotaAprendiz : tabelaFgts(competencia).aliquota
  const inss = inssProgressivo(bruto, tabelaInss(competencia))
  const irrf = calcularIrrf(bruto, inss, e.dependentes ?? 0, e.pensaoAlimenticia ?? 0, tabelaIrrf(competencia))
  const abatido = Math.min(adiantamento, bruto)

  return {
    avos,
    bruto,
    primeiraParcela: { mes: mesDoAdiantamento, avos: anoTodo ? 12 : avosAteOAdiantamento, valor: adiantamento, fgts: arredondar(adiantamento * aliquotaFgts) },
    segundaParcela: {
      adiantamentoAbatido: abatido,
      inss,
      irrf,
      liquido: arredondar(bruto - abatido - inss - irrf.valor - (e.pensaoAlimenticia ?? 0)),
      fgts: arredondar((bruto - abatido) * aliquotaFgts),
    },
    avisos,
  }
}
