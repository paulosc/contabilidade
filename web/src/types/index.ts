import type { Timestamp } from 'firebase/firestore'

export type ComId<T> = T & { id: string }

// ---------- Tenant / usuários ----------

export type Papel = 'admin' | 'contador' | 'assistente' | 'cliente'
export const PAPEIS: Record<Papel, string> = {
  admin: 'Administrador',
  contador: 'Contador',
  assistente: 'Assistente',
  cliente: 'Cliente',
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
  /** Última empresa aberta (preferência de tela, não é permissão) */
  empresaId?: string
  criadoEm: Timestamp
}

/** /empresas/{empresaId} */
/** O que o Comprovante de Inscrição e de Situação Cadastral (cartão CNPJ) diz sobre a empresa */
export interface CadastroCnpj {
  /** 'AAAA-MM-DD' */
  dataAbertura?: string
  porte?: string
  cnaePrincipal?: { codigo: string; descricao: string }
  cnaesSecundarios?: Array<{ codigo: string; descricao: string }>
  naturezaJuridica?: { codigo: string; descricao: string }
  situacaoCadastral?: string
  dataSituacaoCadastral?: string
  /** 'AAAA-MM-DD' — data do comprovante de onde os dados vieram */
  emitidoEm?: string
}

export interface Empresa {
  nome: string
  /** Fora da rotina: sem busca automática nem honorário recorrente; os dados continuam */
  desativada?: boolean
  nomeFantasia?: string
  /** CNPJ só com dígitos — é ele que é consultado na SEFAZ */
  cnpj: string
  /** UF da sede, usada no campo cUFAutor da consulta */
  uf?: string
  inscricaoEstadual?: string
  telefone?: string
  email?: string
  endereco?: Endereco
  cadastro?: CadastroCnpj
  criadoPor: string
  criadoEm: Timestamp
  atualizadoEm?: Timestamp
}

/**
 * /usuarios/{uid}/empresas/{empresaId} — espelho das empresas do usuário, mantido pelo backend.
 * É só um índice para a troca de empresa; quem manda no acesso é /empresas/{id}/membros/{uid}.
 */
export interface VinculoEmpresa {
  empresaId: string
  nome: string
  cnpj?: string
  papel: Papel
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
  /** Apelido ou host do município no web service ABRASF, ex.: 'conceicaodosouros' */
  municipioWebservice?: string
  inscricaoMunicipal?: string
  importacaoMunicipal?: {
    ultimaEm?: Timestamp
    periodoDe?: string
    periodoAte?: string
    notasImportadas?: number
  }
  sincronizacaoNfse?: EstadoSincronizacaoNfse
  /** Integra Contador (Serpro): só o resumo; key e secret ficam cifradas no servidor */
  serpro?: { configurado: boolean; contratante: string }
  /** Numeração própria das NFS-e emitidas por aqui */
  emissao?: { serie: string; proximoNumero: number }
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
  | 'nfse_emitida'
  | 'nfse_cancelada'
  | 'guia_importada'
  | 'guia_paga'
  | 'guia_excluida'
  | 'guia_compartilhada'
  | 'recibo_gerado'
  | 'serpro_configurado'
  | 'serpro_removido'
  | 'guia_gerada_receita'
  | 'serpro_consulta'
  | 'folha_calculada'
  | 'folha_fechada'
  | 'folha_reaberta'
  | 'esocial_enviado'
  | 'obrigacao_marcada'
  | 'serpro_emissao'
  | 'membro_adicionado'
  | 'membro_alterado'
  | 'membro_removido'
  | 'documento_enviado'
  | 'documento_baixado'
  | 'documento_excluido'
  | 'solicitacao_criada'
  | 'solicitacao_avaliada'
  | 'contabil_plano'
  | 'contabil_extrato'
  | 'contabil_lancamento'
  | 'contabil_periodo'
  | 'contrato_gerado'
  | 'lucro_registrado'
  | 'lucro_excluido'
  | 'empresa_situacao'

export const OPERACOES_AUDITADAS: Record<OperacaoAuditada, string> = {
  certificado_cadastrado: 'Certificado cadastrado',
  certificado_removido: 'Certificado removido',
  integracao_ativada: 'Integração ativada',
  integracao_desativada: 'Integração desativada',
  conexao_testada: 'Conexão testada',
  sincronizacao_manual: 'Sincronização manual',
  xml_baixado: 'XML baixado',
  nfse_emitida: 'NFS-e emitida',
  nfse_cancelada: 'NFS-e cancelada',
  guia_importada: 'Guia importada',
  guia_paga: 'Pagamento de guia',
  guia_excluida: 'Guia excluída',
  guia_compartilhada: 'Guia compartilhada por link',
  recibo_gerado: 'Recibo de honorários gerado',
  serpro_configurado: 'Integra Contador configurado',
  serpro_removido: 'Integra Contador removido',
  guia_gerada_receita: 'Guia gerada pela Receita',
  serpro_consulta: 'Consulta na Receita (Serpro)',
  folha_calculada: 'Folha calculada',
  folha_fechada: 'Folha fechada',
  folha_reaberta: 'Folha reaberta',
  esocial_enviado: 'Envio ao eSocial',
  obrigacao_marcada: 'Obrigação marcada no checklist',
  serpro_emissao: 'Emissão de relatório na Receita',
  membro_adicionado: 'Acesso concedido',
  membro_alterado: 'Papel alterado',
  membro_removido: 'Acesso removido',
  documento_enviado: 'Documento enviado',
  documento_baixado: 'Documento baixado',
  documento_excluido: 'Documento excluído',
  solicitacao_criada: 'Pedido de documento criado',
  solicitacao_avaliada: 'Pedido de documento avaliado',
  contabil_plano: 'Plano de contas alterado',
  contabil_extrato: 'Extrato bancário importado',
  contabil_lancamento: 'Lançamento contábil',
  contabil_periodo: 'Período contábil encerrado ou reaberto',
  contrato_gerado: 'Contrato de serviços gerado',
  lucro_registrado: 'Lucro distribuído registrado',
  lucro_excluido: 'Lucro distribuído excluído',
  empresa_situacao: 'Empresa desativada ou reativada',
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
  /** Chave de 50 dígitos (ADN) ou id municipal quando veio da prefeitura */
  chaveAcesso: string
  /** De onde a nota veio */
  origem?: 'adn' | 'municipal'
  codigoVerificacao?: string
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
  /** Preenchidos quando a nota foi emitida por este sistema */
  emitidaPor?: string
  emitidaEm?: Timestamp
  /** Chave da NFS-e que substituiu esta */
  substituidaPor?: string
  cancelamento?: { motivo: string; descricao: string; em: Timestamp; por: string }
  importadoEm: Timestamp
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}

// ---------- guias a pagar (DAS, DARF, honorários) ----------

export type TipoGuia = 'das' | 'darf' | 'honorarios' | 'outro'

/** /empresas/{id}/guias/{id} — gravada só pelo backend */
export interface Guia {
  tipo: TipoGuia
  numeroDocumento?: string
  documentoContribuinte?: string
  contribuinte?: string
  /** 'AAAA-MM' */
  periodo?: string
  /** 'AAAA-MM-DD' */
  vencimento?: string
  vencimentoEm?: Timestamp
  emissao?: string
  valor?: number
  linhaDigitavel?: string
  codigoBarras?: string
  linhaDigitavelValida?: boolean
  composicao: Array<{ codigo: string; denominacao: string; principal: number; total: number }>
  descricao?: string
  emitente?: string
  observacoes?: string
  avisos: string[]
  /** Recibo de honorários com PIX: o código para copiar e colar no banco */
  pixCopiaECola?: string
  status: 'pendente' | 'paga'
  pagaEm?: Timestamp
  pagaPor?: string
  /** Link enviado ao cliente e se ele já abriu — a confirmação de leitura */
  compartilhamento?: { enviadoEm?: Timestamp; expiraEm?: Timestamp; visualizacoes?: number; primeiraVisualizacaoEm?: Timestamp; ultimaVisualizacaoEm?: Timestamp }
  /** Baixa dada pela consulta de pagamentos da Receita */
  pagamentoConfirmado?: { fonte: 'receita'; dataArrecadacao: string; valorTotal?: number }
  origem: 'upload' | 'serpro' | 'gerada'
  nomeArquivo?: string
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}

/** /empresas/{id}/configuracoes/honorarios */
export interface ConfiguracaoHonorarios {
  emitente: { nome: string; documento?: string; crc?: string; telefone?: string }
  valorMensal?: number | null
  diaVencimento?: number | null
  mensagem?: string
  /** Marca o documento para o agendamento achar (collection group) */
  tipo?: 'honorarios'
  /** Gera sozinho o recibo de cada mês, com o valor e o dia de vencimento combinados */
  recorrente?: boolean
  pix?: { tipo: TipoChavePix; chave: string; nome?: string; cidade: string } | null
  proximoNumero?: number
}

export type TipoChavePix = 'cpf_cnpj' | 'celular' | 'email' | 'aleatoria'

// ---------- folha de pagamento ----------

export type TipoTrabalhador = 'empregado' | 'aprendiz' | 'prolabore'
export type TipoRubrica = 'provento' | 'desconto' | 'informativa'

/** /empresas/{id}/funcionarios/{id} — só administradores leem e escrevem */
export interface Funcionario {
  nome: string
  cpf: string
  dataNascimento?: string | null
  tipo: TipoTrabalhador
  cargo: string
  cbo?: string | null
  salarioBase: number
  dataAdmissao: string
  dataDesligamento?: string | null
  dependentesIrrf: number
  matricula?: string | null
  categoriaEsocial?: number
  ativo: boolean
}

export interface Rubrica {
  codigo: string
  descricao: string
  tipo: TipoRubrica
  incideInss: boolean
  incideIrrf: boolean
  incideFgts: boolean
  natureza?: string
  padrao?: boolean
}

export interface LancamentoFolha {
  codigo: string
  descricao: string
  tipo: TipoRubrica
  valor: number
  referencia?: string
}

export interface ResultadoHolerite {
  totalProventos: number
  totalDescontos: number
  liquido: number
  baseInss: number
  inss: number
  irrf: { base: number; metodo: 'simplificado' | 'deducoes-legais'; impostoPelaTabela: number; reducao: number; valor: number; aliquota: number }
  baseFgts: number
  fgts: number
  linhas: LancamentoFolha[]
  tabelas: { inss: string; irrf: string }
  avisos: string[]
}

/** /empresas/{id}/folhas/{AAAA-MM}/holerites/{funcionarioId} — gravado só pelo backend */
export interface Holerite {
  funcionarioId: string
  competencia: string
  lancamentos: LancamentoFolha[]
  resultado: ResultadoHolerite
}

/** /empresas/{id}/folhas/{AAAA-MM} */
export interface Folha {
  competencia: string
  status: 'aberta' | 'fechada'
  totais?: { funcionarios: number; proventos: number; descontos: number; liquido: number; inss: number; irrf: number; fgts: number }
}
