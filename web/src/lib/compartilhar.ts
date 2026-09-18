import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { formatBRL } from './utils'
import { TIPOS_GUIA, formatarLinhaDigitavel, periodoLegivel } from './guias'
import type { Guia } from '../types'

const dataBr = (iso?: string) => (iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1') : '')

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

/**
 * Mensagem que acompanha a guia: o essencial para quem vai pagar, mesmo sem abrir o PDF.
 * A última linha diz onde está o documento — e só promete o que de fato vai junto.
 */
export function mensagemDaGuia(guia: Guia, documento: { anexo: true } | { link: string; validoAte: string } | { nenhum: true }): string {
  const ehRecibo = guia.tipo === 'honorarios'
  const vencida = guia.status === 'pendente' && Boolean(guia.vencimento) && guia.vencimento! < new Date().toLocaleDateString('en-CA')
  const linhas = [
    vencida ? `Olá! Passando para lembrar ${ehRecibo ? 'do honorário' : 'da guia'} em aberto, que venceu em ${dataBr(guia.vencimento)}:` : '',
    `*${TIPOS_GUIA[guia.tipo]}*${guia.periodo ? ` — competência ${periodoLegivel(guia.periodo)}` : ''}`,
    guia.valor !== undefined ? `Valor: ${formatBRL(guia.valor)}` : '',
    guia.vencimento ? `${ehRecibo ? 'Vencimento' : 'Pagar até'}: ${dataBr(guia.vencimento)}` : '',
    guia.linhaDigitavel ? `Linha digitável:\n${formatarLinhaDigitavel(guia.linhaDigitavel)}` : '',
    guia.pixCopiaECola ? `PIX copia e cola:\n${guia.pixCopiaECola}` : '',
    'anexo' in documento
      ? ehRecibo
        ? `O recibo${guia.pixCopiaECola ? ', com o QR Code do PIX,' : ''} vai em anexo (PDF).`
        : 'O PDF com o QR Code do PIX vai em anexo.'
      : 'link' in documento
        ? `${ehRecibo ? (guia.pixCopiaECola ? 'Recibo em PDF, com o QR Code do PIX' : 'Recibo em PDF') : 'PDF com o QR Code do PIX'}:\n${documento.link}\n(link válido até ${dataBr(documento.validoAte)})`
        : '',
  ]
  return linhas.filter(Boolean).join('\n')
}

export type ResultadoCompartilhamento = 'arquivo' | 'link' | 'texto' | 'cancelado'

const ehCelular = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/**
 * Compartilha a guia pelo WhatsApp.
 *
 * No celular, o navegador entrega o próprio arquivo ao WhatsApp (Web Share API). No computador o
 * WhatsApp Web só aceita texto vindo de outro site, então a mensagem leva um link do PDF: criado
 * pelo backend, com token aleatório, válido por 7 dias e só para aquela guia (o Storage continua
 * fechado). Se o link não puder ser criado, cai no texto puro e baixa o PDF para anexar à mão.
 */
export async function compartilharNoWhatsApp(guia: Guia & { id: string }, obterPdf: () => Promise<{ pdfBase64: string; nomeArquivo: string }>): Promise<ResultadoCompartilhamento> {
  if (ehCelular() && typeof navigator.share === 'function') {
    const pdf = await obterPdf()
    const arquivo = new File([bytesDoBase64(pdf.pdfBase64)], pdf.nomeArquivo, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], text: mensagemDaGuia(guia, { anexo: true }), title: TIPOS_GUIA[guia.tipo] })
        return 'arquivo'
      } catch (e) {
        // a pessoa fechou a folha de compartilhamento: não é erro
        if ((e as DOMException)?.name === 'AbortError') return 'cancelado'
        // qualquer outra falha segue para o link
      }
    }
  }

  // A aba precisa ser aberta já no clique, antes do await, senão o navegador bloqueia o pop-up.
  const aba = window.open('about:blank', '_blank')
  try {
    const r = await httpsCallable<unknown, { url: string; expiraEm: string }>(functions, 'linkGuia')({ guiaId: guia.id })
    const destino = `https://wa.me/?text=${encodeURIComponent(mensagemDaGuia(guia, { link: r.data.url, validoAte: r.data.expiraEm }))}`
    if (aba) aba.location.href = destino
    else window.location.href = destino
    return 'link'
  } catch {
    const pdf = await obterPdf()
    baixarPdf(pdf.pdfBase64, pdf.nomeArquivo)
    const destino = `https://wa.me/?text=${encodeURIComponent(mensagemDaGuia(guia, { nenhum: true }))}`
    if (aba) aba.location.href = destino
    else window.open(destino, '_blank', 'noopener')
    return 'texto'
  }
}
