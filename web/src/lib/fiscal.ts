/**
 * Apoio da tela de documentos fiscais: validações (react-hook-form + zod) e formatações.
 *
 * O arquivo do certificado e a senha só existem aqui de passagem, para irem direto para a
 * Cloud Function `salvarCertificadoFiscal`. Nada disso é guardado no navegador.
 */
import { z } from 'zod'
import { somenteDigitos, validarCnpj } from './utils'

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

/** Formulário de cadastro do certificado A1. O arquivo vai à parte (input file não entra no zod). */
export const esquemaCertificadoFiscal = z.object({
  cnpj: z.string().refine((v) => validarCnpj(v), 'CNPJ inválido'),
  uf: z.enum(UFS, { message: 'Escolha a UF' }),
  ambiente: z.enum(['homologacao', 'producao']),
  senha: z.string().min(1, 'Informe a senha do certificado'),
})
export type FormCertificadoFiscal = z.infer<typeof esquemaCertificadoFiscal>

/** Filtros da listagem de notas. */
export const esquemaFiltroNotas = z.object({
  de: z.string(),
  ate: z.string(),
  fornecedor: z.string(),
  cnpj: z.string(),
  numero: z.string(),
  chave: z.string(),
  status: z.string(),
})
export type FormFiltroNotas = z.infer<typeof esquemaFiltroNotas>

export const filtroVazio: FormFiltroNotas = {
  de: '',
  ate: '',
  fornecedor: '',
  cnpj: '',
  numero: '',
  chave: '',
  status: '',
}

/** Lê o .pfx escolhido no input file e devolve só o base64 (sem o prefixo data:). */
export function lerArquivoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => reject(new Error('Não foi possível ler o certificado'))
    leitor.readAsDataURL(arquivo)
  })
}

/** Chave de acesso em blocos de 4, como aparece no DANFE. */
export const formatarChave = (chave: string): string => (chave ?? '').replace(/(.{4})/g, '$1 ').trim()

/** NSU sem os zeros à esquerda (o leiaute usa 15 posições, mas na tela isso só atrapalha). */
export const nsuLegivel = (nsu?: string): string => {
  const so = somenteDigitos(nsu ?? '')
  return so ? String(Number(so)) : '—'
}

/** Quantos dias faltam para o certificado vencer (negativo = já venceu). */
export const diasAte = (data: Date): number => Math.ceil((data.getTime() - Date.now()) / 86_400_000)
