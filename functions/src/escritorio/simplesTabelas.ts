/**
 * Tabelas do Simples Nacional — Anexos I a V da LC 123/2006, redação da LC 155/2016
 * (vigência 01/01/2018). Transcritas do texto oficial:
 * https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
 *
 * Valores monetários em reais; alíquotas e repartição em percentual (6 = 6%).
 * A repartição de cada faixa soma 100%.
 */

export type Anexo = 'I' | 'II' | 'III' | 'IV' | 'V'

export type Tributo = 'IRPJ' | 'CSLL' | 'Cofins' | 'PIS/Pasep' | 'CPP' | 'ICMS' | 'IPI' | 'ISS'

export interface FaixaSimples {
  faixa: 1 | 2 | 3 | 4 | 5 | 6
  /** Limite superior da receita bruta em 12 meses */
  ate: number
  aliquota: number
  deduzir: number
  reparticao: Partial<Record<Tributo, number>>
}

const LIMITES = [180_000, 360_000, 720_000, 1_800_000, 3_600_000, 4_800_000] as const

const montar = (linhas: Array<[number, number, Partial<Record<Tributo, number>>]>): FaixaSimples[] =>
  linhas.map(([aliquota, deduzir, reparticao], i) => ({ faixa: (i + 1) as FaixaSimples['faixa'], ate: LIMITES[i], aliquota, deduzir, reparticao }))

export const ANEXOS: Record<Anexo, { titulo: string; faixas: FaixaSimples[] }> = {
  I: {
    titulo: 'Comércio',
    faixas: montar([
      [4.0, 0, { IRPJ: 5.5, CSLL: 3.5, Cofins: 12.74, 'PIS/Pasep': 2.76, CPP: 41.5, ICMS: 34.0 }],
      [7.3, 5_940, { IRPJ: 5.5, CSLL: 3.5, Cofins: 12.74, 'PIS/Pasep': 2.76, CPP: 41.5, ICMS: 34.0 }],
      [9.5, 13_860, { IRPJ: 5.5, CSLL: 3.5, Cofins: 12.74, 'PIS/Pasep': 2.76, CPP: 42.0, ICMS: 33.5 }],
      [10.7, 22_500, { IRPJ: 5.5, CSLL: 3.5, Cofins: 12.74, 'PIS/Pasep': 2.76, CPP: 42.0, ICMS: 33.5 }],
      [14.3, 87_300, { IRPJ: 5.5, CSLL: 3.5, Cofins: 12.74, 'PIS/Pasep': 2.76, CPP: 42.0, ICMS: 33.5 }],
      [19.0, 378_000, { IRPJ: 13.5, CSLL: 10.0, Cofins: 28.27, 'PIS/Pasep': 6.13, CPP: 42.1 }],
    ]),
  },
  II: {
    titulo: 'Indústria',
    faixas: montar([
      [4.5, 0, { IRPJ: 5.5, CSLL: 3.5, Cofins: 11.51, 'PIS/Pasep': 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32.0 }],
      [7.8, 5_940, { IRPJ: 5.5, CSLL: 3.5, Cofins: 11.51, 'PIS/Pasep': 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32.0 }],
      [10.0, 13_860, { IRPJ: 5.5, CSLL: 3.5, Cofins: 11.51, 'PIS/Pasep': 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32.0 }],
      [11.2, 22_500, { IRPJ: 5.5, CSLL: 3.5, Cofins: 11.51, 'PIS/Pasep': 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32.0 }],
      [14.7, 85_500, { IRPJ: 5.5, CSLL: 3.5, Cofins: 11.51, 'PIS/Pasep': 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32.0 }],
      [30.0, 720_000, { IRPJ: 8.5, CSLL: 7.5, Cofins: 20.96, 'PIS/Pasep': 4.54, CPP: 23.5, IPI: 35.0 }],
    ]),
  },
  III: {
    titulo: 'Serviços (locação de bens móveis e serviços não relacionados no § 5º-C do art. 18)',
    faixas: montar([
      [6.0, 0, { IRPJ: 4.0, CSLL: 3.5, Cofins: 12.82, 'PIS/Pasep': 2.78, CPP: 43.4, ISS: 33.5 }],
      [11.2, 9_360, { IRPJ: 4.0, CSLL: 3.5, Cofins: 14.05, 'PIS/Pasep': 3.05, CPP: 43.4, ISS: 32.0 }],
      [13.5, 17_640, { IRPJ: 4.0, CSLL: 3.5, Cofins: 13.64, 'PIS/Pasep': 2.96, CPP: 43.4, ISS: 32.5 }],
      [16.0, 35_640, { IRPJ: 4.0, CSLL: 3.5, Cofins: 13.64, 'PIS/Pasep': 2.96, CPP: 43.4, ISS: 32.5 }],
      [21.0, 125_640, { IRPJ: 4.0, CSLL: 3.5, Cofins: 12.82, 'PIS/Pasep': 2.78, CPP: 43.4, ISS: 33.5 }],
      [33.0, 648_000, { IRPJ: 35.0, CSLL: 15.0, Cofins: 16.03, 'PIS/Pasep': 3.47, CPP: 30.5 }],
    ]),
  },
  IV: {
    titulo: 'Serviços do § 5º-C do art. 18 (construção, vigilância, limpeza, advocacia) — CPP fora do DAS',
    faixas: montar([
      [4.5, 0, { IRPJ: 18.8, CSLL: 15.2, Cofins: 17.67, 'PIS/Pasep': 3.83, ISS: 44.5 }],
      [9.0, 8_100, { IRPJ: 19.8, CSLL: 15.2, Cofins: 20.55, 'PIS/Pasep': 4.45, ISS: 40.0 }],
      [10.2, 12_420, { IRPJ: 20.8, CSLL: 15.2, Cofins: 19.73, 'PIS/Pasep': 4.27, ISS: 40.0 }],
      [14.0, 39_780, { IRPJ: 17.8, CSLL: 19.2, Cofins: 18.9, 'PIS/Pasep': 4.1, ISS: 40.0 }],
      [22.0, 183_780, { IRPJ: 18.8, CSLL: 19.2, Cofins: 18.08, 'PIS/Pasep': 3.92, ISS: 40.0 }],
      [33.0, 828_000, { IRPJ: 53.5, CSLL: 21.5, Cofins: 20.55, 'PIS/Pasep': 4.45 }],
    ]),
  },
  V: {
    titulo: 'Serviços do § 5º-I do art. 18 (sujeitos ao Fator R)',
    faixas: montar([
      [15.5, 0, { IRPJ: 25.0, CSLL: 15.0, Cofins: 14.1, 'PIS/Pasep': 3.05, CPP: 28.85, ISS: 14.0 }],
      [18.0, 4_500, { IRPJ: 23.0, CSLL: 15.0, Cofins: 14.1, 'PIS/Pasep': 3.05, CPP: 27.85, ISS: 17.0 }],
      [19.5, 9_900, { IRPJ: 24.0, CSLL: 15.0, Cofins: 14.92, 'PIS/Pasep': 3.23, CPP: 23.85, ISS: 19.0 }],
      [20.5, 17_100, { IRPJ: 21.0, CSLL: 15.0, Cofins: 15.74, 'PIS/Pasep': 3.41, CPP: 23.85, ISS: 21.0 }],
      [23.0, 62_100, { IRPJ: 23.0, CSLL: 12.5, Cofins: 14.1, 'PIS/Pasep': 3.05, CPP: 23.85, ISS: 23.5 }],
      [30.5, 540_000, { IRPJ: 35.0, CSLL: 15.5, Cofins: 16.44, 'PIS/Pasep': 3.56, CPP: 29.5 }],
    ]),
  },
}

/** Limite de receita bruta anual do Simples Nacional (LC 123, art. 3º, II). */
export const LIMITE_SIMPLES = 4_800_000
/** Sublimite de ICMS e ISS (LC 123, art. 13-A): acima dele, ICMS/ISS saem do DAS. */
export const SUBLIMITE_ICMS_ISS = 3_600_000
/** Fator R mínimo para tributar no Anexo III em vez do V (LC 123, art. 18, § 5º-J). */
export const FATOR_R_MINIMO = 0.28
/** Teto do percentual efetivo de ISS dentro do DAS (LC 123, art. 18, § 1º-B, I). */
export const ISS_EFETIVO_MAXIMO = 5
