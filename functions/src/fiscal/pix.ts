/**
 * PIX "copia e cola" (BR Code estático) para cobrança no recibo de honorários.
 *
 * Formato: EMV QRCPS-MPM, como o Banco Central define no Manual de Padrões para Iniciação do Pix.
 * Cada campo é id (2) + tamanho (2) + valor; o último é o CRC16-CCITT (polinômio 0x1021, inicial
 * 0xFFFF) de todo o texto, incluindo o "6304" que o anuncia.
 *   00 formato "01" · 26 conta do recebedor { 00 "br.gov.bcb.pix", 01 chave } · 52 MCC "0000" ·
 *   53 moeda "986" · 54 valor · 58 "BR" · 59 nome (até 25) · 60 cidade (até 15) ·
 *   62 { 05 identificador, até 25 letras e números } · 63 CRC
 *
 * É QR estático: o dinheiro cai na chave informada, sem banco intermediando nem baixa automática.
 * Quem confere o pagamento é o escritório — por isso a guia continua sendo marcada como paga à mão.
 */

export type TipoChavePix = 'cpf_cnpj' | 'celular' | 'email' | 'aleatoria'

export class ErroPix extends Error {}

export function crc16(texto: string): string {
  let crc = 0xffff
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Só ASCII, sem acento: é o que os aplicativos de banco leem sem surpresa. */
const semAcento = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const campo = (id: string, valor: string): string => {
  if (valor.length > 99) throw new ErroPix(`Campo ${id} do PIX passou de 99 caracteres.`)
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`
}

/** Deixa a chave no formato que o DICT espera, conforme o tipo. */
export function normalizarChavePix(tipo: TipoChavePix, chave: string): string {
  const bruta = (chave ?? '').trim()
  if (!bruta) throw new ErroPix('Informe a chave PIX.')
  if (tipo === 'cpf_cnpj') {
    const d = bruta.replace(/\D/g, '')
    if (d.length !== 11 && d.length !== 14) throw new ErroPix('Chave PIX de CPF/CNPJ deve ter 11 ou 14 dígitos.')
    return d
  }
  if (tipo === 'celular') {
    let d = bruta.replace(/\D/g, '')
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
    if (d.length !== 10 && d.length !== 11) throw new ErroPix('Chave PIX de celular: informe DDD + número.')
    return `+55${d}`
  }
  if (tipo === 'email') {
    const e = bruta.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) throw new ErroPix('Chave PIX de e-mail inválida.')
    return e
  }
  const u = bruta.toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)) throw new ErroPix('Chave aleatória deve ter o formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.')
  return u
}

export interface DadosPix {
  /** Chave já normalizada */
  chave: string
  nome: string
  cidade: string
  valor?: number
  /** Até 25 letras e números; identifica a cobrança no extrato de quem recebe */
  identificador?: string
}

export function gerarPixCopiaECola(d: DadosPix): string {
  const nome = semAcento(d.nome).toUpperCase().slice(0, 25).trim()
  const cidade = semAcento(d.cidade).toUpperCase().slice(0, 15).trim()
  if (!nome) throw new ErroPix('Informe o nome do recebedor do PIX.')
  if (!cidade) throw new ErroPix('Informe a cidade do recebedor do PIX.')
  const identificador = (d.identificador ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'

  const partes = [
    campo('00', '01'),
    campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', d.chave)),
    campo('52', '0000'),
    campo('53', '986'),
    d.valor && d.valor > 0 ? campo('54', d.valor.toFixed(2)) : '',
    campo('58', 'BR'),
    campo('59', nome),
    campo('60', cidade),
    campo('62', campo('05', identificador)),
    '6304',
  ].join('')
  return partes + crc16(partes)
}
