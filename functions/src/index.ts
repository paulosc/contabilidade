/**
 * Ponto de entrada das Cloud Functions (gen2, southamerica-east1).
 *
 * Integração fiscal (NF-e): `sincronizarFiscalPeriodico` roda de hora em hora e busca no
 * NFeDistribuicaoDFe (Ambiente Nacional) os documentos de cada empresa com certificado A1
 * cadastrado. Detalhes em docs/FISCAL_NFE.md.
 */
import { setGlobalOptions } from 'firebase-functions/v2'
import { REGIAO } from './lib/config'

setGlobalOptions({ region: REGIAO, maxInstances: 10 })

export { aoEscreverMembro, aoEscreverEmpresa, sincronizarMinhasEmpresas } from './triggers'
export {
  salvarCertificadoFiscal,
  removerCertificadoFiscal,
  ativarIntegracaoFiscal,
  testarConexaoFiscal,
  sincronizarFiscalAgora,
  statusFiscal,
  xmlNotaFiscal,
  sincronizarFiscalPeriodico,
  ativarNfse,
  sincronizarNfseAgora,
  xmlNotaServico,
  pdfNotaServico,
  importarNfseMunicipal,
  diagnosticoNfseNacional,
  modeloEmissaoNfse,
  numeracaoEmissaoNfse,
  emitirNfse,
  cancelarNfse,
  importarGuia,
  pdfGuia,
  marcarGuiaPaga,
  excluirGuia,
  gerarReciboDeHonorarios,
  linkGuia,
  guiaCompartilhada,
  salvarCredenciaisSerpro,
  removerCredenciaisSerpro,
  testarSerpro,
  gerarDasReceita,
  gerarDarfReceita,
  declaracaoPgdasd,
  conferirPagamentosReceita,
  caixaPostalReceita,
  situacaoFiscalReceita,
  pdfSituacaoFiscalGuardado,
  prepararFolha,
  calcularFolhaDoMes,
  removerHoleriteDaFolha,
  fecharFolhaDoMes,
  pdfHolerite,
  salvarMunicipioWebservice,
  sincronizarNfsePeriodico,
} from './fiscal'
export {
  carteiraDeClientes,
  calendarioObrigacoes,
  marcarObrigacaoFeita,
  apuracaoSimples,
  adicionarMembroDaEmpresa,
  alterarMembroDaEmpresa,
  enviarDocumentoDaEmpresa,
  baixarDocumentoDaEmpresa,
  excluirDocumentoDaEmpresa,
  criarSolicitacaoDeDocumento,
  avaliarSolicitacaoDeDocumento,
  gerarContratoDeServicos,
  honorariosRecorrentes,
} from './escritorio'
export {
  prepararContabilidadeDaEmpresa,
  criarContaContabil,
  importarExtratoOfx,
  conciliarMovimento,
  lancarContabil,
  excluirLancamentoContabil,
  demonstracoesContabeis,
  razaoContabil,
  fecharPeriodoContabil,
} from './contabil'
export { registrarLucroDistribuido, excluirLucroDistribuido } from './folha/lucrosServico'
