import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// ---------- perfil fiscal (/empresas/{id}/configuracoes/perfilFiscal) ----------

export type Regime = 'simples' | 'mei' | 'presumido' | 'real'
export type Anexo = 'I' | 'II' | 'III' | 'IV' | 'V'

export const REGIMES: Record<Regime, string> = {
  simples: 'Simples Nacional',
  mei: 'MEI',
  presumido: 'Lucro presumido',
  real: 'Lucro real',
}

export const ANEXOS: Record<Anexo, string> = {
  I: 'Anexo I — comércio',
  II: 'Anexo II — indústria',
  III: 'Anexo III — serviços',
  IV: 'Anexo IV — construção, limpeza, vigilância, advocacia',
  V: 'Anexo V — serviços sujeitos ao Fator R',
}

export interface PerfilFiscal {
  regime?: Regime
  anexo?: Anexo | null
  sujeitoAoFatorR?: boolean
  inicioAtividade?: string | null
  temEmpregados?: boolean
  temProLabore?: boolean
  temReinf?: boolean
  receitasManuais?: Record<string, number>
  folhasManuais?: Record<string, number>
}

// ---------- carteira ----------

export interface ResumoDaEmpresa {
  empresaId: string
  nome: string
  desativada?: boolean
  cnpj?: string
  papel: string
  regime?: Regime
  guias: { pendentes: number; vencidas: number; vencendo: number; valorAberto: number; proximoVencimento?: string }
  honorariosEmAtraso: { quantidade: number; valor: number }
  certificado?: { validoAte: string; dias: number }
  obrigacoes?: { atrasadas: number; proximas: number; abertasNoMes: number; proxima?: { nome: string; vencimento: string } }
  pendencias: string[]
}

export const buscarCarteira = async () => (await httpsCallable<unknown, { hoje: string; empresas: ResumoDaEmpresa[]; semAcesso: number }>(functions, 'carteiraDeClientes')({})).data

// ---------- obrigações ----------

export type SituacaoObrigacao = 'feita' | 'dispensada' | 'atrasada' | 'vence_hoje' | 'proxima' | 'futura'

export interface Obrigacao {
  codigo: string
  nome: string
  area: 'fiscal' | 'pessoal' | 'contabil'
  tipo: 'legal' | 'interna'
  competencia: string
  vencimento: string
  base: string
  situacao: SituacaoObrigacao
  marcadaPor?: string
  marcadaEm?: string
  observacao?: string
  evidencia?: string
}

export const AREAS: Record<Obrigacao['area'], string> = { fiscal: 'Fiscal', pessoal: 'Pessoal', contabil: 'Contábil' }

export const SITUACOES: Record<SituacaoObrigacao, { rotulo: string; tom: 'neutro' | 'verde' | 'amarelo' | 'vermelho' | 'azul' }> = {
  feita: { rotulo: 'Feita', tom: 'verde' },
  dispensada: { rotulo: 'Não se aplica', tom: 'neutro' },
  atrasada: { rotulo: 'Atrasada', tom: 'vermelho' },
  vence_hoje: { rotulo: 'Vence hoje', tom: 'vermelho' },
  proxima: { rotulo: 'Vence em breve', tom: 'amarelo' },
  futura: { rotulo: 'No prazo', tom: 'azul' },
}

export const buscarCalendario = async (mes: string) =>
  (await httpsCallable<unknown, { perfil?: PerfilFiscal; hoje: string; obrigacoes: Obrigacao[] }>(functions, 'calendarioObrigacoes')({ mes })).data

export const marcarObrigacao = async (o: Pick<Obrigacao, 'competencia' | 'codigo'>, marcacao: 'feita' | 'dispensada' | null, observacao?: string) => {
  await httpsCallable(functions, 'marcarObrigacaoFeita')({ competencia: o.competencia, codigo: o.codigo, marcacao, observacao: observacao || null })
}

// ---------- Simples Nacional ----------

export interface MesDaApuracao {
  mes: string
  notas: number
  receitaNotas: number
  receitaManual: number | null
  receita: number
  folhaSistema: number
  folhaAberta: boolean
  folhaManual: number | null
  folha: number
}

export interface Apuracao {
  periodo: string
  receitaDoMes: number
  rbt12: { acumulado: number; paraTabela: number; proporcionalizado: boolean; mesesDeAtividade: number }
  fatorR?: { folha12: number; receita12: number; valor: number | null; anexo: 'III' | 'V' }
  anexoAplicado: Anexo
  faixa: number
  aliquotaNominal: number
  parcelaADeduzir: number
  aliquotaEfetiva: number
  dasEstimado: number
  tributos: Array<{ tributo: string; percentual: number; valor: number }>
  receitaNoAno: number
  alertas: Array<{ nivel: 'info' | 'atencao' | 'critico'; texto: string }>
}

export interface ApuracaoDoPeriodo {
  perfil: PerfilFiscal
  meses: MesDaApuracao[]
  apuracao?: Apuracao
  motivo?: string
  dasOficial?: { guiaId: string; valor?: number; vencimento?: string; status: 'pendente' | 'paga' }
}

export const buscarApuracao = async (periodo: string) => (await httpsCallable<unknown, ApuracaoDoPeriodo>(functions, 'apuracaoSimples')({ periodo })).data

// ---------- datas ----------

export const dataBr = (iso?: string) => (iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1') : '—')
export const mesLegivel = (mes: string) => mes.replace(/^(\d{4})-(\d{2})$/, '$2/$1')
export const mesAtual = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

export function competenciaLegivel(c: string): string {
  if (/^\d{4}-\d{2}$/.test(c)) return mesLegivel(c)
  const t = /^(\d{4})-T(\d)$/.exec(c)
  return t ? `${t[2]}º trimestre de ${t[1]}` : `ano de ${c}`
}

export const numero = (texto: string): number => Number(texto.replace(/\./g, '').replace(',', '.'))
