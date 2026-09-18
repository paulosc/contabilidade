/**
 * Leitor de extrato bancário em OFX — o formato que todo banco brasileiro exporta.
 *
 * Existem dois sabores e os dois aparecem na prática:
 *   OFX 1.x  SGML: cabeçalho "OFXHEADER:100" e tags de valor SEM fechamento (<TRNAMT>-12.50)
 *   OFX 2.x  XML bem formado
 * O leitor não depende de fechamento de tag: pega o texto entre a tag e o próximo "<".
 *
 * O que sai daqui é só o que o banco afirmou. Nenhuma transação é classificada neste ponto.
 */

export class ErroOfx extends Error {}

export interface TransacaoOfx {
  /** Identificador único da transação no banco (FITID) */
  fitid: string
  /** CREDIT, DEBIT, PAYMENT, XFER... como o banco informou */
  tipo: string
  /** 'AAAA-MM-DD' */
  data: string
  /** Positivo entra na conta, negativo sai */
  valor: number
  memo: string
  documento?: string
}

export interface ExtratoOfx {
  banco?: string
  agencia?: string
  conta?: string
  moeda?: string
  /** 'AAAA-MM-DD' */
  de?: string
  ate?: string
  saldoFinal?: number
  saldoEm?: string
  transacoes: TransacaoOfx[]
}

/** Bancos brasileiros mandam Windows-1252 ou UTF-8, nem sempre dizendo qual. */
export function decodificarOfx(bytes: Buffer): string {
  const inicio = bytes.subarray(0, 600).toString('latin1').toUpperCase()
  const dizUtf8 = /ENCODING:\s*UTF-?8|CHARSET:\s*UTF-?8|ENCODING="UTF-?8"/.test(inicio)
  const utf8 = bytes.toString('utf8')
  if (dizUtf8 || !utf8.includes(String.fromCharCode(0xfffd))) return utf8
  return bytes.toString('latin1')
}

const valorDaTag = (bloco: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(bloco)
  const v = m?.[1]?.trim()
  return v ? v : undefined
}

/** Datas do OFX: AAAAMMDD, opcionalmente com hora e fuso ("20260801120000[-3:BRT]"). Vale o dia informado. */
const dataOfx = (v?: string): string | undefined => {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v ?? '')
  if (!m) return undefined
  const [, a, mes, d] = m
  if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return undefined
  return `${a}-${mes}-${d}`
}

/** Valor do OFX: ponto decimal por norma, mas há banco que exporta com vírgula. */
const numeroOfx = (v?: string): number | undefined => {
  if (!v) return undefined
  const limpo = v.includes(',') && !v.includes('.') ? v.replace(',', '.') : v.replace(/,/g, '')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined
}

const entidades = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

export function lerOfx(texto: string): ExtratoOfx {
  if (!/<OFX>/i.test(texto)) throw new ErroOfx('Este arquivo não é um extrato OFX. No site do banco, exporte o extrato no formato OFX (às vezes chamado de "Money").')

  const transacoes: TransacaoOfx[] = []
  const blocos = texto.split(/<STMTTRN>/i).slice(1)
  for (const parte of blocos) {
    const bloco = parte.split(/<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>/i)[0]
    const data = dataOfx(valorDaTag(bloco, 'DTPOSTED'))
    const valor = numeroOfx(valorDaTag(bloco, 'TRNAMT'))
    if (!data || valor === undefined) continue
    const memo = entidades([valorDaTag(bloco, 'NAME'), valorDaTag(bloco, 'MEMO')].filter((x, i, l) => x && l.indexOf(x) === i).join(' — ')).replace(/\s+/g, ' ').trim()
    const documento = valorDaTag(bloco, 'CHECKNUM') ?? valorDaTag(bloco, 'REFNUM')
    transacoes.push({
      // sem FITID (raro), o conjunto data+valor+memo identifica — o serviço ainda desambigua repetidas
      fitid: valorDaTag(bloco, 'FITID') ?? '',
      tipo: (valorDaTag(bloco, 'TRNTYPE') ?? '').toUpperCase(),
      data,
      valor,
      memo,
      ...(documento ? { documento } : {}),
    })
  }

  const saldo = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(texto)?.[1] ?? ''
  return {
    banco: valorDaTag(texto, 'BANKID') ?? valorDaTag(texto, 'ORG'),
    agencia: valorDaTag(texto, 'BRANCHID'),
    conta: valorDaTag(texto, 'ACCTID'),
    moeda: valorDaTag(texto, 'CURDEF'),
    de: dataOfx(valorDaTag(texto, 'DTSTART')),
    ate: dataOfx(valorDaTag(texto, 'DTEND')),
    saldoFinal: numeroOfx(valorDaTag(saldo, 'BALAMT')),
    saldoEm: dataOfx(valorDaTag(saldo, 'DTASOF')),
    transacoes,
  }
}
