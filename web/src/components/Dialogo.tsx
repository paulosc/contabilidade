import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react'
import { Botao, Textarea } from './ui'
import { cn } from '../lib/utils'

/**
 * Diálogos do sistema (substituem window.confirm / alert / prompt).
 * Uso imperativo, em qualquer lugar:
 *   if (!(await confirmar('Excluir este imóvel?', { perigo: true }))) return
 *   await avisar('Dados excluídos.')
 *   const motivo = await perguntar('Motivo da recusa:')
 * O <DialogoHost /> é montado uma única vez em App.tsx.
 */

type TomDialogo = 'pergunta' | 'perigo' | 'sucesso' | 'info'

export interface OpcoesDialogo {
  titulo?: string
  textoConfirmar?: string
  textoCancelar?: string
  /** Ação destrutiva: botão vermelho e ícone de alerta. */
  perigo?: boolean
  tom?: TomDialogo
}

export interface OpcoesPergunta extends OpcoesDialogo {
  valorInicial?: string
  placeholder?: string
  obrigatorio?: boolean
}

type Pedido =
  | { id: number; tipo: 'confirmar'; mensagem: string; opcoes: OpcoesDialogo; resolver: (v: boolean) => void }
  | { id: number; tipo: 'avisar'; mensagem: string; opcoes: OpcoesDialogo; resolver: (v: void) => void }
  | { id: number; tipo: 'perguntar'; mensagem: string; opcoes: OpcoesPergunta; resolver: (v: string | null) => void }

let fila: Pedido[] = []
let seq = 0
const ouvintes = new Set<() => void>()
const emitir = () => ouvintes.forEach((o) => o())
const assinar = (o: () => void) => {
  ouvintes.add(o)
  return () => ouvintes.delete(o)
}

function enfileirar(p: Pedido) {
  fila = [...fila, p]
  emitir()
}
function concluir(id: number) {
  fila = fila.filter((p) => p.id !== id)
  emitir()
}

const ehDestrutiva = (m: string) => /\b(excluir|remover|apagar|cancelar|estornar|recusar|desconectar|encerrar|rescindir)\b/i.test(m)

export function confirmar(mensagem: string, opcoes: OpcoesDialogo = {}): Promise<boolean> {
  return new Promise((resolver) =>
    enfileirar({ id: ++seq, tipo: 'confirmar', mensagem, opcoes: { perigo: opcoes.perigo ?? ehDestrutiva(mensagem), ...opcoes }, resolver }),
  )
}

export function avisar(mensagem: string, opcoes: OpcoesDialogo = {}): Promise<void> {
  return new Promise((resolver) => enfileirar({ id: ++seq, tipo: 'avisar', mensagem, opcoes, resolver }))
}

export function perguntar(mensagem: string, opcoes: OpcoesPergunta = {}): Promise<string | null> {
  return new Promise((resolver) => enfileirar({ id: ++seq, tipo: 'perguntar', mensagem, opcoes, resolver }))
}

const ICONES: Record<TomDialogo, { icone: typeof Info; classe: string }> = {
  pergunta: { icone: HelpCircle, classe: 'bg-indigo-50 text-indigo-600' },
  perigo: { icone: AlertTriangle, classe: 'bg-red-50 text-red-600' },
  sucesso: { icone: CheckCircle2, classe: 'bg-emerald-50 text-emerald-600' },
  info: { icone: Info, classe: 'bg-sky-50 text-sky-600' },
}

export function DialogoHost() {
  const atual = useSyncExternalStore(assinar, () => fila[0] ?? null, () => null)
  if (!atual) return null
  return <JanelaDialogo key={atual.id} pedido={atual} />
}

function JanelaDialogo({ pedido }: { pedido: Pedido }) {
  const { tipo, mensagem, opcoes } = pedido
  const [valor, setValor] = useState(tipo === 'perguntar' ? (pedido.opcoes.valorInicial ?? '') : '')
  const [saindo, setSaindo] = useState(false)
  const botaoRef = useRef<HTMLButtonElement>(null)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const focoAnterior = useRef<Element | null>(null)

  const tom: TomDialogo = opcoes.tom ?? (opcoes.perigo ? 'perigo' : tipo === 'avisar' ? 'info' : 'pergunta')
  const { icone: Icone, classe } = ICONES[tom]
  const bloqueado = tipo === 'perguntar' && pedido.opcoes.obrigatorio && !valor.trim()

  function fechar(ok: boolean) {
    if (saindo) return
    setSaindo(true)
    concluir(pedido.id)
    if (pedido.tipo === 'confirmar') pedido.resolver(ok)
    else if (pedido.tipo === 'avisar') pedido.resolver()
    else pedido.resolver(ok ? valor : null)
    if (focoAnterior.current instanceof HTMLElement) focoAnterior.current.focus()
  }

  useEffect(() => {
    focoAnterior.current = document.activeElement
    ;(tipo === 'perguntar' ? campoRef.current : botaoRef.current)?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar(false)
      }
    }
    window.addEventListener('keydown', tecla)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', tecla)
      document.body.style.overflow = overflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const titulo =
    opcoes.titulo ?? (tipo === 'avisar' ? 'Aviso' : tipo === 'perguntar' ? 'Informe' : opcoes.perigo ? 'Tem certeza?' : 'Confirmar')
  const textoConfirmar = opcoes.textoConfirmar ?? (tipo === 'avisar' ? 'Entendi' : tipo === 'perguntar' ? 'Enviar' : opcoes.perigo ? 'Sim, continuar' : 'Confirmar')

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-[2px] sm:items-center"
      style={{ animation: 'dialogo-fundo 120ms ease-out' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && tipo !== 'avisar') fechar(false)
      }}
    >
      <style>{`@keyframes dialogo-fundo{from{opacity:0}to{opacity:1}}@keyframes dialogo-caixa{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      <div
        role={tipo === 'avisar' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        aria-describedby="dialogo-mensagem"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        style={{ animation: 'dialogo-caixa 160ms ease-out' }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!bloqueado) fechar(true)
          }}
        >
          <div className="flex items-start gap-4">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', classe)}>
              <Icone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="dialogo-titulo" className="text-base font-semibold text-slate-900">{titulo}</h2>
              <p id="dialogo-mensagem" className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{mensagem}</p>
              {tipo === 'perguntar' && (
                <Textarea
                  ref={campoRef}
                  rows={3}
                  value={valor}
                  placeholder={pedido.opcoes.placeholder}
                  onChange={(e) => setValor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!bloqueado) fechar(true)
                    }
                  }}
                  className="mt-3"
                />
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {tipo !== 'avisar' && (
              <Botao type="button" variante="secundario" onClick={() => fechar(false)}>
                {opcoes.textoCancelar ?? (/cancelar/i.test(mensagem) ? 'Voltar' : 'Cancelar')}
              </Botao>
            )}
            <Botao ref={botaoRef} type="submit" variante={opcoes.perigo ? 'perigo' : 'primario'} disabled={bloqueado}>
              {textoConfirmar}
            </Botao>
          </div>
        </form>
      </div>
    </div>
  )
}
