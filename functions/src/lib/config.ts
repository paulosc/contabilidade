/**
 * Segredos e parâmetros do backend.
 *
 * Segredos (firebase functions:secrets:set NOME): FISCAL_CRYPTO_KEY.
 * Parâmetros (functions/.env): SEFAZ_AMBIENTE, FISCAL_MAX_EMPRESAS, FISCAL_MAX_LOTES.
 *
 * Detalhes da integração fiscal em docs/FISCAL_NFE.md.
 */
import { defineSecret, defineString, defineInt } from 'firebase-functions/params'

export const REGIAO = 'southamerica-east1'

/**
 * Chave mestra (32 bytes em base64) que cifra o certificado A1 e a senha de cada empresa
 * antes de gravá-los em /empresas/{id}/privado/fiscal. Gere com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export const FISCAL_CRYPTO_KEY = defineSecret('FISCAL_CRYPTO_KEY')

/** Ambiente da NF-e sugerido no cadastro: 'homologacao' (tpAmb=2) ou 'producao' (tpAmb=1) */
export const SEFAZ_AMBIENTE = defineString('SEFAZ_AMBIENTE', { default: 'homologacao' })
/** Quantas empresas uma execução do worker fiscal processa (evita execução sem fim) */
export const FISCAL_MAX_EMPRESAS = defineInt('FISCAL_MAX_EMPRESAS', { default: 10 })
/** Quantos lotes (até 50 documentos cada) uma sincronização busca antes de parar e retomar depois */
export const FISCAL_MAX_LOTES = defineInt('FISCAL_MAX_LOTES', { default: 20 })
