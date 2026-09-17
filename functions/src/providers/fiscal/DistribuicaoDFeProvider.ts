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

/**
 * O teste de conexão usa a consulta pontual `consNSU`. Nela, três retornos provam que deu certo:
 * o certificado foi aceito, o TLS mútuo fechou, o XML passou no schema e a SEFAZ processou.
 *
 *  137 nenhum documento localizado
 *  138 documento(s) localizado(s)
 *  589 NSU informado maior que o maior NSU do Ambiente Nacional — é o retorno normal para um
 *      CNPJ que ainda não tem documento nenhum (maxNSU = 0), que é o caso em homologação
 *
 * O 656 também prova que a comunicação funciona, mas o CNPJ está de castigo por 1 hora, então
 * vale como aviso. Qualquer outro código é problema de verdade (certificado, CNPJ, ambiente).
 */
export function avaliarTesteDeConexao(cStat: string): 'ok' | 'atencao' | 'erro' {
  if (cStat === RETORNO.NENHUM_DOCUMENTO || cStat === RETORNO.DOCUMENTO_LOCALIZADO || cStat === RETORNO.NSU_SUPERIOR_AO_MAXIMO) {
    return 'ok'
  }
  if (cStat === RETORNO.CONSUMO_INDEVIDO) return 'atencao'
  return 'erro'
}

/** Mensagem do teste de conexão — diferente da do fluxo de sincronização. */
export function explicarTesteDeConexao(cStat: string, xMotivo: string, ambiente: AmbienteFiscal, maxNSU?: string): string {
  const onde = ambiente === 'producao' ? 'produção' : 'homologação'
  const aceito = `Conexão com a SEFAZ (${onde}) funcionando: o certificado foi aceito.`
  const primeiroAcesso = Number(maxNSU ?? '0') === 0
  switch (cStat) {
    case RETORNO.DOCUMENTO_LOCALIZADO:
      return `${aceito} Já há documentos disponíveis para este CNPJ.`
    case RETORNO.NENHUM_DOCUMENTO:
    case RETORNO.NSU_SUPERIOR_AO_MAXIMO:
      if (ambiente === 'homologacao') {
        return `${aceito} Ainda não há documentos disponíveis para este CNPJ — o que é o normal em homologação.`
      }
      // NT 2014.002, item 3.4: para quem nunca usou o distNSU (ou ficou 60 dias sem usar), a
      // geração de NSU só começa no primeiro acesso, e não é retroativa. O primeiro acesso volta
      // 137; depois de 1 hora, as consultas seguintes já podem trazer documentos.
      return primeiroAcesso
        ? `${aceito} O maior NSU deste CNPJ ainda é 0: pela regra da SEFAZ, a numeração só começa a ser gerada no primeiro acesso ao serviço de distribuição, e não é retroativa. Clique em "Sincronizar agora" para iniciar a numeração e aguarde 1 hora — a partir daí as notas novas passam a chegar.`
        : `${aceito} Não há documentos novos para este CNPJ no momento.`
    case RETORNO.CONSUMO_INDEVIDO:
      return `A SEFAZ (${onde}) respondeu, então a comunicação funciona, mas o CNPJ está bloqueado por 1 hora por consumo indevido. Tente de novo depois desse prazo.`
    default:
      return `SEFAZ (${onde}) recusou com o código ${cStat}: ${explicarRetorno(cStat, xMotivo)}`
  }
}
