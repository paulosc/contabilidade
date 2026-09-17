import type { ReactNode } from 'react'
import { IconeMarca } from '../../components/Marca'

export function AuthLayout({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string
  subtitulo?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <IconeMarca className="mb-4 h-14 w-14 shadow-md" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-sm text-slate-500">{subtitulo}</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </div>
  )
}
