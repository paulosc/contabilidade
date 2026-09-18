/**
 * Folha de pagamento — modelo de dados.
 *
 *   /empresas/{id}/funcionarios/{fid}                  cadastro (admin lê e escreve)
 *   /empresas/{id}/rubricas/{codigo}                   verbas da folha (admin lê e escreve)
 *   /empresas/{id}/folhas/{AAAA-MM}                    a folha do mês (escrita só pelo backend)
 *   /empresas/{id}/folhas/{AAAA-MM}/holerites/{fid}    o holerite calculado (só backend)
 *
 * Os números do holerite são sempre calculados no servidor: a tela manda os lançamentos, nunca
 * o resultado. Dado pessoal (CPF, salário) fica restrito a administradores da empresa.
 */
import type { Timestamp } from 'firebase-admin/firestore'
import { db } from '../lib/admin'
import type { Lancamento, ResultadoCalculo, TipoRubrica, TipoTrabalhador } from './calculo'

const raiz = (empresaId: string) => db.collection('empresas').doc(empresaId)
export const funcionariosRef = (empresaId: string) => raiz(empresaId).collection('funcionarios')
export const rubricasRef = (empresaId: string) => raiz(empresaId).collection('rubricas')
export const folhasRef = (empresaId: string) => raiz(empresaId).collection('folhas')
export const holeritesRef = (empresaId: string, competencia: string) => folhasRef(empresaId).doc(competencia).collection('holerites')
export const caminhoHolerite = (empresaId: string, competencia: string, funcionarioId: string): string =>
  `empresas/${empresaId}/folha/${competencia}/${funcionarioId.replace(/[^A-Za-z0-9_-]/g, '')}.pdf`

export interface Funcionario {
  nome: string
  /** Só dígitos */
  cpf: string
  /** 'AAAA-MM-DD' */
  dataNascimento?: string
  tipo: TipoTrabalhador
  cargo: string
  cbo?: string
  /** Salário mensal contratual, ou o pró-labore */
  salarioBase: number
  /** 'AAAA-MM-DD' */
  dataAdmissao: string
  dataDesligamento?: string
  dependentesIrrf: number
  pensaoAlimenticia?: number
  /** Identificadores no eSocial */
  matricula?: string
  /** Tabela 01 do eSocial: 101 empregado geral, 103 aprendiz, 722/723 diretor/sócio com pró-labore */
  categoriaEsocial?: number
  ativo: boolean
  criadoEm?: Timestamp
  atualizadoEm?: Timestamp
}

export interface Rubrica {
  codigo: string
  descricao: string
  tipo: TipoRubrica
  incideInss: boolean
  incideIrrf: boolean
  incideFgts: boolean
  /** Natureza da rubrica — Tabela 03 do eSocial */
  natureza?: string
  /** Rubrica do sistema: não pode ser apagada */
  padrao?: boolean
}

/**
 * Rubricas iniciais. A natureza é o código oficial da Tabela 03 do eSocial (leiaute S-1.3):
 * 1000 salário · 1002 DSR · 1003 horas extras · 1202 insalubridade · 1203 periculosidade ·
 * 1205 adicional noturno · 1207 comissões · 1211 gratificações · 3508 pró-labore de sócios ·
 * 9200 desconto de adiantamentos · 9201 contribuição previdenciária · 9203 IRRF ·
 * 9209 faltas ou atrasos · 9213 pensão alimentícia · 9216 vale-transporte · 9220 alimentação.
 * As incidências seguem a regra geral de cada natureza; verba com tratamento especial em
 * convenção coletiva deve ser ajustada pelo contador na tela.
 */
export const RUBRICAS_PADRAO: Rubrica[] = [
  { codigo: '1000', descricao: 'Salário', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1000', padrao: true },
  { codigo: '1002', descricao: 'Descanso semanal remunerado', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1002', padrao: true },
  { codigo: '1003', descricao: 'Horas extras', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1003', padrao: true },
  { codigo: '1202', descricao: 'Adicional de insalubridade', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1202', padrao: true },
  { codigo: '1203', descricao: 'Adicional de periculosidade', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1203', padrao: true },
  { codigo: '1205', descricao: 'Adicional noturno', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1205', padrao: true },
  { codigo: '1207', descricao: 'Comissões', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1207', padrao: true },
  { codigo: '1211', descricao: 'Gratificação', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '1211', padrao: true },
  { codigo: '3508', descricao: 'Pró-labore', tipo: 'provento', incideInss: true, incideIrrf: true, incideFgts: false, natureza: '3508', padrao: true },
  { codigo: '9209', descricao: 'Faltas ou atrasos', tipo: 'desconto', incideInss: true, incideIrrf: true, incideFgts: true, natureza: '9209', padrao: true },
  { codigo: '9200', descricao: 'Desconto de adiantamento', tipo: 'desconto', incideInss: false, incideIrrf: false, incideFgts: false, natureza: '9200', padrao: true },
  { codigo: '9220', descricao: 'Alimentação (desconto)', tipo: 'desconto', incideInss: false, incideIrrf: false, incideFgts: false, natureza: '9220', padrao: true },
  { codigo: '9216', descricao: 'Vale-transporte', tipo: 'desconto', incideInss: false, incideIrrf: false, incideFgts: false, natureza: '9216', padrao: true },
  { codigo: '9213', descricao: 'Pensão alimentícia', tipo: 'desconto', incideInss: false, incideIrrf: false, incideFgts: false, natureza: '9213', padrao: true },
]

export type StatusFolha = 'aberta' | 'fechada'

export interface Folha {
  competencia: string
  status: StatusFolha
  totais: { funcionarios: number; proventos: number; descontos: number; liquido: number; inss: number; irrf: number; fgts: number }
  fechadaEm?: Timestamp
  fechadaPor?: string
  atualizadoEm?: Timestamp
}

export interface Holerite {
  funcionarioId: string
  competencia: string
  /** Retrato do cadastro no momento do cálculo: o holerite não muda se o cadastro mudar depois */
  funcionario: Pick<Funcionario, 'nome' | 'cpf' | 'cargo' | 'tipo' | 'dataAdmissao' | 'matricula' | 'dependentesIrrf' | 'salarioBase'>
  /** Só o que foi digitado; INSS e IRRF entram pelo cálculo */
  lancamentos: Lancamento[]
  resultado: ResultadoCalculo
  storagePath?: string
  calculadoEm?: Timestamp
  calculadoPor: string
}
