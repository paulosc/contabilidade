/**
 * Modelo de dados da integração fiscal (NF-e) no Firestore.
 *
 * Tudo vive dentro do tenant, seguindo o padrão do projeto (/empresas/{id}/...):
 *
 *   /empresas/{id}/privado/fiscal            certificado A1 cifrado (só o backend; Rules negam)
 *   /empresas/{id}/configuracoes/fiscal      resumo sem segredo, lido pela tela em tempo real
 *   /empresas/{id}/notasFiscais/{chave}      metadados da NF-e (id = chave de acesso → idempotente)
 *   /empresas/{id}/sincronizacoesFiscais/{id} histórico de cada execução
 *   /empresas/{id}/auditoriaFiscal/{id}      quem mexeu no certificado / baixou XML
 *
 * O XML completo fica no Storage:
 *   empresas/{id}/fiscal/{AAAA}/{chave}-nfe.xml  e  .../{chave}-evento-{tpEvento}-{nSeq}.xml
 */
import type { Timestamp } from 'firebase-admin/firestore'
import { db } from '../lib/admin'
import type { AmbienteFiscal } from '../providers/fiscal/DistribuicaoDFeProvider'

export const COL_NOTAS = 'notasFiscais'
export const COL_NOTAS_SERVICO = 'notasServico'
export const COL_SINCRONIZACOES = 'sincronizacoesFiscais'
export const COL_AUDITORIA = 'auditoriaFiscal'

export const raizRef = (empresaId: string) => db.collection('empresas').doc(empresaId)
export const privadoFiscalRef = (empresaId: string) => raizRef(empresaId).collection('privado').doc('fiscal')
export const configFiscalRef = (empresaId: string) => raizRef(empresaId).collection('configuracoes').doc('fiscal')
/** Credenciais do Serpro, cifradas. /privado é negado a todo cliente pelas regras. */
export const privadoSerproRef = (empresaId: string) => raizRef(empresaId).collection('privado').doc('serpro')
export const notasRef = (empresaId: string) => raizRef(empresaId).collection(COL_NOTAS)
export const notasServicoRef = (empresaId: string) => raizRef(empresaId).collection(COL_NOTAS_SERVICO)
export const sincronizacoesRef = (empresaId: string) => raizRef(empresaId).collection(COL_SINCRONIZACOES)
export const auditoriaRef = (empresaId: string) => raizRef(empresaId).collection(COL_AUDITORIA)
export const guiasRef = (empresaId: string) => raizRef(empresaId).collection('guias')
export const configHonorariosRef = (empresaId: string) => raizRef(empresaId).collection('configuracoes').doc('honorarios')
/** PDF de uma guia, sempre dentro da pasta da empresa. O id já é higienizado (dígitos, letras e hífen). */
export const caminhoGuia = (empresaId: string, guiaId: string): string =>
  `empresas/${empresaId}/guias/${guiaId.replace(/[^A-Za-z0-9-]/g, '')}.pdf`

/** Caminho do XML da NFS-e no Storage (chave de 50 dígitos; a competência organiza as pastas). */
export function caminhoXmlServico(empresaId: string, chave: string, sufixo: string): string {
  const ano = chave.length >= 40 ? `20${chave.slice(36, 38)}` : String(new Date().getFullYear())
  return `empresas/${empresaId}/nfse/${ano}/${chave}-${sufixo}.xml`
}

/** Caminho do XML no Storage. A chave de acesso no nome mantém o arquivo único por documento. */
export function caminhoXml(empresaId: string, chave: string, sufixo: string): string {
  const ano = chave.length >= 6 ? `20${chave.slice(2, 4)}` : String(new Date().getFullYear())
  return `empresas/${empresaId}/fiscal/${ano}/${chave}-${sufixo}.xml`
}

/**
 * Decide qual arquivo do Storage a empresa pode baixar.
 *
 * Só caminhos que estão gravados no próprio documento da nota (o da NF-e ou o de um evento dela)
 * e que ficam debaixo de `empresas/{id}/fiscal/`. Caminho vindo do cliente que não bata com
 * isso é descartado — é o que impede a empresa A de pedir o XML da empresa B.
 */
export function resolverCaminhoXml(
  empresaId: string,
  nota: { storagePath?: string; eventos?: Array<{ storagePath?: string }> },
  pedido?: string,
): string | null {
  const prefixo = `empresas/${empresaId}/fiscal/`
  const permitidos = [nota.storagePath, ...(nota.eventos ?? []).map((e) => e.storagePath)].filter(
    (c): c is string => Boolean(c) && c!.startsWith(prefixo),
  )
  if (pedido) return permitidos.includes(pedido) ? pedido : null
  return permitidos[0] ?? null
}

// ---------- documento privado (segredos) ----------

export interface CertificadoGuardado {
  /** .pfx em base64, cifrado com FISCAL_CRYPTO_KEY */
  arquivoCifrado: string
  /** senha do .pfx, cifrada com FISCAL_CRYPTO_KEY */
  senhaCifrada: string
  documento: string
  tipo: 'e-CNPJ' | 'e-CPF'
  titular: string
  emissor: string
  validoDe: Timestamp
  validoAte: Timestamp
  impressaoDigital: string
  enviadoEm: Timestamp
  enviadoPor: string
}

export interface PrivadoSerpro {
  consumerKeyCifrada: string
  consumerSecretCifrada: string
  atualizadoEm?: Timestamp
}

export interface PrivadoFiscal {
  certificado?: CertificadoGuardado
}

// ---------- documento público (resumo para a tela) ----------

export type SituacaoSync = 'ocioso' | 'executando' | 'erro' | 'bloqueado' | 'aguardando'

export interface ResumoCertificado {
  documento: string
  tipo: 'e-CNPJ' | 'e-CPF'
  titular: string
  emissor: string
  validoDe: Timestamp
  validoAte: Timestamp
  impressaoDigital: string
  enviadoEm: Timestamp
}

export interface EstadoSincronizacao {
  /** Último NSU já processado e gravado (controle por empresa, nunca global) */
  ultimoNsu: string
  /** Maior NSU que a SEFAZ informou existir para este CNPJ */
  maxNsu: string
  /** NSU enviado na última requisição (ajuda a diagnosticar 656/589) */
  ultimoNsuConsultado?: string
  ultimaSincronizacao?: Timestamp
  /** Antes deste horário não consultamos de novo (regra de 1 h da NT 2014.002, item 3.11.4) */
  proximaPermitidaEm?: Timestamp
  status: SituacaoSync
  codigoRetorno?: string
  mensagemRetorno?: string
  documentosEncontrados: number
  documentosProcessados: number
  erros: number
  /** Trava de concorrência: quem está executando e desde quando */
  lockEm?: Timestamp
  lockPor?: string
}

/** Estado da distribuição de NFS-e pelo ADN — NSU próprio, separado do da NF-e. */
export interface EstadoSincronizacaoNfse {
  ultimoNsu: string
  maxNsu: string
  ultimaSincronizacao?: Timestamp
  proximaPermitidaEm?: Timestamp
  status: SituacaoSync
  mensagemRetorno?: string
  documentosEncontrados: number
  documentosProcessados: number
  erros: number
  lockEm?: Timestamp
  lockPor?: string
  /** Chaves do JSON que o ADN devolveu, para conferir o formato real na primeira execução */
  formatoRecebido?: string[]
}

export interface ConfiguracaoFiscal {
  /** Discriminador do documento dentro do collection group `configuracoes` (usado pelo worker) */
  tipo: 'fiscal'
  ativo: boolean
  ambiente: AmbienteFiscal
  /** CNPJ consultado na SEFAZ (14 posições). Precisa ter a mesma raiz do CNPJ do certificado */
  cnpj: string
  uf?: string
  certificado?: ResumoCertificado
  sincronizacao: EstadoSincronizacao
  /** Ligada separadamente: nem toda empresa emite nota de serviço */
  nfseAtivo?: boolean
  /** Apelido ou host do município na plataforma ABRASF, ex.: 'conceicaodosouros' */
  municipioWebservice?: string
  /** Inscrição municipal do prestador, exigida na consulta ABRASF */
  inscricaoMunicipal?: string
  importacaoMunicipal?: {
    ultimaEm?: Timestamp
    periodoDe?: string
    periodoAte?: string
    notasImportadas?: number
  }
  sincronizacaoNfse?: EstadoSincronizacaoNfse
  /** Integra Contador (Serpro): só o resumo — key e secret ficam cifradas em /privado/serpro */
  serpro?: { configurado: boolean; contratante: string; atualizadoEm?: Timestamp }
  /** Numeração própria das NFS-e emitidas por aqui (série de aplicativo próprio, 1–49999) */
  emissao?: { serie: string; proximoNumero: number }
  atualizadoEm: Timestamp
}

// ---------- notas fiscais ----------

export type StatusNota = 'resumo' | 'autorizada' | 'cancelada' | 'denegada'

export interface ProdutoNota {
  codigo?: string
  descricao: string
  ncm?: string
  cfop?: string
  unidade?: string
  quantidade?: number
  valorUnitario?: number
  valorTotal?: number
}

export interface EventoNota {
  tpEvento: string
  descricao: string
  nSeqEvento: string
  dataEvento?: Timestamp
  protocolo?: string
  nsu?: string
  storagePath?: string
}

export interface NotaFiscal {
  chaveAcesso: string
  numero?: string
  serie?: string
  modelo?: string
  naturezaOperacao?: string
  /** 0 = entrada, 1 = saída (campo tpNF) */
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
  /** NSU do documento que trouxe a versão mais completa desta nota */
  nsu?: string
  /** NSU do resumo, quando ele chegou antes do XML completo */
  nsuResumo?: string
  status: StatusNota
  /** true quando já temos o XML completo (procNFe), não só o resumo */
  xmlCompleto: boolean
  storagePath?: string
  hashXml?: string
  produtos?: ProdutoNota[]
  eventos?: EventoNota[]
  ambiente: AmbienteFiscal
  importadoEm: Timestamp
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}

// ---------- histórico ----------

export interface Sincronizacao {
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

export interface RegistroAuditoria {
  operacao: OperacaoAuditada
  uid: string
  email?: string
  detalhe?: string
  chaveAcesso?: string
  criadoEm: Timestamp
}

// ---------- notas de serviço (NFS-e) ----------

export type StatusNotaServico = 'gerada' | 'cancelada'

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
  /** Chave de 50 dígitos (ADN) ou id municipal quando a nota veio da prefeitura */
  chaveAcesso: string
  /** De onde a nota veio: padrão nacional ou web service do município */
  origem?: 'adn' | 'municipal'
  codigoVerificacao?: string
  numero?: string
  serieDps?: string
  numeroDps?: string
  dataEmissao?: Timestamp
  dataProcessamento?: Timestamp
  /** 'YYYY-MM' */
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
  /** A empresa é a prestadora (receita) ou a tomadora (despesa) desta nota? */
  papel: 'prestador' | 'tomador' | 'outro'
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
  cancelamento?: { motivo: string; descricao: string; em: Timestamp; por: string; processadoEm?: string | null }
  importadoEm: Timestamp
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}

/** Mesma proteção do XML da NF-e: só caminhos gravados no documento e dentro da empresa. */
export function resolverCaminhoXmlServico(
  empresaId: string,
  nota: { storagePath?: string; eventos?: Array<{ storagePath?: string }> },
  pedido?: string,
): string | null {
  const prefixo = `empresas/${empresaId}/nfse/`
  const permitidos = [nota.storagePath, ...(nota.eventos ?? []).map((e) => e.storagePath)].filter(
    (c): c is string => Boolean(c) && c!.startsWith(prefixo),
  )
  if (pedido) return permitidos.includes(pedido) ? pedido : null
  return permitidos[0] ?? null
}

// ---------- guias a pagar (DAS, DARF, honorários) ----------

export type TipoGuia = 'das' | 'darf' | 'honorarios' | 'outro'

/** /empresas/{id}/guias/{id} — escrita só pelo backend */
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
  /** Só no recibo de honorários gerado com PIX: o BR Code estático, para copiar e colar no banco */
  pixCopiaECola?: string
  composicao: Array<{ codigo: string; denominacao: string; principal: number; total: number }>
  descricao?: string
  emitente?: string
  observacoes?: string
  avisos: string[]
  status: 'pendente' | 'paga'
  pagaEm?: Timestamp
  pagaPor?: string
  /** Link enviado ao cliente e se ele já abriu — a confirmação de leitura da guia */
  compartilhamento?: { enviadoEm?: Timestamp; enviadoPor?: string; expiraEm?: Timestamp; visualizacoes?: number; primeiraVisualizacaoEm?: Timestamp; ultimaVisualizacaoEm?: Timestamp }
  /** Baixa dada pela consulta de pagamentos da Receita (Integra Contador), não à mão */
  pagamentoConfirmado?: { fonte: 'receita'; dataArrecadacao: string; valorTotal?: number; conferidoEm: Timestamp }
  /** 'upload' = PDF oficial enviado; 'serpro' = emitido pela Receita via Integra Contador; 'gerada' = recibo deste sistema */
  origem: 'upload' | 'serpro' | 'gerada'
  nomeArquivo?: string
  storagePath?: string
  hashPdf?: string
  criadoPor: string
  criadoEm: Timestamp
  atualizadoEm: Timestamp
}

/** /empresas/{id}/configuracoes/honorarios — o admin edita pela tela */
export interface ConfiguracaoHonorarios {
  emitente: { nome: string; documento?: string; crc?: string; telefone?: string }
  valorMensal?: number
  diaVencimento?: number
  mensagem?: string
  /** Chave PIX do escritório: com ela o recibo sai com QR Code e copia e cola. Não é segredo — vai impressa no recibo. */
  pix?: { tipo: 'cpf_cnpj' | 'celular' | 'email' | 'aleatoria'; chave: string; nome?: string; cidade: string } | null
  proximoNumero?: number
  atualizadoEm?: Timestamp
}
