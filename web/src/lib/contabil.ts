import { httpsCallable } from 'firebase/functions'
import type { Timestamp } from 'firebase/firestore'
import { functions } from './firebase'

export type LinhaDre = 'receita_bruta' | 'deducoes' | 'custos' | 'despesas_pessoal' | 'despesas_administrativas' | 'despesas_financeiras' | 'despesas_tributarias' | 'outras_receitas'

export const LINHAS_DRE: Record<LinhaDre, string> = {
  receita_bruta: 'Receita bruta',
  deducoes: 'Deduções da receita',
  custos: 'Custos',
  despesas_pessoal: 'Despesas com pessoal',
  despesas_administrativas: 'Despesas administrativas',
  despesas_financeiras: 'Despesas financeiras',
  despesas_tributarias: 'Despesas tributárias',
  outras_receitas: 'Outras receitas',
}

export interface Conta {
  codigo: string
  nome: string
  grupo: 'ativo' | 'passivo' | 'pl' | 'receita' | 'custo' | 'despesa'
  natureza: 'devedora' | 'credora'
  analitica: boolean
  dre?: LinhaDre
  disponivel?: boolean
}

export interface Partida {
  conta: string
  debito?: number
  credito?: number
}

export interface Lancamento {
  data: string
  historico: string
  partidas: Partida[]
  valor: number
  origem: 'manual' | 'extrato'
  criadoEm?: Timestamp
}

export interface Movimento {
  contaBanco: string
  data: string
  valor: number
  memo: string
  documento?: string
  situacao: 'pendente' | 'conciliada' | 'ignorada'
  contaSugerida?: string
  conta?: string
}

export interface LinhaBalancete {
  codigo: string
  nome: string
  analitica: boolean
  nivel: number
  natureza: 'devedora' | 'credora'
  saldoAnterior: number
  debitos: number
  creditos: number
  saldoFinal: number
}

export interface Demonstracoes {
  balancete: { linhas: LinhaBalancete[]; totalDebitos: number; totalCreditos: number; fechamento: { ativo: number; passivoEPl: number; resultado: number; confere: boolean } }
  dre: {
    receitaBruta: number
    deducoes: number
    receitaLiquida: number
    custos: number
    lucroBruto: number
    despesas: { pessoal: number; administrativas: number; financeiras: number; tributarias: number; total: number }
    outrasReceitas: number
    resultado: number
    contas: Array<{ codigo: string; nome: string; linha: LinhaDre; valor: number }>
  }
  lancamentos: number
  fechadoAte?: string
}

export const chamar = async <T = unknown>(nome: string, dados: unknown = {}): Promise<T> => (await httpsCallable<unknown, T>(functions, nome)(dados)).data

export const ordenarContas = (contas: Conta[]) => [...contas].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))

export const valorDoTexto = (texto: string): number => Number(texto.replace(/\./g, '').replace(',', '.'))

export const mensagem = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao)
