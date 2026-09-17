/**
 * Leitor de XML mínimo usado pela integração fiscal (SOAP da SEFAZ e documentos da NF-e).
 *
 * Não existe parser de XML no projeto e as respostas da SEFAZ são pequenas e bem definidas,
 * então lemos com um parser próprio em vez de trazer uma dependência nova.
 *
 * Decisões de segurança: DOCTYPE e entidades externas são ignorados (nada de XXE) e só as
 * cinco entidades XML padrão (mais &#nn;) são expandidas. Prefixos de namespace são
 * descartados na comparação de nomes, porque os documentos da NF-e ora vêm com prefixo,
 * ora sem (`soap:Envelope`, `Envelope`, `nfe:infNFe`...).
 */

export interface NoXml {
  /** Nome da tag já sem prefixo de namespace */
  nome: string
  atributos: Record<string, string>
  filhos: NoXml[]
  /** Texto imediato do elemento (concatenado, já com entidades expandidas) */
  texto: string
}

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function expandir(texto: string): string {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (inteiro, corpo: string) => {
    if (corpo.startsWith('#x') || corpo.startsWith('#X')) return String.fromCodePoint(parseInt(corpo.slice(2), 16))
    if (corpo.startsWith('#')) return String.fromCodePoint(Number(corpo.slice(1)))
    return ENTIDADES[corpo] ?? inteiro
  })
}

/** Remove o prefixo de namespace: 'soap:Envelope' -> 'envelope' (comparação sempre em minúsculas). */
const semPrefixo = (nome: string) => {
  const i = nome.indexOf(':')
  return (i >= 0 ? nome.slice(i + 1) : nome).toLowerCase()
}

function lerAtributos(bruto: string): Record<string, string> {
  const atributos: Record<string, string> = {}
  const re = /([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(bruto))) {
    atributos[semPrefixo(m[1])] = expandir(m[3] ?? m[4] ?? '')
  }
  return atributos
}

/**
 * Lê o XML inteiro e devolve o elemento raiz.
 * Lança erro se o documento estiver malformado a ponto de não ter raiz.
 */
export function analisarXml(xml: string): NoXml {
  const raiz: NoXml = { nome: '#documento', atributos: {}, filhos: [], texto: '' }
  const pilha: NoXml[] = [raiz]
  let i = 0

  while (i < xml.length) {
    const abre = xml.indexOf('<', i)
    if (abre < 0) break

    if (abre > i) {
      const bruto = xml.slice(i, abre)
      if (bruto.trim()) pilha[pilha.length - 1].texto += expandir(bruto)
    }

    // comentários, CDATA, declaração e DOCTYPE
    if (xml.startsWith('<!--', abre)) {
      const fim = xml.indexOf('-->', abre)
      i = fim < 0 ? xml.length : fim + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', abre)) {
      const fim = xml.indexOf(']]>', abre)
      const conteudo = xml.slice(abre + 9, fim < 0 ? xml.length : fim)
      pilha[pilha.length - 1].texto += conteudo
      i = fim < 0 ? xml.length : fim + 3
      continue
    }
    if (xml.startsWith('<?', abre)) {
      const fim = xml.indexOf('?>', abre)
      i = fim < 0 ? xml.length : fim + 2
      continue
    }
    if (xml.startsWith('<!', abre)) {
      // DOCTYPE e afins: pulamos o bloco inteiro, sem expandir entidade nenhuma
      let profundidade = 0
      let j = abre
      for (; j < xml.length; j++) {
        if (xml[j] === '<') profundidade++
        else if (xml[j] === '>') {
          profundidade--
          if (profundidade === 0) break
        }
      }
      i = j + 1
      continue
    }

    const fecha = xml.indexOf('>', abre)
    if (fecha < 0) break
    const corpo = xml.slice(abre + 1, fecha)

    if (corpo.startsWith('/')) {
      if (pilha.length > 1) pilha.pop()
      i = fecha + 1
      continue
    }

    const autoFechada = corpo.endsWith('/')
    const conteudo = autoFechada ? corpo.slice(0, -1) : corpo
    const espaco = conteudo.search(/[\s]/)
    const nome = semPrefixo(espaco < 0 ? conteudo : conteudo.slice(0, espaco))
    const no: NoXml = {
      nome,
      atributos: espaco < 0 ? {} : lerAtributos(conteudo.slice(espaco)),
      filhos: [],
      texto: '',
    }
    pilha[pilha.length - 1].filhos.push(no)
    if (!autoFechada) pilha.push(no)
    i = fecha + 1
  }

  const primeiro = raiz.filhos[0]
  if (!primeiro) throw new Error('XML sem elemento raiz')
  return primeiro
}

/** Primeiro filho com esse nome (sem prefixo, sem diferenciar maiúsculas). */
export function filho(no: NoXml | undefined, nome: string): NoXml | undefined {
  return no?.filhos.find((f) => f.nome === nome.toLowerCase())
}

/** Todos os filhos diretos com esse nome. */
export function filhos(no: NoXml | undefined, nome: string): NoXml[] {
  return no?.filhos.filter((f) => f.nome === nome.toLowerCase()) ?? []
}

/** Navega por um caminho de tags: caminho(raiz, 'body', 'retdistdfeint'). */
export function caminho(no: NoXml | undefined, ...nomes: string[]): NoXml | undefined {
  let atual = no
  for (const nome of nomes) atual = filho(atual, nome)
  return atual
}

/** Primeiro descendente (busca em profundidade) com esse nome — útil quando o SOAP muda de forma. */
export function descendente(no: NoXml | undefined, nome: string): NoXml | undefined {
  if (!no) return undefined
  const alvo = nome.toLowerCase()
  const fila: NoXml[] = [no]
  while (fila.length) {
    const atual = fila.shift()!
    if (atual.nome === alvo) return atual
    fila.push(...atual.filhos)
  }
  return undefined
}

/** Texto do descendente indicado, já sem espaços nas pontas. */
export function textoDe(no: NoXml | undefined, nome: string): string | undefined {
  const alvo = descendente(no, nome)
  const t = alvo?.texto.trim()
  return t ? t : undefined
}

/** Texto de um filho direto (evita pegar homônimo de outro nível, ex.: CNPJ de emit e de dest). */
export function textoFilho(no: NoXml | undefined, nome: string): string | undefined {
  const t = filho(no, nome)?.texto.trim()
  return t ? t : undefined
}

export function numeroFilho(no: NoXml | undefined, nome: string): number | undefined {
  const t = textoFilho(no, nome)
  if (t === undefined) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Escapa texto para montar XML de requisição. */
export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
