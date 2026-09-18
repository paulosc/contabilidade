/**
 * Leitor do "Comprovante de Inscrição e de Situação Cadastral" do CNPJ (o cartão CNPJ), emitido
 * pela Receita Federal — o PDF que todo cliente consegue tirar de graça no site da Receita.
 *
 * O texto do PDF vem como uma lista "RÓTULO" / "valor" em linhas alternadas. O leitor anda pelos
 * rótulos conhecidos e junta como valor tudo o que vier até o próximo rótulo (as atividades
 * secundárias ocupam várias linhas). Campo sem informação vem como asteriscos e sai vazio.
 *
 * É só leitura do que o documento afirma: nada aqui deduz regime tributário ou anexo do Simples a
 * partir do CNAE — essa decisão é de quem conhece a empresa.
 */

export class ErroCartaoCnpj extends Error {}

export interface Atividade {
  codigo: string
  descricao: string
}

export interface CartaoCnpj {
  /** 14 dígitos */
  cnpj: string
  matriz: boolean
  razaoSocial: string
  nomeFantasia?: string
  /** 'AAAA-MM-DD' */
  dataAbertura?: string
  porte?: string
  cnaePrincipal?: Atividade
  cnaesSecundarios: Atividade[]
  naturezaJuridica?: Atividade
  endereco: { logradouro?: string; numero?: string; complemento?: string; cep?: string; bairro?: string; cidade?: string; uf?: string }
  email?: string
  /** Só dígitos */
  telefone?: string
  situacaoCadastral?: string
  /** 'AAAA-MM-DD' */
  dataSituacaoCadastral?: string
  motivoSituacaoCadastral?: string
  situacaoEspecial?: string
  /** 'AAAA-MM-DD' — quando o comprovante foi emitido */
  emitidoEm?: string
}

const ROTULOS = {
  'NÚMERO DE INSCRIÇÃO': 'cnpj',
  'DATA DE ABERTURA': 'dataAbertura',
  'NOME EMPRESARIAL': 'razaoSocial',
  'TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)': 'nomeFantasia',
  PORTE: 'porte',
  'CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL': 'cnaePrincipal',
  'CÓDIGO E DESCRIÇÃO DAS ATIVIDADES ECONÔMICAS SECUNDÁRIAS': 'cnaesSecundarios',
  'CÓDIGO E DESCRIÇÃO DA NATUREZA JURÍDICA': 'naturezaJuridica',
  LOGRADOURO: 'logradouro',
  NÚMERO: 'numero',
  COMPLEMENTO: 'complemento',
  CEP: 'cep',
  'BAIRRO/DISTRITO': 'bairro',
  MUNICÍPIO: 'cidade',
  UF: 'uf',
  'ENDEREÇO ELETRÔNICO': 'email',
  TELEFONE: 'telefone',
  'ENTE FEDERATIVO RESPONSÁVEL (EFR)': 'efr',
  'SITUAÇÃO CADASTRAL': 'situacaoCadastral',
  'DATA DA SITUAÇÃO CADASTRAL': 'dataSituacaoCadastral',
  'MOTIVO DE SITUAÇÃO CADASTRAL': 'motivoSituacaoCadastral',
  'SITUAÇÃO ESPECIAL': 'situacaoEspecial',
  'DATA DA SITUAÇÃO ESPECIAL': 'dataSituacaoEspecial',
} as const
type Campo = (typeof ROTULOS)[keyof typeof ROTULOS]

/** Linhas que são título ou rodapé do formulário, não valor de campo */
const RUIDO = /^(REPÚBLICA FEDERATIVA DO BRASIL|CADASTRO NACIONAL DA PESSOA JURÍDICA|COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO|CADASTRAL|\(\*\) A dispensa|a Receita Federal qualquer|Aprovado pela Instrução Normativa|Emitido no dia|about:blank|Página:|\d+\/\d+$)/i

const rotuloDa = (linha: string): Campo | undefined => ROTULOS[linha.replace(/\s*\(\*\)\s*$/, '').trim().toUpperCase() as keyof typeof ROTULOS]
const vazio = (v: string) => !v || /^\*+$/.test(v) || /^-+$/.test(v)
const dataIso = (v?: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v ?? '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined
}

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const r = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0) % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

/** "62.02-3-00 - Desenvolvimento de programas (Dispensada *)" → código e descrição, sem a nota de dispensa */
function atividade(linha: string): Atividade | undefined {
  const m = /^(\d{2}\.\d{2}-\d-\d{2}|\d{3}-\d)\s*-\s*(.+)$/.exec(linha.trim())
  if (!m) return undefined
  return { codigo: m[1], descricao: m[2].replace(/\s*\(Dispensada \*\)\s*$/i, '').trim() }
}

export function lerCartaoCnpj(texto: string): CartaoCnpj {
  if (!/CADASTRO NACIONAL DA PESSOA JUR[IÍ]DICA/i.test(texto) || !/COMPROVANTE DE INSCRI[CÇ][AÃ]O/i.test(texto)) {
    throw new ErroCartaoCnpj('Este PDF não é o Comprovante de Inscrição e de Situação Cadastral do CNPJ. Emita-o no site da Receita Federal (Consulta CNPJ) e salve como PDF.')
  }

  const valores: Partial<Record<Campo, string[]>> = {}
  let atual: Campo | undefined
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha) continue
    const rotulo = rotuloDa(linha)
    if (rotulo) {
      atual = rotulo
      valores[atual] ??= []
      continue
    }
    if (RUIDO.test(linha)) {
      // "CADASTRAL" é a segunda linha do título; depois do rodapé não há mais campo
      if (/^\(\*\) A dispensa|^Aprovado pela|^Emitido no dia/i.test(linha)) atual = undefined
      continue
    }
    if (atual) valores[atual]!.push(linha)
  }

  const um = (c: Campo): string | undefined => {
    const v = (valores[c] ?? []).filter((x) => !vazio(x)).join(' ').replace(/\s+/g, ' ').trim()
    return v || undefined
  }

  const linhasDoCnpj = valores.cnpj ?? []
  const cnpj = (linhasDoCnpj.join(' ').match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] ?? texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] ?? '').replace(/\D/g, '')
  if (!cnpjValido(cnpj)) throw new ErroCartaoCnpj('Não encontrei um CNPJ válido neste comprovante.')
  const razaoSocial = um('razaoSocial')
  if (!razaoSocial) throw new ErroCartaoCnpj('Não encontrei o nome empresarial neste comprovante.')

  const uf = um('uf')?.toUpperCase()
  const email = um('email')?.toLowerCase()
  const telefone = um('telefone')?.split('/')[0].replace(/\D/g, '')
  const secundarias = (valores.cnaesSecundarios ?? []).map(atividade).filter((a): a is Atividade => Boolean(a))

  const limpo = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T
  return limpo({
    cnpj,
    matriz: !/FILIAL/i.test(linhasDoCnpj.join(' ')),
    razaoSocial,
    nomeFantasia: um('nomeFantasia'),
    dataAbertura: dataIso(um('dataAbertura')),
    porte: um('porte'),
    cnaePrincipal: atividade(um('cnaePrincipal') ?? ''),
    cnaesSecundarios: secundarias,
    naturezaJuridica: atividade(um('naturezaJuridica') ?? ''),
    endereco: limpo({
      logradouro: um('logradouro'),
      numero: um('numero'),
      complemento: um('complemento'),
      cep: um('cep')?.replace(/\D/g, ''),
      bairro: um('bairro'),
      cidade: um('cidade'),
      uf: uf && /^[A-Z]{2}$/.test(uf) ? uf : undefined,
    }),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    telefone: telefone && telefone.length >= 10 ? telefone : undefined,
    situacaoCadastral: um('situacaoCadastral'),
    dataSituacaoCadastral: dataIso(um('dataSituacaoCadastral')),
    motivoSituacaoCadastral: um('motivoSituacaoCadastral'),
    situacaoEspecial: um('situacaoEspecial'),
    emitidoEm: dataIso(/Emitido no dia (\d{2}\/\d{2}\/\d{4})/.exec(texto)?.[1]),
  })
}
