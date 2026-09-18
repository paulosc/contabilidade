import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BookOpen, Plus } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { useColecao } from '../../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, EstadoVazio, Input, Select, Spinner } from '../../components/ui'
import { LINHAS_DRE, chamar, mensagem, ordenarContas, type Conta } from '../../lib/contabil'
import { ExtratoTab } from './ExtratoTab'
import { LancamentosTab } from './LancamentosTab'
import { DemonstracoesTab } from './DemonstracoesTab'

const ABAS = { extrato: 'Extrato e conciliação', lancamentos: 'Lançamentos', demonstracoes: 'Balancete e DRE', plano: 'Plano de contas' } as const
type Aba = keyof typeof ABAS

const esquemaConta = z.object({
  codigo: z.string().trim().regex(/^[1-4](\.\d{1,2}){2,4}$/, 'Use o formato do plano: 4.2.2.11'),
  nome: z.string().trim().min(3, 'Informe o nome').max(80),
  dre: z.string(),
  disponivel: z.boolean(),
})
type FormConta = z.infer<typeof esquemaConta>

function PlanoTab({ contas }: { contas: Conta[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const form = useForm<FormConta>({ resolver: zodResolver(esquemaConta), defaultValues: { codigo: '', nome: '', dre: '', disponivel: false } })
  const codigo = form.watch('codigo')
  const deResultado = /^[34]/.test(codigo)
  const deDisponivel = codigo.startsWith('1.1.1.')

  async function criar(v: FormConta) {
    setSalvando(true)
    setErro(null)
    try {
      await chamar('criarContaContabil', v)
      form.reset({ codigo: '', nome: '', dre: v.dre, disponivel: false })
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível criar a conta.'))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Card className="mb-4">
        <h2 className="mb-1 text-base font-semibold">Nova conta</h2>
        <p className="mb-3 text-sm text-slate-500">A conta nova entra debaixo de um grupo que já existe. Ex.: outro banco é 1.1.1.04; uma despesa administrativa nova é 4.2.2.11.</p>
        {erro && (
          <div className="mb-3">
            <Alerta tipo="erro">{erro}</Alerta>
          </div>
        )}
        <form onSubmit={form.handleSubmit(criar)} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-6">
          <Campo label="Código" className="sm:col-span-1" erro={form.formState.errors.codigo?.message} obrigatorio>
            <Input placeholder="1.1.1.04" {...form.register('codigo')} />
          </Campo>
          <Campo label="Nome" className="sm:col-span-2" erro={form.formState.errors.nome?.message} obrigatorio>
            <Input placeholder="Banco Inter conta movimento" {...form.register('nome')} />
          </Campo>
          {deResultado && (
            <Campo label="Linha da DRE" className="sm:col-span-2">
              <Select {...form.register('dre')}>
                <option value="">Escolha…</option>
                {Object.entries(LINHAS_DRE).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
          )}
          {deDisponivel && (
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 sm:pt-8">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...form.register('disponivel')} /> É banco ou caixa (recebe extrato)
            </label>
          )}
          <div className="sm:col-span-1 sm:pt-7">
            <Botao type="submit" carregando={salvando}>
              <Plus className="h-4 w-4" /> Criar
            </Botao>
          </div>
        </form>
      </Card>

      <Card className="p-0">
        <ul className="divide-y divide-slate-100 text-sm">
          {contas.map((c) => (
            <li key={c.codigo} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 pr-4 ${c.analitica ? '' : 'bg-slate-50/70 font-medium'}`} style={{ paddingLeft: `${1 + (c.codigo.split('.').length - 1) * 0.9}rem` }}>
              <span>
                <span className="text-slate-500">{c.codigo}</span> {c.nome}
              </span>
              <span className="flex gap-1.5">
                {c.disponivel && <Badge tom="azul">banco/caixa</Badge>}
                {c.dre && <Badge>{LINHAS_DRE[c.dre]}</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

/** Contabilidade do cliente aberto: extrato → lançamentos → balancete e DRE. */
export function Contabilidade() {
  const { empresa } = useAuth()
  const contasSnap = useColecao<Conta>('contas')
  const contas = ordenarContas(contasSnap.dados)
  const [aba, setAba] = useState<Aba>('extrato')
  const [preparando, setPreparando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function preparar() {
    setPreparando(true)
    setErro(null)
    try {
      await chamar('prepararContabilidadeDaEmpresa')
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível criar o plano de contas.'))
    } finally {
      setPreparando(false)
    }
  }

  return (
    <>
      <div className="print:hidden">
        <CabecalhoPagina titulo="Contabilidade" descricao={`Do extrato do banco ao balancete de ${empresa?.nome ?? 'a empresa'}: importe o OFX, diga para onde foi cada valor e o resto sai sozinho.`} />
      </div>

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {contasSnap.carregando ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : contasSnap.erro ? (
        <Alerta tipo="erro">{contasSnap.erro}</Alerta>
      ) : contas.length === 0 ? (
        <EstadoVazio
          icone={<BookOpen className="h-8 w-8" />}
          titulo="Comece pelo plano de contas"
          descricao="Criamos um plano padrão para micro e pequena empresa (ativo, passivo, patrimônio líquido, receitas, custos e despesas). Depois você acrescenta as contas que faltarem."
          acao={
            <Botao carregando={preparando} onClick={() => void preparar()}>
              Criar o plano de contas padrão
            </Botao>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 print:hidden">
            {(Object.keys(ABAS) as Aba[]).map((a) => (
              <button key={a} type="button" onClick={() => setAba(a)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === a ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                {ABAS[a]}
              </button>
            ))}
          </div>
          {aba === 'extrato' && <ExtratoTab contas={contas} />}
          {aba === 'lancamentos' && <LancamentosTab contas={contas} />}
          {aba === 'demonstracoes' && <DemonstracoesTab />}
          {aba === 'plano' && <PlanoTab contas={contas} />}
        </>
      )}
    </>
  )
}
