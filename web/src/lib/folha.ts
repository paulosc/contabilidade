import type { TipoTrabalhador } from '../types'

export const TIPOS_TRABALHADOR: Record<TipoTrabalhador, string> = {
  empregado: 'Empregado (CLT)',
  aprendiz: 'Aprendiz',
  prolabore: 'Sócio com pró-labore',
}

/** Categoria do trabalhador no eSocial (Tabela 01), por tipo de vínculo. */
export const CATEGORIAS_ESOCIAL: Record<TipoTrabalhador, string> = {
  empregado: '101 — Empregado geral',
  aprendiz: '103 — Aprendiz',
  prolabore: '723 — Empresário, sócio',
}

/** "3.000,50" → 3000.5 */
export const paraNumero = (v: string): number => {
  const n = Number((v ?? '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export const paraCampo = (v: number): string => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** '2026-09' → '09/2026' */
export const competenciaLegivel = (c: string): string => c.replace(/^(\d{4})-(\d{2})$/, '$2/$1')
