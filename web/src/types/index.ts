import type { Timestamp } from 'firebase/firestore'

export type ComId<T> = T & { id: string }

// ---------- Tenant / usuários ----------

export type Papel = 'admin' | 'contador' | 'assistente'
export const PAPEIS: Record<Papel, string> = {
  admin: 'Administrador',
  contador: 'Contador',
  assistente: 'Assistente',
}

export interface Endereco {
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
}

/** /usuarios/{uid} */
export interface Usuario {
  nome: string
  email: string
  empresaId?: string
  criadoEm: Timestamp
}

/** /empresas/{empresaId} */
export interface Empresa {
  nome: string
  /** CNPJ só com dígitos — é ele que é consultado na SEFAZ */
  cnpj: string
  /** UF da sede, usada no campo cUFAutor da consulta */
  uf?: string
  inscricaoEstadual?: string
  telefone?: string
  email?: string
  endereco?: Endereco
  criadoPor: string
  criadoEm: Timestamp
  atualizadoEm?: Timestamp
}

/** /empresas/{empresaId}/membros/{uid} */
export interface Membro {
  nome: string
  email: string
  papel: Papel
  criadoEm: Timestamp
}

// ---------- Integração fiscal (NF-e / SEFAZ) ----------

export type AmbienteFiscal = 'homologacao' | 'producao'
export const AMBIENTES_FISCAIS: Record<AmbienteFiscal, string> = {
  homologacao: 'Homologação (testes)',
  producao: 'Produção',
}

export type SituacaoSyncFiscal = 'ocioso' | 'executando' | 'erro' | 'bloqueado' | 'aguardando'
export const SITUACOES_SYNC_FISCAL: Record<SituacaoSyncFiscal, string> = {
  ocioso: 'Ociosa',
  executando: 'Sincronizando',
  erro: 'Com erro',
  bloqueado: 'Bloqueada pela SEFAZ',
  aguardando: 'Em dia',
}

/** Resumo do certificado A1 mostrado na tela. A senha e o arquivo nunca chegam aqui. */
export interface ResumoCertificadoFiscal {
  documento: string
  tipo: 'e-CNPJ' | 'e-CPF'
  titular: string
  emissor: string
  validoDe: Timestamp
  validoAte: Timestamp
  impressaoDigital: string
  enviadoEm: Timestamp
}

export interface EstadoSincronizacaoFiscal {
  ultimoNsu: string
  maxNsu: string
  ultimoNsuConsultado?: string
  ultimaSincronizacao?: Timestamp
  /** Antes deste horário a SEFAZ não aceita nova consulta (regra de 1 h da NT 2014.002) */
  proximaPermitidaEm?: Timestamp
  status: SituacaoSyncFiscal
  codigoRetorno?: string
  mensagemRetorno?: string
  documentosEncontrados: number
  documentosProcessados: number
  erros: number
}

/** /empresas/{id}/configuracoes/fiscal */
export interface ConfiguracaoFiscal {
  tipo: 'fiscal'
  ativo: boolean
  ambiente: AmbienteFiscal
  cnpj: string
  uf?: string
  certificado?: ResumoCertificadoFiscal
  sincronizacao: EstadoSincronizacaoFiscal
  /** Busca de NFS-e: ligada separadamente da NF-e */
  nfseAtivo?: boolean
  sincronizacaoNfse?: EstadoSincronizacaoNfse
  atualizadoEm: Timestamp
}

export type StatusNotaFiscal = 'resumo' | 'autorizada' | 'cancelada' | 'denegada'
export const STATUS_NOTA_FISCAL: Record<StatusNotaFiscal, string> = {
  resumo: 'Aguardando XML',
  autorizada: 'Autorizada',
  cancelada: 'Cancelada',
  denegada: 'Denegada',
}

export interface ProdutoNotaFiscal {
  codigo?: string
  descricao: string
  ncm?: string
  cfop?: string
  unidade?: string
  quantidade?: number
  valorUnitario?: number
  valorTotal?: number
}

export interface EventoNotaFiscal {
  tpEvento: string
  descricao: string
  nSeqEvento: string
  dataEvento?: Timestamp
  protocolo?: string
  nsu?: string
  storagePath?: string
}

/** /empresas/{id}/notasFiscais/{chaveAcesso} */
export interface NotaFiscal {
  chaveAcesso: string
  numero?: string
  serie?: string
  modelo?: string
  naturezaOperacao?: string
  /** 0 = entrada, 1 = saída */
  tipoOperacao?: string
  dataEmissao?: Timestamp
  cnpjEmitente?: string
  razaoSocialEmitente?: string
  ieEmitente?: string
  ufEmitente?: string
  cnpjDestinatario?: string
  razaoSocialDestinatario?: string
  valorTotal?: number
  protocolo?: string
  dataAutorizacao?: Timestamp
  nsu?: string
  nsuResumo?: string
  status: StatusNotaFiscal
  xmlCompleto: boolean
  storagePath?: string
  hashXml?: string
  produtos?: ProdutoNotaFiscal[]
  eventos?: EventoNotaFiscal[]
  ambiente: AmbienteFiscal
  importadoEm: Timestamp
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}

/** /empresas/{id}/sincronizacoesFiscais/{id} */
export interface SincronizacaoFiscal {
  empresaId: string
  origem: 'agendada' | 'manual'
  iniciadoEm: Timestamp
  concluidoEm?: Timestamp
  duracaoMs?: number
  nsuInicial: string
  nsuFinal: string
  maxNsu: string
  lotes: number
  documentosEncontrados: number
  documentosProcessados: number
  notasNovas: number
  notasAtualizadas: number
  eventos: number
  erros: number
  codigoRetorno?: string
  mensagemRetorno?: string
  status: 'concluida' | 'erro' | 'bloqueada'
  detalheErro?: string
}

export type OperacaoAuditada =
  | 'certificado_cadastrado'
  | 'certificado_removido'
  | 'integracao_ativada'
  | 'integracao_desativada'
  | 'conexao_testada'
  | 'sincronizacao_manual'
  | 'xml_baixado'

export const OPERACOES_AUDITADAS: Record<OperacaoAuditada, string> = {
  certificado_cadastrado: 'Certificado cadastrado',
  certificado_removido: 'Certificado removido',
  integracao_ativada: 'Integração ativada',
  integracao_desativada: 'Integração desativada',
  conexao_testada: 'Conexão testada',
  sincronizacao_manual: 'Sincronização manual',
  xml_baixado: 'XML baixado',
}

/** /empresas/{id}/auditoriaFiscal/{id} */
export interface RegistroAuditoria {
  operacao: OperacaoAuditada
  uid: string
  email?: string
  detalhe?: string
  chaveAcesso?: string
  criadoEm: Timestamp
}

// ---------- NFS-e (nota fiscal de serviço, ADN nacional) ----------

export interface EstadoSincronizacaoNfse {
  ultimoNsu: string
  maxNsu: string
  ultimaSincronizacao?: Timestamp
  proximaPermitidaEm?: Timestamp
  status: SituacaoSyncFiscal
  mensagemRetorno?: string
  documentosEncontrados: number
  documentosProcessados: number
  erros: number
  /** Chaves do JSON devolvido pelo ADN, para conferência do formato real */
  formatoRecebido?: string[]
}

export type StatusNotaServico = 'gerada' | 'cancelada'
export const STATUS_NOTA_SERVICO: Record<StatusNotaServico, string> = {
  gerada: 'Gerada',
  cancelada: 'Cancelada',
}

export type PapelNaNotaServico = 'prestador' | 'tomador' | 'outro'
export const PAPEIS_NOTA_SERVICO: Record<PapelNaNotaServico, string> = {
  prestador: 'Emitida (receita)',
  tomador: 'Recebida (despesa)',
  outro: 'Outro',
}

export interface EventoNotaServico {
  tipoEvento: string
  descricao: string
  numeroSequencial: string
  dataEvento?: Timestamp
  nsu?: string
  storagePath?: string
}

/** /empresas/{id}/notasServico/{chaveAcesso} — chave de 50 dígitos */
export interface NotaServico {
  chaveAcesso: string
  numero?: string
  serieDps?: string
  numeroDps?: string
  dataEmissao?: Timestamp
  dataProcessamento?: Timestamp
  competencia?: string
  situacao?: string
  ambienteGerador?: string
  municipioEmissao?: string
  municipioPrestacao?: string
  codigoMunicipio?: string
  cnpjPrestador?: string
  razaoSocialPrestador?: string
  inscricaoMunicipalPrestador?: string
  cnpjTomador?: string
  razaoSocialTomador?: string
  descricaoServico?: string
  codigoTributacaoNacional?: string
  codigoTributacaoMunicipal?: string
  valorServico?: number
  baseCalculo?: number
  aliquota?: number
  valorIss?: number
  valorRetencoes?: number
  valorLiquido?: number
  papel: PapelNaNotaServico
  status: StatusNotaServico
  nsu?: string
  storagePath?: string
  hashXml?: string
  eventos?: EventoNotaServico[]
  ambiente: AmbienteFiscal
  importadoEm: Timestamp
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}
