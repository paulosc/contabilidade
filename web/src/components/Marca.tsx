import { cn } from '../lib/utils'

/**
 * Ícone da aplicação: recibo com o visto de conferido.
 * É o mesmo desenho do favicon (public/favicon.svg) — mudou um, muda o outro.
 */
export function IconeMarca({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" role="img" aria-label="Contabilidade" className={cn('rounded-lg', className)}>
      <rect width="512" height="512" rx="112" fill="currentColor" className="text-indigo-600" />
      <path d="M160 120h192v252l-24 24-24-24-24 24-24-24-24 24-24-24-24 24-24-24Z" fill="#fff" />
      <path d="M200 176h112M200 220h112M200 264h56" stroke="#4f46e5" strokeWidth="20" strokeLinecap="round" />
      <path d="M216 322l32 32 56-56" fill="none" stroke="#10b981" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Marca({ className, tamanhoTexto = 'text-lg' }: { className?: string; tamanhoTexto?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <IconeMarca className="h-8 w-8" />
      <span className={cn('font-semibold tracking-tight', tamanhoTexto)}>Contabilidade</span>
    </span>
  )
}
