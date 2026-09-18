import { Fragment, useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { Calculator, ChevronDown, ChevronUp, Download, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { functions } from '../../lib/firebase'
import { useColecao, useDocumento } from '../../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, EstadoVazio, Input, Select, Spinner } from '../../components/ui'
import { confirmar } from '../../components/Dialogo'
import { formatBRL } from '../../lib/utils'
import { TIPOS_TRABALHADOR, competenciaLegivel, paraCampo, paraNumero } from '../../lib/folha'
import { FuncionariosCard } from './FuncionariosCard'
import type { ComId, Folha as FolhaDoMes, Funcionario, Holerite, Rubrica } from '../../types'

type Msg = { tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null

const mesAtual = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

const esquemaLancamentos = z.object({
  itens: z
    .array(
      z.object({
        codigo: z.string().min(1, 'Escolha a rubrica'),
        referencia: z.string().max(20),
        valor: z.string().refine((v) => paraNumero(v) > 0, 'Valor'),
      }),
    )
    .min(1, 'Inclua ao menos um provento'),
})
type FormLancamentos = z.infer<typeof esquemaLancamentos>

function baixar(base64: string, nome: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
}

// ---------- holerite de um trabalhador, aberto na própria linha ----------

function DetalheHolerite({
  funcionario,
  holerite,
  rubricas,
  fechada,
  ocupado,
  aoCalcular,
  aoBaixar,
  aoRemover,
}: {
  funcionario: ComId<Funcionario>
  holerite?: ComId<Holerite>
  rubricas: ComId<Rubrica>[]
  fechada: boolean
  ocupado: string | null
  aoCalcular: (f: ComId<Funcionario>, itens: Array<{ codigo: string; valor: number; referencia?: string }>) => void
  aoBaixar: (f: ComId<Funcionario>) => void
  aoRemover: (f: ComId<Funcionario>) => void
}) {
  const iniciais = useMemo(
    () =>
      holerite
        ? holerite.lancamentos.map((l) => ({ codigo: l.codigo, referencia: l.referencia ?? '', valor: paraCampo(l.valor) }))
        : [{ codigo: funcionario.tipo === 'prolabore' ? '3508' : '1000', referencia: '30 dias', valor: paraCampo(funcionario.salarioBase) }],
    [holerite, funcionario],
  )
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormLancamentos>({ resolver: zodResolver(esquemaLancamentos), defaultValues: { itens: iniciais } })
  const { fields, append, remove } = useFieldArray({ control, name: 'itens' })
  useEffect(() => reset({ itens: iniciais }), [iniciais, reset])

  const r = holerite?.resultado
  const enviar = (v: FormLancamentos) => aoCalcular(funcionario, v.itens.map((i) => ({ codigo: i.codigo, valor: paraNumero(i.valor), referencia: i.referencia || undefined })))

  return (
    <div className="border-l-2 border-indigo-400 bg-slate-50/70 px-4 py-4">
      {r?.avisos?.length ? (
        <div className="mb-3">
          <Alerta tipo="info">{r.avisos.join(' ')}</Alerta>
        </div>
      ) : null}

      <form onSubmit={handleSubmit(enviar)}>
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Lançamentos do mês</p>
        <div className="flex flex-col gap-2">
          {fields.map((campo, i) => (
            <div key={campo.id} className="grid grid-cols-12 items-start gap-2">
              <div className="col-span-12 sm:col-span-6">
                <Select {...register(`itens.${i}.codigo`)} disabled={fechada}>
                  <option value="">Rubrica…</option>
                  {rubricas.map((rb) => (
                    <option key={rb.id} value={rb.codigo}>
                      {rb.codigo} — {rb.descricao} ({rb.tipo === 'provento' ? '+' : '−'})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-5 sm:col-span-2">
                <Input placeholder="Ref." {...register(`itens.${i}.referencia`)} disabled={fechada} />
              </div>
              <div className="col-span-5 sm:col-span-3">
                <Input inputMode="decimal" placeholder="0,00" className="text-right" {...register(`itens.${i}.valor`)} disabled={fechada} />
                {errors.itens?.[i]?.valor && <p className="mt-0.5 text-xs text-red-600">Informe o valor</p>}
              </div>
              <div className="col-span-2 sm:col-span-1">
                {!fechada && fields.length > 1 && (
                  <button type="button" onClick={() => remove(i)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600" title="Remover lançamento">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!fechada && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Botao type="button" tamanho="sm" variante="secundario" onClick={() => append({ codigo: '', referencia: '', valor: '' })}>
              <Plus className="h-3.5 w-3.5" /> Lançamento
            </Botao>
            <Botao type="submit" tamanho="sm" carregando={ocupado === `calc-${funcionario.id}`}>
              <Calculator className="h-3.5 w-3.5" /> {holerite ? 'Recalcular' : 'Calcular'}
            </Botao>
          </div>
        )}
      </form>

      {r && (
        <>
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Cód.</th>
                  <th className="px-3 py-2">Verba</th>
                  <th className="px-3 py-2 text-right">Ref.</th>
                  <th className="px-3 py-2 text-right">Proventos</th>
                  <th className="px-3 py-2 text-right">Descontos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.linhas.map((l, i) => (
                  <tr key={`${l.codigo}-${i}`}>
                    <td className="px-3 py-1.5 font-mono text-xs">{l.codigo}</td>
                    <td className="px-3 py-1.5">{l.descricao}</td>
                    <td className="px-3 py-1.5 text-right text-xs text-slate-500">{l.referencia ?? ''}</td>
                    <td className="px-3 py-1.5 text-right">{l.tipo === 'provento' ? formatBRL(l.valor) : ''}</td>
                    <td className="px-3 py-1.5 text-right">{l.tipo === 'desconto' ? formatBRL(l.valor) : ''}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="px-3 py-2" colSpan={3}>
                    Líquido a receber: {formatBRL(r.liquido)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatBRL(r.totalProventos)}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(r.totalDescontos)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500 uppercase">INSS</dt>
              <dd>
                {formatBRL(r.inss)} <span className="text-xs text-slate-500">sobre {formatBRL(r.baseInss)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 uppercase">IRRF</dt>
              <dd>
                {formatBRL(r.irrf.valor)} <span className="text-xs text-slate-500">base {formatBRL(r.irrf.base)}</span>
              </dd>
              <dd className="text-xs text-slate-500">
                {r.irrf.metodo === 'simplificado' ? 'desconto simplificado' : 'deduções legais'}
                {r.irrf.reducao > 0 ? ` · redução Lei 15.270: ${formatBRL(r.irrf.reducao)}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 uppercase">FGTS (empresa)</dt>
              <dd>
                {formatBRL(r.fgts)} <span className="text-xs text-slate-500">sobre {formatBRL(r.baseFgts)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 uppercase">Tabela aplicada</dt>
              <dd className="text-xs text-slate-600">{r.tabelas.inss}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <Botao tamanho="sm" carregando={ocupado === `pdf-${funcionario.id}`} onClick={() => aoBaixar(funcionario)}>
              <Download className="h-3.5 w-3.5" /> Baixar holerite
            </Botao>
            {!fechada && (
              <Botao tamanho="sm" variante="fantasma" carregando={ocupado === `remover-${funcionario.id}`} onClick={() => aoRemover(funcionario)}>
                <Trash2 className="h-3.5 w-3.5" /> Tirar desta folha
              </Botao>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- página ----------

export function Folha() {
  const { membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const [competencia, setCompetencia] = useState(mesAtual())
  const [expandido, setExpandido] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const { dados: funcionarios, carregando } = useColecao<Funcionario>('funcionarios')
  const { dados: rubricas } = useColecao<Rubrica>('rubricas')
  const { dados: holerites } = useColecao<Holerite>(`folhas/${competencia}/holerites`)
  const { dado: folha } = useDocumento<FolhaDoMes>('folhas', competencia)
  const fechada = folha?.status === 'fechada'

  // as rubricas padrão nascem no primeiro acesso do administrador
  useEffect(() => {
    if (ehAdmin && !carregando) void httpsCallable(functions, 'prepararFolha')({}).catch(() => undefined)
  }, [ehAdmin, carregando])

  const ordenados = useMemo(() => [...funcionarios].sort((a, b) => a.nome.localeCompare(b.nome)), [funcionarios])
  const rubricasOrdenadas = useMemo(() => [...rubricas].sort((a, b) => a.codigo.localeCompare(b.codigo)), [rubricas])
  const porFuncionario = useMemo(() => new Map(holerites.map((h) => [h.id, h])), [holerites])
  const naCompetencia = useMemo(
    () => ordenados.filter((f) => porFuncionario.has(f.id) || (f.ativo !== false && f.dataAdmissao <= `${competencia}-31` && (!f.dataDesligamento || f.dataDesligamento >= `${competencia}-01`))),
    [ordenados, porFuncionario, competencia],
  )

  async function chamar<T>(chave: string, funcao: string, dados: unknown): Promise<T | null> {
    setOcupado(chave)
    setMsg(null)
    try {
      return (await httpsCallable<unknown, T>(functions, funcao)(dados)).data
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'A operação falhou.' })
      return null
    } finally {
      setOcupado(null)
    }
  }

  async function calcularTudo() {
    const r = await chamar<{ calculados: number; erros: string[] }>('folha', 'calcularFolhaDoMes', { competencia })
    if (r) setMsg({ tipo: r.erros.length ? 'info' : 'sucesso', texto: `${r.calculados} holerite(s) calculado(s).${r.erros.length ? ` Pendências: ${r.erros.join(' · ')}` : ''}` })
  }

  const calcularUm = (f: ComId<Funcionario>, lancamentos: Array<{ codigo: string; valor: number; referencia?: string }>) =>
    void chamar(`calc-${f.id}`, 'calcularFolhaDoMes', { competencia, funcionarioId: f.id, lancamentos })

  async function baixarHolerite(f: ComId<Funcionario>) {
    const r = await chamar<{ pdfBase64: string; nomeArquivo: string }>(`pdf-${f.id}`, 'pdfHolerite', { competencia, funcionarioId: f.id })
    if (r) baixar(r.pdfBase64, r.nomeArquivo)
  }

  async function remover(f: ComId<Funcionario>) {
    if (await confirmar(`Tirar ${f.nome} da folha de ${competenciaLegivel(competencia)}?`, { titulo: 'Remover holerite', textoConfirmar: 'Remover', perigo: true })) {
      await chamar(`remover-${f.id}`, 'removerHoleriteDaFolha', { competencia, funcionarioId: f.id })
    }
  }

  async function alternarFechamento() {
    const ok = await confirmar(
      fechada
        ? `Reabrir a folha de ${competenciaLegivel(competencia)}? Os holerites voltam a poder ser recalculados.`
        : `Fechar a folha de ${competenciaLegivel(competencia)}? Depois de fechada ela não é recalculada, a não ser que seja reaberta.`,
      { titulo: fechada ? 'Reabrir folha' : 'Fechar folha', textoConfirmar: fechada ? 'Reabrir' : 'Fechar' },
    )
    if (ok) await chamar('fechar', 'fecharFolhaDoMes', { competencia, reabrir: fechada })
  }

  if (!ehAdmin) {
    return (
      <>
        <CabecalhoPagina titulo="Folha de pagamento" />
        <Alerta tipo="info">A folha traz CPF e salário dos trabalhadores, então só administradores da empresa têm acesso.</Alerta>
      </>
    )
  }

  const t = folha?.totais

  return (
    <>
      <CabecalhoPagina titulo="Folha de pagamento" descricao="INSS, IRRF e FGTS calculados pelas tabelas oficiais vigentes em cada competência." />

      {msg && (
        <div className="mb-4">
          <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
        </div>
      )}

      <div className="mb-4">
        <Alerta tipo="info">
          Esta versão calcula a <strong>folha mensal normal</strong> (salário, adicionais, horas extras, faltas, descontos e pró-labore). <strong>13º salário, férias, rescisão e PLR</strong>{' '}
          têm incidência e tabela próprias e ainda não são calculados aqui.
        </Alerta>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Campo label="Competência" className="w-44">
            <Input type="month" value={competencia} onChange={(e) => e.target.value && setCompetencia(e.target.value)} />
          </Campo>
          <Badge tom={fechada ? 'verde' : 'amarelo'}>{fechada ? 'Folha fechada' : 'Folha aberta'}</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            {!fechada && (
              <Botao tamanho="sm" carregando={ocupado === 'folha'} onClick={() => void calcularTudo()} disabled={naCompetencia.length === 0}>
                <Calculator className="h-3.5 w-3.5" /> Calcular a folha
              </Botao>
            )}
            <Botao tamanho="sm" variante="secundario" carregando={ocupado === 'fechar'} onClick={() => void alternarFechamento()} disabled={!fechada && holerites.length === 0}>
              {fechada ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {fechada ? 'Reabrir' : 'Fechar folha'}
            </Botao>
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          ['Holerites', String(t?.funcionarios ?? 0)],
          ['Proventos', formatBRL(t?.proventos ?? 0)],
          ['INSS retido', formatBRL(t?.inss ?? 0)],
          ['IRRF retido', formatBRL(t?.irrf ?? 0)],
          ['FGTS (empresa)', formatBRL(t?.fgts ?? 0)],
          ['Líquido a pagar', formatBRL(t?.liquido ?? 0)],
        ].map(([rotulo, valor]) => (
          <Card key={rotulo}>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{rotulo}</p>
            <p className="mt-1 text-lg font-semibold">{valor}</p>
          </Card>
        ))}
      </div>

      {carregando ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : naCompetencia.length === 0 ? (
        <div className="mb-4">
          <EstadoVazio titulo="Ninguém nesta competência" descricao="Cadastre os funcionários e sócios abaixo; eles aparecem aqui a partir do mês de admissão." />
        </div>
      ) : (
        <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Trabalhador</th>
                <th className="px-4 py-3">Vínculo</th>
                <th className="px-4 py-3 text-right">Proventos</th>
                <th className="px-4 py-3 text-right">Descontos</th>
                <th className="px-4 py-3 text-right">Líquido</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {naCompetencia.map((f) => {
                const h = porFuncionario.get(f.id)
                const aberto = expandido === f.id
                return (
                  <Fragment key={f.id}>
                    <tr className={`cursor-pointer ${aberto ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={() => setExpandido(aberto ? null : f.id)}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">{f.nome}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{f.cargo}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tom={f.tipo === 'prolabore' ? 'roxo' : 'neutro'}>{TIPOS_TRABALHADOR[f.tipo]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{h ? formatBRL(h.resultado.totalProventos) : '—'}</td>
                      <td className="px-4 py-3 text-right">{h ? formatBRL(h.resultado.totalDescontos) : '—'}</td>
                      <td className="px-4 py-3 text-right font-medium">{h ? formatBRL(h.resultado.liquido) : <span className="text-xs font-normal text-amber-700">a calcular</span>}</td>
                      <td className="px-4 py-3 text-right text-slate-400">{aberto ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />}</td>
                    </tr>
                    {aberto && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <DetalheHolerite
                            funcionario={f}
                            holerite={h}
                            rubricas={rubricasOrdenadas}
                            fechada={fechada}
                            ocupado={ocupado}
                            aoCalcular={calcularUm}
                            aoBaixar={(x) => void baixarHolerite(x)}
                            aoRemover={(x) => void remover(x)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <FuncionariosCard funcionarios={ordenados} />
    </>
  )
}
