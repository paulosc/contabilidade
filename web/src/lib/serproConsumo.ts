/**
 * Estimativa de gasto com o Integra Contador (Serpro), a partir do que o sistema registrou.
 *
 * Preços: Anexo I do contrato (tabela vigente na contratação, 18/09/2026). A cobrança é "direto
 * na faixa do consumo": o volume do ciclo define a faixa, e o preço dela vale para todas as
 * requisições daquele tipo. O ciclo de faturamento vai do dia 21 ao dia 20 (cláusula 7.3).
 *
 * É estimativa: o valor oficial é o da fatura, na Área do Cliente do Serpro. Requisição feita fora
 * deste sistema, ou que o Serpro tarife mesmo tendo falhado, não aparece aqui.
 */

export type TipoConsumo = 'emissao' | 'consulta' | 'declaracao'

interface Faixa {
  ate: number
  preco: number
}

const TABELA: Record<TipoConsumo, Faixa[]> = {
  consulta: [
    { ate: 300, preco: 0.24 },
    { ate: 1000, preco: 0.21 },
    { ate: 3000, preco: 0.18 },
    { ate: 7000, preco: 0.16 },
    { ate: 15000, preco: 0.14 },
    { ate: 23000, preco: 0.11 },
    { ate: 30000, preco: 0.09 },
    { ate: Infinity, preco: 0.06 },
  ],
  emissao: [
    { ate: 500, preco: 0.32 },
    { ate: 5000, preco: 0.29 },
    { ate: 10000, preco: 0.26 },
    { ate: 15000, preco: 0.22 },
    { ate: 25000, preco: 0.19 },
    { ate: 35000, preco: 0.16 },
    { ate: 50000, preco: 0.12 },
    { ate: Infinity, preco: 0.08 },
  ],
  declaracao: [
    { ate: 100, preco: 0.4 },
    { ate: 500, preco: 0.36 },
    { ate: 1000, preco: 0.32 },
    { ate: 3000, preco: 0.28 },
    { ate: 5000, preco: 0.24 },
    { ate: 8000, preco: 0.2 },
    { ate: 10000, preco: 0.16 },
    { ate: Infinity, preco: 0.12 },
  ],
}

export const precoUnitario = (tipo: TipoConsumo, quantidade: number): number => (quantidade <= 0 ? 0 : TABELA[tipo].find((f) => quantidade <= f.ate)!.preco)

export const custo = (tipo: TipoConsumo, quantidade: number): number => Math.round(quantidade * precoUnitario(tipo, quantidade) * 100) / 100

/** Ciclo de faturamento que contém a data: do dia 21 ao dia 20. A chave é o mês em que o ciclo fecha. */
export function cicloDe(data: Date): { chave: string; inicio: Date; fim: Date } {
  const fechaNesteMes = data.getDate() <= 20
  const ano = data.getFullYear()
  const mes = data.getMonth() + (fechaNesteMes ? 0 : 1)
  const fim = new Date(ano, mes, 20)
  const inicio = new Date(ano, mes - 1, 21)
  return { chave: `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}`, inicio, fim }
}

export interface Uso {
  tipo: TipoConsumo
  quando: Date
}

export interface ResumoCiclo {
  chave: string
  inicio: Date
  fim: Date
  emissoes: number
  consultas: number
  declaracoes: number
  total: number
}

export function resumirPorCiclo(usos: Uso[]): ResumoCiclo[] {
  const mapa = new Map<string, ResumoCiclo>()
  for (const u of usos) {
    const c = cicloDe(u.quando)
    const r = mapa.get(c.chave) ?? { ...c, emissoes: 0, consultas: 0, declaracoes: 0, total: 0 }
    if (u.tipo === 'emissao') r.emissoes++
    else if (u.tipo === 'consulta') r.consultas++
    else r.declaracoes++
    mapa.set(c.chave, r)
  }
  for (const r of mapa.values()) {
    r.total = Math.round((custo('emissao', r.emissoes) + custo('consulta', r.consultas) + custo('declaracao', r.declaracoes)) * 100) / 100
  }
  return [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave))
}
