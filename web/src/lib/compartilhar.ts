import { formatBRL } from './utils'
import { TIPOS_GUIA, formatarLinhaDigitavel, periodoLegivel } from './guias'
import type { Guia } from '../types'

const dataBr = (iso?: string) => (iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') : '')

function bytesDoBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binario = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binario.length))
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

export function baixarPdf(base64: string, nomeArquivo: string): void {
  const url = URL.createObjectURL(new Blob([bytesDoBase64(base64)], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = nomeArquivo
  link.click()
  URL.revokeObjectURL(url)
}

/** Mensagem que acompanha a guia: o essencial para quem vai pagar, mesmo sem abrir o PDF. */
export function mensagemDaGuia(guia: Guia): string {
  const linhas = [
    `*${TIPOS_GUIA[guia.tipo]}*${guia.periodo ? ` — competência ${periodoLegivel(guia.periodo)}` : ''}`,
    guia.valor !== undefined ? `Valor: ${formatBRL(guia.valor)}` : '',
    guia.vencimento ? `Pagar até: ${dataBr(guia.vencimento)}` : '',
    guia.linhaDigitavel ? `Linha digitável:\n${formatarLinhaDigitavel(guia.linhaDigitavel)}` : '',
    'O PDF com o QR Code do PIX vai em anexo.',
  ]
  return linhas.filter(Boolean).join('\n')
}

export type ResultadoCompartilhamento = 'arquivo' | 'texto' | 'cancelado'

const ehCelular = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/**
 * Compartilha a guia pelo WhatsApp.
 *
 * No celular, o navegador entrega o próprio arquivo ao WhatsApp (Web Share API). No computador o
 * WhatsApp Web só aceita texto vindo de outro site: abrimos a conversa com a mensagem pronta e
 * baixamos o PDF, para a pessoa anexar. Não se cria link público do arquivo — a guia tem CNPJ e
 * valores, e o Storage continua fechado.
 */
export async function compartilharNoWhatsApp(guia: Guia, base64: string, nomeArquivo: string): Promise<ResultadoCompartilhamento> {
  const texto = mensagemDaGuia(guia)
  const arquivo = new File([bytesDoBase64(base64)], nomeArquivo, { type: 'application/pdf' })

  if (ehCelular() && navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], text: texto, title: TIPOS_GUIA[guia.tipo] })
      return 'arquivo'
    } catch (e) {
      // a pessoa fechou a folha de compartilhamento: não é erro
      if ((e as DOMException)?.name === 'AbortError') return 'cancelado'
      // qualquer outra falha cai no caminho do texto
    }
  }

  baixarPdf(base64, nomeArquivo)
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  return 'texto'
}
