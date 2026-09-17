import { clsx, type ClassValue } from 'clsx'
import { Timestamp } from 'firebase/firestore'

export const cn = (...inputs: ClassValue[]) => clsx(inputs)

export function formatBRL(valor?: number | null): string {
  if (valor == null || Number.isNaN(valor)) return '—'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatData(valor?: Date | Timestamp | null): string {
  if (!valor) return '—'
  const data = valor instanceof Timestamp ? valor.toDate() : valor
  return data.toLocaleDateString('pt-BR')
}

export const somenteDigitos = (s: string) => (s ?? '').replace(/\D/g, '')

export function formatCpfCnpj(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function formatTelefone(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11)
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  }
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export function formatCep(valor: string): string {
  return somenteDigitos(valor).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}

export function validarCpf(cpf: string): boolean {
  const d = somenteDigitos(cpf)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (tamanho: number) => {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export function validarCnpj(cnpj: string): boolean {
  const d = somenteDigitos(cnpj)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (tamanho: number) => {
    const pesos = tamanho === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export function validarCpfCnpj(valor: string): boolean {
  const d = somenteDigitos(valor)
  return d.length === 11 ? validarCpf(d) : validarCnpj(d)
}

/** Converte string de formulário ("1.500,00" ou "1500.00") em número ou undefined. */
export function paraNumero(valor?: string | number | null): number | undefined {
  if (valor == null || valor === '') return undefined
  if (typeof valor === 'number') return valor
  const normalizado = valor.replace(/\./g, '').replace(',', '.')
  const n = Number(normalizado)
  return Number.isNaN(n) ? undefined : n
}

export function traduzirErroAuth(codigo: string): string {
  switch (codigo) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou senha incorretos.'
    case 'auth/email-already-in-use':
      return 'Este e-mail já está cadastrado.'
    case 'auth/weak-password':
      return 'A senha deve ter pelo menos 6 caracteres.'
    case 'auth/invalid-email':
      return 'E-mail inválido.'
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
    case 'auth/network-request-failed':
      return 'Falha de conexão. Verifique sua internet.'
    case 'auth/operation-not-allowed':
      return 'Este método de login ainda não foi habilitado no Firebase Authentication.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'A janela de login foi fechada antes de concluir.'
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela de login. Permita pop-ups para este site.'
    case 'auth/account-exists-with-different-credential':
      return 'Já existe uma conta com este e-mail usando outro método de login.'
    case 'auth/unauthorized-domain':
      return 'Este domínio não está autorizado no Firebase Authentication.'
    default:
      return `Erro inesperado (${codigo}).`
  }
}
