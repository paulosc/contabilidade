/**
 * Contrato da distribuição de NFS-e pelo ADN (Ambiente de Dados Nacional).
 *
 * Fonte oficial: "Manual dos Contribuintes — Guia para utilização das API's do ADN" (v1.0,
 * 12/02/2026) e "Manual de Municípios — APIs do ADN" (v1.2), publicados em
 * gov.br/nfse → Biblioteca → Documentação técnica → Documentação atual.
 *
 * O que os manuais definem e este módulo segue:
 *  - `GET /DFe/{ultimoNSU}` devolve **até 50** DF-e a partir do NSU informado;
 *  - o ADN gera um NSU por CPF/CNPJ interessado — prestador, tomador ou intermediário;
 *  - quando `ultNSU == maxNSU` não há mais o que buscar, e é preciso **aguardar 1 hora**
 *    antes de nova solicitação (mesma regra da distribuição de NF-e);
 *  - a conexão usa certificado digital ICP-Brasil (PJ com CNPJ ou PF com CPF), e o CNPJ do
 *    certificado precisa ter a mesma **raiz** do CNPJ consultado.
 *
 * Diferença importante em relação à NF-e: aqui o **emitente é atendido**. Na NF-e a nota não é
 * distribuída para quem a emitiu (rejeição 641); no ADN, o prestador recebe as próprias NFS-e.
 */

export type AmbienteFiscal = 'homologacao' | 'producao'

/**
 * Endereços das APIs de contribuintes do ADN.
 * "produção restrita" é o ambiente de testes citado no manual dos contribuintes.
 */
export const ADN_URLS = {
  producao: 'https://adn.nfse.gov.br/contribuintes',
  homologacao: 'https://adn.producaorestrita.nfse.gov.br/contribuintes',
} as const

/**
 * API DANFSe: gera o PDF da NFS-e a partir da chave de acesso.
 * Manual de Municípios — APIs do ADN, item 1.5: "GET /danfse/{chaveAcesso} — Recupera o DANFSe
 * de uma NFS-e a partir de sua chave de acesso."
 */
export const DANFSE_URLS = {
  producao: 'https://adn.nfse.gov.br/danfse',
  homologacao: 'https://adn.producaorestrita.nfse.gov.br/danfse',
} as const

/**
 * SEFIN Nacional: é a interface que recebe o DPS e emite a NFS-e, e também serve o DANFSe.
 * Base publicada em "APIs - Prod. Restrita e Produção" no portal da NFS-e nacional.
 */
export const SEFIN_URLS = {
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
  homologacao: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
} as const

export interface CredenciaisAdn {
  /** CNPJ (14) ou CPF (11) do interessado, só dígitos */
  documento: string
  /** Certificado A1 em base64 */
  pfxBase64: string
  senha: string
  ambiente: AmbienteFiscal
  /** Endereço alternativo — existe só para os testes automatizados */
  endpoint?: string
}

/** Um DF-e do lote, já decodificado para XML. */
export interface DocumentoServicoDistribuido {
  nsu?: string
  /** Chave de acesso de 50 dígitos, quando a API a informa fora do XML */
  chaveAcesso?: string
  /** NFS-e, evento, ou desconhecido — determinado pela raiz do XML */
  xml: string
}

export interface RespostaDistribuicaoAdn {
  /** HTTP devolvido pela API */
  status: number
  /** Último NSU da sequência devolvida; é ele que vai na próxima consulta */
  ultNSU?: string
  /** Maior NSU existente no ADN para este CPF/CNPJ */
  maxNSU?: string
  documentos: DocumentoServicoDistribuido[]
  /** Mensagem de erro/alerta que a API tenha devolvido */
  mensagem?: string
  duracaoMs: number
  /**
   * Chaves de primeiro nível do JSON recebido. O Swagger do ADN fica atrás de TLS mútuo e não
   * pôde ser lido na implementação; isto permite conferir o formato real na primeira execução
   * sem expor o conteúdo dos documentos.
   */
  formatoRecebido?: string[]
}

export interface AdnContribuintesProvider {
  readonly nome: string
  /** GET /DFe/{ultimoNSU} — lote de até 50 documentos com NSU maior que o informado. */
  distribuirPorNsu(ultimoNSU: string): Promise<RespostaDistribuicaoAdn>
  /** GET /NFSe/{chaveAcesso}/Eventos — eventos vinculados a uma NFS-e. */
  eventosDaChave(chaveAcesso: string): Promise<RespostaDistribuicaoAdn>
  /** GET /danfse/{chaveAcesso} — PDF do documento auxiliar (DANFSe). */
  /** Sonda um endereço oficial com o mesmo certificado, para ler o Swagger que exige mTLS. */
  sondar(urlCompleta: string): Promise<{ url: string; status: number; corpo: string }>

  danfse(chaveAcesso: string): Promise<Buffer>
  encerrar(): void
}

/** Situações da NFS-e (campo cStat do leiaute nacional, tipo TStat). */
export const SITUACAO_NFSE: Record<string, string> = {
  '100': 'NFS-e Gerada',
  '102': 'NFS-e de Decisão Judicial',
  '103': 'NFS-e Avulsa',
  '107': 'NFS-e MEI',
}

/** Ambiente gerador da NFS-e (tipo TSAmbGeradorNFSe). */
export const AMBIENTE_GERADOR: Record<string, string> = {
  '1': 'Prefeitura',
  '2': 'Sistema Nacional da NFS-e',
}

/** A chave de acesso da NFS-e nacional tem 50 dígitos (a da NF-e tem 44). */
export const CHAVE_NFSE_TAMANHO = 50

/**
 * Decompõe a chave de acesso de 50 posições.
 * Formação (tipo TSIdNFSe): Cód.Mun.(7) + Amb.Ger.(1) + Tipo de Inscrição Federal(1) +
 * Inscrição Federal(14) + nNFSe(13) + AAMM da emissão(4) + Código numérico(9) + DV(1).
 */
export function lerChaveNfse(chave: string): {
  codigoMunicipio: string
  ambienteGerador: string
  tipoInscricao: string
  inscricaoFederal: string
  numero: string
  competencia: string
  codigoNumerico: string
  dv: string
} | null {
  const so = (chave ?? '').replace(/\D/g, '')
  if (so.length !== CHAVE_NFSE_TAMANHO) return null
  return {
    codigoMunicipio: so.slice(0, 7),
    ambienteGerador: so.slice(7, 8),
    tipoInscricao: so.slice(8, 9),
    inscricaoFederal: so.slice(9, 23),
    numero: String(Number(so.slice(23, 36))),
    // AAMM -> AA a partir de 2000
    competencia: `20${so.slice(36, 38)}-${so.slice(38, 40)}`,
    codigoNumerico: so.slice(40, 49),
    dv: so.slice(49, 50),
  }
}

/** A mesma regra de raiz de CNPJ da NF-e: o certificado precisa cobrir o CNPJ consultado. */
export function mesmaRaiz(consultado: string, doCertificado: string): boolean {
  const a = (consultado ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  const b = (doCertificado ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  // CPF é comparado inteiro; CNPJ, pela raiz de 8
  if (a.length === 11 || b.length === 11) return a === b
  return a.length >= 8 && b.length >= 8 && a.slice(0, 8) === b.slice(0, 8)
}
