import { useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { FileUp } from 'lucide-react'
import { functions } from '../lib/firebase'
import { Botao } from './ui'
import type { CadastroCnpj, Endereco } from '../types'

/** O que o backend lê do Comprovante de Inscrição e de Situação Cadastral */
export interface CartaoCnpj extends CadastroCnpj {
  cnpj: string
  matriz: boolean
  razaoSocial: string
  nomeFantasia?: string
  endereco: Endereco
  email?: string
  telefone?: string
}

function paraBase64(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader()
    leitor.onload = () => ok(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'))
    leitor.readAsDataURL(arquivo)
  })
}

/** Só o que o comprovante afirma sobre a empresa e que vale guardar no cadastro dela */
export function cadastroDoCartao(c: CartaoCnpj): CadastroCnpj {
  const { dataAbertura, porte, cnaePrincipal, cnaesSecundarios, naturezaJuridica, situacaoCadastral, dataSituacaoCadastral, emitidoEm } = c
  return JSON.parse(JSON.stringify({ dataAbertura, porte, cnaePrincipal, cnaesSecundarios, naturezaJuridica, situacaoCadastral, dataSituacaoCadastral, emitidoEm })) as CadastroCnpj
}

/**
 * Botão que recebe o PDF do cartão CNPJ e devolve os dados lidos. O PDF vai ao backend só para
 * ser lido; não fica guardado em lugar nenhum.
 */
export function CartaoCnpjUpload({ aoLer, aoErro, rotulo = 'Preencher com o cartão CNPJ (PDF)', variante = 'secundario' }: { aoLer: (c: CartaoCnpj) => void; aoErro: (mensagem: string | null) => void; rotulo?: string; variante?: 'primario' | 'secundario' }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [lendo, setLendo] = useState(false)

  async function aoEscolher(arquivo?: File) {
    if (!arquivo) return
    setLendo(true)
    aoErro(null)
    try {
      if (arquivo.size > 3 * 1024 * 1024) throw new Error('Arquivo grande demais: o comprovante do CNPJ tem uma página só.')
      const r = await httpsCallable<unknown, CartaoCnpj>(functions, 'lerCartaoCnpjDoPdf')({ conteudoBase64: await paraBase64(arquivo) })
      aoLer(r.data)
    } catch (e) {
      aoErro(e instanceof Error ? e.message : 'Não foi possível ler o comprovante.')
    } finally {
      setLendo(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  return (
    <>
      <input ref={entrada} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void aoEscolher(e.target.files?.[0])} />
      <Botao type="button" variante={variante} carregando={lendo} onClick={() => entrada.current?.click()}>
        <FileUp className="h-4 w-4" /> {rotulo}
      </Botao>
    </>
  )
}
