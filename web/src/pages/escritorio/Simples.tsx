import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteField, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Calculator, Check, ChevronLeft, ChevronRight, Pencil, TriangleAlert, X } from 'lucide-react'
import { db } from '../../lib/firebase'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta, Badge, Botao, CabecalhoPagina, Card, EstadoVazio, Input, Spinner } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { buscarApuracao, dataBr, mesAtual, mesLegivel, numero, type ApuracaoDoPeriodo, type MesDaApuracao } from '../../lib/escritorio'
import { PerfilFiscalCard } from './PerfilFiscalCard'

const deslocar = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const pct = (v: number, casas = 2) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>}
    </Card>
  )
}

/** Célula de valor digitável: o número do sistema aparece por padrão; o lápis troca por um valor informado. */
function ValorEditavel({ sistema, manual, podeEditar, aoSalvar }: { sistema: number; manual: number | null; podeEditar: boolean; aoSalvar: (v: number | null) => Promise<void> }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function salvar(v: number | null) {
    setOcupado(true)
    try {
      await aoSalvar(v)
      setEditando(false)
    } finally {
      setOcupado(false)
    }
  }

  if (editando) {
    const valor = numero(texto)
    return (
      <span className="flex items-center justify-end gap-1">
        <Input autoFocus inputMode="decimal" className="h-7 w-28 px-2 text-right" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="0,00" />
        <button type="button" disabled={ocupado || !(valor >= 0) || texto.trim() === ''} onClick={() => void salvar(valor)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40" aria-label="Salvar">
          <Check className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setEditando(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Cancelar">
          <X className="h-4 w-4" />
        </button>
      </span>
    )
  }
  return (
    <span className="flex items-center justify-end gap-1.5">
      {manual !== null ? (
        <>
          <span className="font-medium text-slate-900">{formatBRL(manual)}</span>
          <Badge tom="roxo">digitado</Badge>
          {podeEditar && (
            <button type="button" onClick={() => void salvar(null)} className="text-xs text-slate-500 underline hover:text-slate-800" title={`Voltar ao valor do sistema (${formatBRL(sistema)})`}>
              desfazer
            </button>
          )}
        </>
      ) : (
        <span className={sistema ? 'text-slate-900' : 'text-slate-400'}>{formatBRL(sistema)}</span>
      )}
      {podeEditar && (
        <button
          type="button"
          onClick={() => {
            setTexto((manual ?? sistema).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
            setEditando(true)
          }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Informar outro valor"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  )
}

/**
 * Conferência do Simples Nacional: receita de 12 meses, Fator R, alíquota efetiva e DAS estimado,
 * lado a lado com o DAS oficial. A conta é do backend (functions/src/escritorio/simples.ts).
 */
export function Simples() {
  const { empresa, membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const [periodo, setPeriodo] = useState(deslocar(mesAtual(), -1))
  const [dados, setDados] = useState<ApuracaoDoPeriodo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setDados(await buscarApuracao(periodo))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível apurar.')
    } finally {
      setCarregando(false)
    }
  }, [periodo])

  useEffect(() => {
    void carregar()
  }, [carregar, empresa?.id])

  async function salvarManual(campo: 'receitasManuais' | 'folhasManuais', mes: string, valor: number | null) {
    if (!empresa) return
    try {
      await setDoc(doc(db, 'empresas', empresa.id, 'configuracoes', 'perfilFiscal'), { [campo]: { [mes]: valor === null ? deleteField() : valor }, atualizadoEm: serverTimestamp() }, { merge: true })
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o valor.')
    }
  }

  const a = dados?.apuracao
  const oficial = dados?.dasOficial
  const diferenca = a && oficial?.valor !== undefined ? Math.round((oficial.valor - a.dasEstimado) * 100) / 100 : null
  const usaFatorR = Boolean(dados?.perfil.sujeitoAoFatorR)
  const meses: MesDaApuracao[] = dados?.meses ?? []

  return (
    <>
      <CabecalhoPagina
        titulo="Simples Nacional"
        descricao="Conferência da apuração: receita de 12 meses, Fator R, alíquota efetiva e o DAS esperado, ao lado do DAS oficial."
        acoes={
          <div className="flex items-center gap-1">
            <Botao variante="secundario" onClick={() => setPeriodo((m) => deslocar(m, -1))} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Botao>
            <Input type="month" className="h-10 w-40" value={periodo} onChange={(e) => e.target.value && setPeriodo(e.target.value)} />
            <Botao variante="secundario" onClick={() => setPeriodo((m) => deslocar(m, 1))} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Botao>
          </div>
        }
      />

      <PerfilFiscalCard aoSalvar={() => void carregar()} />

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {carregando && !dados ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !dados ? null : (
        <>
          {dados.motivo && (
            <div className="mb-6">
              {dados.perfil.regime ? <Alerta tipo="info">{dados.motivo}</Alerta> : <EstadoVazio icone={<Calculator className="h-8 w-8" />} titulo="Cadastre o perfil fiscal" descricao={dados.motivo} />}
            </div>
          )}

          {a && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Indicador rotulo={`Receita de ${mesLegivel(periodo)}`} valor={formatBRL(a.receitaDoMes)} detalhe={`no ano: ${formatBRL(a.receitaNoAno)}`} />
                <Indicador
                  rotulo="Receita dos 12 meses anteriores (RBT12)"
                  valor={formatBRL(a.rbt12.paraTabela)}
                  detalhe={a.rbt12.proporcionalizado ? `proporcionalizada · auferido: ${formatBRL(a.rbt12.acumulado)}` : `${mesLegivel(deslocar(periodo, -12))} a ${mesLegivel(deslocar(periodo, -1))}`}
                />
                <Indicador rotulo={`Anexo ${a.anexoAplicado} · ${a.faixa}ª faixa`} valor={pct(a.aliquotaEfetiva, 4)} detalhe={`alíquota efetiva · nominal ${pct(a.aliquotaNominal)} − ${formatBRL(a.parcelaADeduzir)}`} />
                {a.fatorR ? (
                  <Indicador
                    rotulo="Fator R"
                    valor={a.fatorR.valor === null ? '—' : pct(a.fatorR.valor * 100)}
                    detalhe={`folha ${formatBRL(a.fatorR.folha12)} ÷ receita ${formatBRL(a.fatorR.receita12)} · mínimo 28%`}
                  />
                ) : (
                  <Indicador rotulo="Fator R" valor="não se aplica" detalhe="atividade não sujeita, conforme o perfil fiscal" />
                )}
              </div>

              <Card className="mb-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500">DAS esperado por esta conta</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{formatBRL(a.dasEstimado)}</p>
                    <p className="text-xs text-slate-500">
                      {formatBRL(a.receitaDoMes)} × {pct(a.aliquotaEfetiva, 4)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">DAS oficial da Receita</p>
                    {oficial ? (
                      <>
                        <p className="mt-1 text-2xl font-semibold text-slate-900">{formatBRL(oficial.valor)}</p>
                        <p className="text-xs text-slate-500">
                          vence em {dataBr(oficial.vencimento)} · {oficial.status === 'paga' ? 'pago' : 'em aberto'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-lg font-medium text-slate-400">ainda não está no sistema</p>
                        <Link to="/guias" className="text-xs font-medium text-indigo-700 underline">
                          Gerar pela Receita ou enviar o PDF em Guias a pagar
                        </Link>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Diferença</p>
                    {diferenca === null ? (
                      <p className="mt-1 text-lg font-medium text-slate-400">—</p>
                    ) : Math.abs(diferenca) <= 0.05 ? (
                      <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-emerald-700">
                        <Check className="h-5 w-5" /> Confere
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-amber-700">
                          <TriangleAlert className="h-5 w-5" /> {formatBRL(diferenca)}
                        </p>
                        <p className="text-xs text-slate-600">
                          {oficial?.vencimento && oficial.vencimento < new Date().toLocaleDateString('en-CA') ? 'A guia pode ter multa e juros por atraso. ' : ''}
                          Confira a receita de cada mês abaixo, ISS retido e se há mais de um anexo.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </Card>

              {a.alertas.length > 0 && (
                <div className="mb-4 space-y-2">
                  {a.alertas.map((x) => (
                    <div key={x.texto} className={`rounded-lg border px-4 py-3 text-sm ${x.nivel === 'critico' ? 'border-red-200 bg-red-50 text-red-800' : x.nivel === 'atencao' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
                      {x.texto}
                    </div>
                  ))}
                </div>
              )}

              <Card className="mb-4 p-0">
                <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Para onde vai o DAS</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Tributo</th>
                        <th className="px-4 py-2 text-right font-medium">% sobre a receita</th>
                        <th className="px-4 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {a.tributos.map((t) => (
                        <tr key={t.tributo}>
                          <td className="px-4 py-2">{t.tributo}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{pct(t.percentual, 4)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatBRL(t.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold">Receita e folha, mês a mês</h2>
              <p className="text-xs text-slate-500">
                A receita vem das NFS-e emitidas pela empresa (válidas, em produção){usaFatorR ? ' e a folha, do que foi calculado aqui (proventos + FGTS)' : ''}. Onde o sistema não tem o histórico — meses anteriores ao uso, vendas com
                NF-e, folha feita fora — {ehAdmin ? 'use o lápis para informar o valor.' : 'um administrador pode informar o valor.'}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Mês</th>
                    <th className="px-4 py-2 text-right font-medium">Notas</th>
                    <th className="px-4 py-2 text-right font-medium">Receita bruta</th>
                    {usaFatorR && <th className="px-4 py-2 text-right font-medium">Folha com encargos</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...meses].reverse().map((m) => (
                    <tr key={m.mes} className={m.mes === periodo ? 'bg-indigo-50/50' : ''}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {mesLegivel(m.mes)} {m.mes === periodo && <Badge tom="azul">apuração</Badge>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{m.notas || '—'}</td>
                      <td className="px-4 py-2 tabular-nums">
                        <ValorEditavel sistema={m.receitaNotas} manual={m.receitaManual} podeEditar={ehAdmin} aoSalvar={(v) => salvarManual('receitasManuais', m.mes, v)} />
                      </td>
                      {usaFatorR && (
                        <td className="px-4 py-2 tabular-nums">
                          <ValorEditavel sistema={m.folhaSistema} manual={m.folhaManual} podeEditar={ehAdmin} aoSalvar={(v) => salvarManual('folhasManuais', m.mes, v)} />
                          {m.folhaAberta && m.folhaManual === null && <p className="text-right text-xs text-amber-700">folha ainda aberta</p>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              Isto é conferência: o valor devido é sempre o do PGDAS-D. Esta conta não trata ISS retido pelo tomador, exportação, substituição tributária, regime de caixa nem receitas em mais de um anexo no mesmo mês. Tabelas:
              Anexos I a V da LC 123/2006 (redação da LC 155/2016).
            </p>
          </Card>
        </>
      )}
    </>
  )
}
