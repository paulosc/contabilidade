import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Check, CircleCheck, Copy, Download, MessageCircle, X } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useDocumento } from '../../services/firestore'
import { Botao } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { TIPOS_GUIA, formatarLinhaDigitavel, periodoLegivel } from '../../lib/guias'
import { baixarPdf, compartilharNoWhatsApp } from '../../lib/compartilhar'
import type { ComId, Guia } from '../../types'

const dataBr = (iso?: string) => (iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') : '—')

async function buscarPdf(guiaId: string) {
  const r = await httpsCallable<unknown, { pdfBase64: string; nomeArquivo: string }>(functions, 'pdfGuia')({ guiaId })
  return r.data
}

/** Baixar, mandar pelo WhatsApp e copiar a linha digitável — os três jeitos de fazer a guia chegar em quem paga. */
export function AcoesDaGuia({ guia, aoAvisar }: { guia: ComId<Guia>; aoAvisar?: (texto: string, erro?: boolean) => void }) {
  const [ocupado, setOcupado] = useState<'pdf' | 'whatsapp' | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function baixar() {
    setOcupado('pdf')
    try {
      const pdf = await buscarPdf(guia.id)
      baixarPdf(pdf.pdfBase64, pdf.nomeArquivo)
    } catch (e) {
      aoAvisar?.(e instanceof Error ? e.message : 'Não foi possível baixar o PDF.', true)
    } finally {
      setOcupado(null)
    }
  }

  async function whatsapp() {
    setOcupado('whatsapp')
    try {
      const pdf = await buscarPdf(guia.id)
      const como = await compartilharNoWhatsApp(guia, pdf.pdfBase64, pdf.nomeArquivo)
      if (como === 'texto') {
        aoAvisar?.('Abri o WhatsApp com a mensagem pronta e baixei o PDF. Escolha a conversa e anexe o arquivo pelo clipe (Documento) — o WhatsApp Web não aceita arquivo vindo de outro site.')
      }
    } catch (e) {
      aoAvisar?.(e instanceof Error ? e.message : 'Não foi possível compartilhar.', true)
    } finally {
      setOcupado(null)
    }
  }

  async function copiar() {
    if (!guia.linhaDigitavel) return
    await navigator.clipboard.writeText(guia.linhaDigitavel)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Botao tamanho="sm" carregando={ocupado === 'pdf'} onClick={() => void baixar()}>
        <Download className="h-3.5 w-3.5" /> Baixar PDF
      </Botao>
      <Botao tamanho="sm" variante="secundario" carregando={ocupado === 'whatsapp'} onClick={() => void whatsapp()} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
        <MessageCircle className="h-3.5 w-3.5" /> Enviar pelo WhatsApp
      </Botao>
      {guia.linhaDigitavel && (
        <Botao tamanho="sm" variante="secundario" onClick={() => void copiar()}>
          {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copiado ? 'Linha copiada' : 'Copiar linha digitável'}
        </Botao>
      )}
    </div>
  )
}

/**
 * Aviso de guia pronta, logo depois de gerar: diz o que saiu, quanto é, até quando pagar, e põe
 * na mão os jeitos de usar — sem a pessoa precisar descobrir que a guia foi parar na lista.
 */
export function GuiaPronta({ guiaId, observacoes, aoFechar }: { guiaId: string; observacoes?: string[]; aoFechar: () => void }) {
  const { dado: guia } = useDocumento<Guia>('guias', guiaId)
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null)
  if (!guia) return null

  return (
    <div className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold text-emerald-900">
              {TIPOS_GUIA[guia.tipo]} pronto{guia.periodo ? ` — ${periodoLegivel(guia.periodo)}` : ''}
            </p>
            <p className="text-sm text-emerald-900">
              <strong>{guia.valor !== undefined ? formatBRL(guia.valor) : '—'}</strong> · pagar até <strong>{dataBr(guia.vencimento)}</strong> ·{' '}
              {guia.origem === 'gerada' ? `recibo nº ${Number(guia.numeroDocumento ?? 0)} gerado por este sistema` : 'emitido agora pela Receita Federal'}
            </p>
          </div>
        </div>
        <button onClick={aoFechar} className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100" aria-label="Fechar aviso">
          <X className="h-4 w-4" />
        </button>
      </div>

      {guia.linhaDigitavel && (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 font-mono text-xs break-all text-slate-800">{formatarLinhaDigitavel(guia.linhaDigitavel)}</p>
      )}

      <div className="mt-3">
        <AcoesDaGuia guia={guia} aoAvisar={(texto, erro) => setAviso({ texto, erro })} />
      </div>

      <p className="mt-3 text-xs text-emerald-800">
        {guia.origem === 'gerada' ? (
          <>
            <strong>O que fazer agora:</strong> baixe o PDF ou mande pelo WhatsApp para o cliente. É um recibo, sem código de barras: o pagamento é combinado à parte (PIX, transferência).
          </>
        ) : (
          <>
            <strong>Como pagar:</strong> baixe o PDF e use o QR Code do PIX, ou copie a linha digitável no app do banco.
          </>
        )}{' '}
        A guia também fica guardada na lista abaixo — clique na linha dela para baixar de novo ou marcar como paga.
      </p>
      {observacoes?.length ? <p className="mt-1 text-xs text-emerald-800">Observações da Receita: {observacoes.join(' · ')}</p> : null}
      {guia.avisos?.length > 0 && <p className="mt-1 text-xs text-amber-800">{guia.avisos.join(' ')}</p>}
      {aviso && <p className={`mt-2 text-xs ${aviso.erro ? 'text-red-700' : 'text-slate-700'}`}>{aviso.texto}</p>}
    </div>
  )
}
