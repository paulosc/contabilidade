import { FileSpreadsheet } from 'lucide-react'
import { cn } from '../lib/utils'

/** Marca do sistema. Trocar por um <img> quando houver logo definitiva. */
export function IconeMarca({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center justify-center rounded-lg bg-indigo-600 text-white', className)}>
      <FileSpreadsheet className="h-[60%] w-[60%]" />
    </span>
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
