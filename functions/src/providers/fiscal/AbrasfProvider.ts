/**
 * Contrato da consulta de NFS-e nos sistemas municipais no padrão ABRASF 2.02.
 *
 * Fonte oficial: o próprio portal do município publica o contrato em
 * "Manuais e Legislação → Integração com o Webservice / RPS / XML". Para Conceição dos Ouros
 * (plataforma SH3 / nfiss):
 *
 *   WSDL   https://conceicaodosouros.nfiss.com.br/?WSDL
 *   SOAP   https://conceicaodosouros.nfiss.com.br/soap/
 *   XSD    https://conceicaodosouros.nfiss.com.br/soap/nfse_v202.xsd
 *   Padrão ABRASF 2.02, certificado e-CNPJ ou e-CPF
 *
 * O portal diz que produção e homologação seguem o mesmo molde de endereço, trocando o
 * subdomínio: `{municipio}.nfiss.com.br` e `homologa{municipio}.nfiss.com.br`. Por isso o
 * adapter recebe o host, em vez de ter Conceição dos Ouros escrita no código — qualquer
 * município nessa plataforma funciona com a mesma implementação.
 *
 * Por que este módulo existe, já havendo a integração com o ADN nacional: o município migrou
 * para o Emissor Nacional em 2026, e as notas anteriores ficaram só no sistema municipal, que o
 * Ambiente de Dados Nacional não conhece. Esta é a única via oficial de alcançá-las.
 *
 * Importante: a consulta NÃO exige assinatura XMLDSig (os exemplos oficiais de
 * ConsultarNfseServicoPrestadoEnvio vêm sem `Signature`; só GerarNfse e CancelarNfse assinam).
 */

export type AmbienteFiscal = 'homologacao' | 'producao'

/** Namespaces do padrão ABRASF 2.02, conforme o WSDL publicado pelo município. */
export const ABRASF_NS_SERVICO = 'http://nfse.abrasf.org.br'
export const ABRASF_NS_DADOS = 'http://www.abrasf.org.br/nfse.xsd'
export const ABRASF_VERSAO = '2.02'

export interface CredenciaisAbrasf {
  /** Host do município na plataforma, ex.: 'conceicaodosouros.nfiss.com.br' */
  host: string
  /** CNPJ (14) ou CPF (11) do prestador, só dígitos */
  documento: string
  /** Inscrição municipal do prestador — a consulta por prestador exige */
  inscricaoMunicipal?: string
  pfxBase64: string
  senha: string
  ambiente: AmbienteFiscal
  /** Endereço alternativo completo — existe só para os testes automatizados */
  endpoint?: string
}

/** Host de produção/homologação a partir do apelido do município na plataforma. */
export function hostDoMunicipio(apelido: string, ambiente: AmbienteFiscal): string {
  const limpo = (apelido ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  // já veio um host completo
  if (limpo.includes('.')) return ambiente === 'producao' ? limpo : `homologa${limpo}`
  return ambiente === 'producao' ? `${limpo}.nfiss.com.br` : `homologa${limpo}.nfiss.com.br`
}

/** Uma NFS-e municipal já lida do retorno. */
export interface NotaAbrasf {
  numero: string
  codigoVerificacao?: string
  dataEmissao?: Date
  competencia?: string
  cancelada: boolean
  /** Número e série do RPS que originou a nota */
  numeroRps?: string
  serieRps?: string
  cnpjPrestador?: string
  razaoSocialPrestador?: string
  inscricaoMunicipalPrestador?: string
  cnpjTomador?: string
  razaoSocialTomador?: string
  discriminacao?: string
  itemListaServico?: string
  codigoTributacaoMunicipio?: string
  codigoMunicipio?: string
  valorServicos?: number
  baseCalculo?: number
  aliquota?: number
  valorIss?: number
  valorLiquido?: number
  /** XML do bloco CompNfse, guardado como está veio */
  xml: string
}

export interface RespostaConsultaAbrasf {
  notas: NotaAbrasf[]
  /** A resposta indica que há mais páginas? */
  temMaisPaginas: boolean
  /** Mensagens de erro/alerta devolvidas pelo município */
  mensagens: string[]
  duracaoMs: number
}

export interface AbrasfProvider {
  readonly nome: string
  /** ConsultarNfseServicoPrestado — as notas que a empresa emitiu no período. */
  consultarPrestadas(de: Date, ate: Date, pagina: number): Promise<RespostaConsultaAbrasf>
  /** ConsultarNfseServicoTomado — as notas que a empresa recebeu no período. */
  consultarTomadas(de: Date, ate: Date, pagina: number): Promise<RespostaConsultaAbrasf>
  encerrar(): void
}

/**
 * O ABRASF limita o período de cada consulta. O manual do padrão fala em intervalos curtos e
 * os municípios costumam recusar faixas longas, então varremos mês a mês: é previsível,
 * cabe no limite de qualquer implementação e deixa o progresso fácil de retomar.
 */
export function mesesEntre(de: Date, ate: Date): Array<{ de: Date; ate: Date }> {
  const faixas: Array<{ de: Date; ate: Date }> = []
  const cursor = new Date(de.getFullYear(), de.getMonth(), 1)
  const limite = new Date(ate.getFullYear(), ate.getMonth(), 1)
  while (cursor <= limite) {
    const inicio = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const fim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    faixas.push({ de: inicio < de ? de : inicio, ate: fim > ate ? ate : fim })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return faixas
}

/** Data no formato AAAA-MM-DD exigido pelo leiaute. */
export const dataAbrasf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
