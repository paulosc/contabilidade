/**
 * Contrato do serviço de distribuição de documentos fiscais eletrônicos.
 *
 * Mesmo padrão dos demais provedores do backend (BoletoProvider, WhatsappProvider):
 * o serviço de sincronização conversa só com esta interface, e o adapter oficial
 * (Ambiente Nacional da NF-e) fica em `sefazNacional.ts`.
 */

export type AmbienteFiscal = 'homologacao' | 'producao'

/** tpAmb da NF-e: 1 = produção, 2 = homologação (NT 2014.002, campo A03). */
export const tpAmbDe = (ambiente: AmbienteFiscal): '1' | '2' => (ambiente === 'producao' ? '1' : '2')

export interface CredenciaisFiscais {
  /** CNPJ do interessado (14 dígitos, só números/letras do CNPJ alfanumérico) */
  cnpj: string
  /** Certificado digital A1 (e-CNPJ) em base64 */
  pfxBase64: string
  senha: string
  ambiente: AmbienteFiscal
  /** Código IBGE da UF do autor da consulta (opcional no leiaute, campo A04) */
  cUFAutor?: string
  /**
   * Endereço alternativo do Web Service. Existe só para os testes automatizados apontarem
   * para um servidor local; em produção fica vazio e valem os endereços oficiais da NF-e.
   */
  endpoint?: string
}

/** Um documento do lote devolvido pela SEFAZ, já descompactado. */
export interface DocumentoDistribuido {
  /** NSU do documento (o leiaute deixa o atributo opcional desde a v1.15 da NT) */
  nsu?: string
  /** Schema informado pela SEFAZ: resNFe_v1.01.xsd, procNFe_v4.00.xsd, resEvento_v1.01.xsd… */
  schema: string
  /** XML do documento (UTF-8) */
  xml: string
}

/** Resposta do serviço, com os campos do retDistDFeInt (NT 2014.002, item 3.2). */
export interface RespostaDistribuicao {
  tpAmb: string
  verAplic?: string
  /** 137 = nenhum documento, 138 = documento(s) localizado(s), demais = rejeição */
  cStat: string
  xMotivo: string
  dhResp?: string
  /** Último NSU pesquisado; é ele que deve ser usado na próxima consulta */
  ultNSU?: string
  /** Maior NSU disponível no Ambiente Nacional para o CNPJ consultado */
  maxNSU?: string
  documentos: DocumentoDistribuido[]
  /** Tempo da chamada em ms (observabilidade) */
  duracaoMs: number
}

export interface DistribuicaoDFeProvider {
  readonly nome: string
  /** distNSU — lote de até 50 documentos com NSU maior que o informado. */
  distribuirPorNsu(ultNSU: string): Promise<RespostaDistribuicao>
  /** consNSU — consulta pontual de um NSU identificado como faltante. */
  consultarNsu(nsu: string): Promise<RespostaDistribuicao>
  /** consChNFe — consulta pontual de uma NF-e pela chave de acesso. */
  consultarChave(chNFe: string): Promise<RespostaDistribuicao>
}

/** Códigos de retorno relevantes do NFeDistribuicaoDFe (NT 2014.002, item 4). */
export const RETORNO = {
  PARALISADO_CURTO: '108',
  PARALISADO_SEM_PREVISAO: '109',
  NENHUM_DOCUMENTO: '137',
  DOCUMENTO_LOCALIZADO: '138',
  MENSAGEM_GRANDE: '214',
  FALHA_SCHEMA: '215',
  AMBIENTE_DIVERGENTE: '252',
  CERTIFICADO_INVALIDO: '280',
  CERTIFICADO_VENCIDO: '281',
  CERTIFICADO_REVOGADO: '284',
  CERTIFICADO_SEM_CNPJ: '473',
  CNPJ_INVALIDO: '489',
  NSU_SUPERIOR_AO_MAXIMO: '589',
  CNPJ_DIFERE_CERTIFICADO: '593',
  FORA_DE_PRAZO: '632',
  SEM_PERMISSAO: '640',
  CONSUMO_INDEVIDO: '656',
} as const

/** Mensagem amigável para os códigos que o usuário da empresa pode ver na tela. */
export function explicarRetorno(cStat: string, xMotivo: string): string {
  switch (cStat) {
    case RETORNO.NENHUM_DOCUMENTO:
      return 'Nenhum documento novo disponível na SEFAZ.'
    case RETORNO.DOCUMENTO_LOCALIZADO:
      return 'Documentos localizados.'
    case RETORNO.CONSUMO_INDEVIDO:
      return 'A SEFAZ bloqueou o CNPJ por consumo indevido. A próxima consulta só é permitida depois de 1 hora.'
    case RETORNO.CNPJ_DIFERE_CERTIFICADO:
      return 'O CNPJ consultado não tem a mesma raiz (8 primeiros dígitos) do CNPJ do certificado digital.'
    case RETORNO.CERTIFICADO_SEM_CNPJ:
      return 'O certificado enviado não tem CNPJ nem CPF. Use um e-CNPJ A1 da ICP-Brasil.'
    case RETORNO.CERTIFICADO_VENCIDO:
      return 'Certificado digital fora do prazo de validade.'
    case RETORNO.CERTIFICADO_REVOGADO:
      return 'Certificado digital revogado.'
    case RETORNO.AMBIENTE_DIVERGENTE:
      return 'Ambiente informado diferente do ambiente do serviço. Confira produção × homologação.'
    case RETORNO.NSU_SUPERIOR_AO_MAXIMO:
      return 'O NSU guardado é maior que o maior NSU da SEFAZ; o controle será reposicionado automaticamente.'
    case RETORNO.PARALISADO_CURTO:
    case RETORNO.PARALISADO_SEM_PREVISAO:
      return 'Serviço da SEFAZ paralisado no momento. A sincronização será repetida depois.'
    default:
      return xMotivo || `Retorno ${cStat} da SEFAZ.`
  }
}
