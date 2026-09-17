import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

// ---------- Botão ----------

type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo'
type Tamanho = 'sm' | 'md' | 'lg'

const variantes: Record<Variante, string> = {
  primario: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500',
  secundario:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-indigo-500',
  fantasma: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
  perigo: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
}
const tamanhos: Record<Tamanho, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
}

export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamanho?: Tamanho
  carregando?: boolean
}

export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { className, variante = 'primario', tamanho = 'md', carregando, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || carregando}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
      {...props}
    >
      {carregando && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
})

// ---------- Campos ----------

const campoBase =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-100 ' +
  'aria-[invalid=true]:border-red-500'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(campoBase, 'h-10', className)} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(campoBase, 'h-10', className)} {...props}>
        {children}
      </select>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(campoBase, 'min-h-24 py-2', className)} {...props} />
  },
)

export function Campo({
  label,
  erro,
  dica,
  children,
  className,
  obrigatorio,
}: {
  label: string
  erro?: string
  dica?: string
  children: ReactNode
  className?: string
  obrigatorio?: boolean
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-sm font-medium text-slate-700">
        {label}
        {obrigatorio && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {erro ? (
        <span className="text-xs text-red-600">{erro}</span>
      ) : dica ? (
        <span className="text-xs text-slate-500">{dica}</span>
      ) : null}
    </label>
  )
}

// ---------- Layout ----------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-6 shadow-sm', className)}>
      {children}
    </div>
  )
}

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string
  descricao?: string
  acoes?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-slate-500">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 gap-2">{acoes}</div>}
    </div>
  )
}

type Tom = 'neutro' | 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'roxo'
const tons: Record<Tom, string> = {
  neutro: 'bg-slate-100 text-slate-700',
  verde: 'bg-emerald-100 text-emerald-800',
  amarelo: 'bg-amber-100 text-amber-800',
  vermelho: 'bg-red-100 text-red-800',
  azul: 'bg-sky-100 text-sky-800',
  roxo: 'bg-violet-100 text-violet-800',
}

export function Badge({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tons[tom],
      )}
    >
      {children}
    </span>
  )
}

export function EstadoVazio({
  icone,
  titulo,
  descricao,
  acao,
}: {
  icone?: ReactNode
  titulo: string
  descricao?: string
  acao?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      {icone && <div className="mb-3 text-slate-400">{icone}</div>}
      <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
      {descricao && <p className="mt-1 max-w-md text-sm text-slate-500">{descricao}</p>}
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  )
}

export function Alerta({
  tipo = 'erro',
  children,
}: {
  tipo?: 'erro' | 'sucesso' | 'info'
  children: ReactNode
}) {
  const estilos = {
    erro: 'border-red-200 bg-red-50 text-red-800',
    sucesso: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  }
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', estilos[tipo])} role="alert">
      {children}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-6 w-6 animate-spin text-indigo-600', className)} />
}

export function TelaCarregando() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

// ---------- Paginação ----------

/**
 * Paginação de listas já carregadas e filtradas em memória.
 * As listagens assinam o Firestore em tempo real (onSnapshot) com um teto de documentos,
 * então paginar aqui é o que mantém a tela leve sem abrir mão da atualização automática.
 */
export function Paginacao({
  pagina,
  porPagina,
  total,
  aoMudarPagina,
  aoMudarPorPagina,
}: {
  pagina: number
  porPagina: number
  total: number
  aoMudarPagina: (p: number) => void
  aoMudarPorPagina: (n: number) => void
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const atual = Math.min(pagina, paginas)
  const primeiro = total === 0 ? 0 : (atual - 1) * porPagina + 1
  const ultimo = Math.min(atual * porPagina, total)

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm sm:flex-row">
      <p className="text-slate-600">
        {total === 0 ? 'Nenhum resultado' : <>Mostrando <span className="font-medium">{primeiro}–{ultimo}</span> de <span className="font-medium">{total}</span></>}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-slate-600">
          Por página
          <Select
            className="h-8 w-20"
            value={porPagina}
            onChange={(e) => {
              aoMudarPorPagina(Number(e.target.value))
              aoMudarPagina(1)
            }}
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </label>
        <div className="flex items-center gap-1">
          <Botao tamanho="sm" variante="secundario" disabled={atual <= 1} onClick={() => aoMudarPagina(atual - 1)}>
            Anterior
          </Botao>
          <span className="px-2 whitespace-nowrap text-slate-600">
            {atual} de {paginas}
          </span>
          <Botao tamanho="sm" variante="secundario" disabled={atual >= paginas} onClick={() => aoMudarPagina(atual + 1)}>
            Próxima
          </Botao>
        </div>
      </div>
    </div>
  )
}

/** Ícone do Instagram (lucide não inclui marcas). */
export function IconeInstagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}
