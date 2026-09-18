import type { TipoGuia } from '../types'

export const TIPOS_GUIA: Record<TipoGuia, string> = {
  das: 'DAS — Simples Nacional',
  darf: 'DARF',
  honorarios: 'Honorários',
  outro: 'Outro documento',
}

/** Dias até o vencimento ('AAAA-MM-DD'), contados em dias de calendário. Negativo = vencida. */
export function diasAteVencer(vencimento?: string): number | null {
  if (!vencimento || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return null
  const [a, m, d] = vencimento.split('-').map(Number)
  const hoje = new Date()
  const inicioDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()
  return Math.round((new Date(a, m - 1, d).getTime() - inicioDeHoje) / 86_400_000)
}

/** "858000000119…" → "85800000011-9 14220328262-2 …", como se digita no banco. */
export const formatarLinhaDigitavel = (linha: string): string =>
  linha.replace(/\D/g, '').replace(/(\d{11})(\d)/g, '$1-$2 ').trim()

/** '2026-08' → '08/2026' */
export const periodoLegivel = (periodo?: string): string => (periodo ? periodo.replace(/^(\d{4})-(\d{2})$/, '$2/$1') : '—')
