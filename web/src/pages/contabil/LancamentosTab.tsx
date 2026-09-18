import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { orderBy, limit } from 'firebase/firestore'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useColecao } from '../../services/firestore'
import { confirmar } from '../../components/Dialogo'
import { Alerta, Badge, Botao, Campo, Card, EstadoVazio, Input, Select, Spinner } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { dataBr } from '../../lib/escritorio'
import { chamar, mensagem, valorDoTexto, type Conta, type Lancamento } from '../../lib/contabil'
import { SeletorDeConta } from './SeletorDeConta'

const esquema = z
  .object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data'),
    historico: z.string().trim().min(3, 'Descreva o lançamento').max(200),
    partidas: z
      .array(z.object({ conta: z.string().min(1, 'Escolha a conta'), lado: z.enum(['D', 'C']), valor: z.string().refine((v) => valorDoTexto(v) > 0, 'Valor') }))
      .min(2),
  })
  .superRefine((v, ctx) => {
    const soma = (lado: 'D' | 'C') => v.partidas.filter((p) => p.lado === lado).reduce((s, p) => s + Math.round(valorDoTexto(p.valor) * 100), 0)
    if (soma('D') !== soma('C')) ctx.addIssue({ code: 'custom', path: ['partidas'], message: `Débitos (${formatBRL(soma('D') / 100)}) e créditos (${formatBRL(soma('C') / 100)}) não fecham.` })
  })
type Form = z.infer<typeof esquema>

const hoje = () => new Date().toLocaleDateString('en-CA')
const emBranco = (): Form => ({ data: hoje(), historico: '', partidas: [{ conta: '', lado: 'D', valor: '' }, { conta: '', lado: 'C', valor: '' }] })

/** Lançamentos em partidas dobradas: o que o extrato não conta (provisões, depreciação, capital). */
export function LancamentosTab({ contas }: { contas: Conta[] }) {
  const lancamentos = useColecao<Lancamento>('lancamentos', [orderBy('data', 'desc'), limit(300)])
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const form = useForm<Form>({ resolver: zodResolver(esquema), defaultValues: emBranco() })
  const partidas = useFieldArray({ control: form.control, name: 'partidas' })
  const nomeDa = (codigo: string) => contas.find((c) => c.codigo === codigo)?.nome ?? codigo

  async function salvar(v: Form) {
    setOcupado('salvar')
    setErro(null)
    try {
      await chamar('lancarContabil', { data: v.data, historico: v.historico, partidas: v.partidas.map((p) => ({ conta: p.conta, [p.lado === 'D' ? 'debito' : 'credito']: valorDoTexto(p.valor) })) })
      form.reset({ ...emBranco(), data: v.data })
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível lançar.'))
    } finally {
      setOcupado(null)
    }
  }

  async function excluir(id: string, historico: string) {
    if (!(await confirmar(`Excluir o lançamento "${historico}"?`))) return
    setOcupado(id)
    setErro(null)
    try {
      await chamar('excluirLancamentoContabil', { lancamentoId: id })
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível excluir.'))
    } finally {
      setOcupado(null)
    }
  }

  const erroPartidas = form.formState.errors.partidas
  const textoErroPartidas = erroPartidas?.root?.message ?? (erroPartidas && 'message' in erroPartidas ? (erroPartidas.message as string) : undefined)

  return (
    <>
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold">Novo lançamento</h2>
        <form onSubmit={form.handleSubmit(salvar)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Campo label="Data" className="sm:col-span-2" erro={form.formState.errors.data?.message} obrigatorio>
            <Input type="date" {...form.register('data')} />
          </Campo>
          <Campo label="Histórico" className="sm:col-span-4" erro={form.formState.errors.historico?.message} obrigatorio>
            <Input placeholder="Provisão do Simples Nacional de agosto" {...form.register('historico')} />
          </Campo>

          <div className="space-y-2 sm:col-span-6">
            {partidas.fields.map((campo, i) => (
              <div key={campo.id} className="grid grid-cols-12 items-center gap-2">
                <Select className="col-span-3 sm:col-span-2" {...form.register(`partidas.${i}.lado`)}>
                  <option value="D">Débito</option>
                  <option value="C">Crédito</option>
                </Select>
                <SeletorDeConta className="col-span-9 sm:col-span-6" contas={contas} aria-invalid={Boolean(form.formState.errors.partidas?.[i]?.conta)} {...form.register(`partidas.${i}.conta`)} />
                <Input className="col-span-9 text-right sm:col-span-3" inputMode="decimal" placeholder="0,00" aria-invalid={Boolean(form.formState.errors.partidas?.[i]?.valor)} {...form.register(`partidas.${i}.valor`)} />
                <Botao type="button" tamanho="sm" variante="fantasma" className="col-span-3 sm:col-span-1" disabled={partidas.fields.length <= 2} onClick={() => partidas.remove(i)} aria-label="Remover partida">
                  <Trash2 className="h-3.5 w-3.5" />
                </Botao>
              </div>
            ))}
            {textoErroPartidas && <p className="text-xs text-red-600">{textoErroPartidas}</p>}
          </div>

          <div className="flex flex-wrap gap-2 sm:col-span-6">
            <Botao type="button" tamanho="sm" variante="secundario" onClick={() => partidas.append({ conta: '', lado: 'D', valor: '' })}>
              <Plus className="h-3.5 w-3.5" /> Mais uma partida
            </Botao>
            <Botao type="submit" tamanho="sm" carregando={ocupado === 'salvar'}>
              <Save className="h-3.5 w-3.5" /> Lançar
            </Botao>
          </div>
        </form>
      </Card>

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      <Card className="p-0">
        <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Últimos lançamentos</h2>
        {lancamentos.carregando ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : lancamentos.dados.length === 0 ? (
          <div className="p-6">
            <EstadoVazio titulo="Nenhum lançamento ainda" descricao="Eles nascem da conciliação do extrato ou do formulário acima." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lancamentos.dados.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {dataBr(l.data)} · {l.historico} {l.origem === 'extrato' && <Badge tom="azul">extrato</Badge>}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">{formatBRL(l.valor)}</span>
                    {l.origem === 'manual' && (
                      <Botao tamanho="sm" variante="fantasma" carregando={ocupado === l.id} onClick={() => void excluir(l.id, l.historico)} aria-label="Excluir lançamento">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Botao>
                    )}
                  </div>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {l.partidas.map((p, i) => (
                    <li key={i} className={p.credito ? 'pl-6' : ''}>
                      <span className="font-semibold">{p.debito ? 'D' : 'C'}</span> {p.conta} · {nomeDa(p.conta)} <span className="tabular-nums">— {formatBRL(p.debito ?? p.credito)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
