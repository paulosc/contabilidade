import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Lock, LockOpen, Printer, TriangleAlert, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { confirmar } from '../../components/Dialogo'
import { Alerta, Botao, Campo, Card, Input, Spinner } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { dataBr } from '../../lib/escritorio'
import { LINHAS_DRE, chamar, mensagem, type Demonstracoes, type LinhaBalancete, type LinhaDre, type Razao } from '../../lib/contabil'

const iso = (d: Date) => d.toLocaleDateString('en-CA')
const mesPassado = () => {
  const h = new Date()
  return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) }
}

function LinhaDaDre({ rotulo, valor, forte, subtrai, detalhe }: { rotulo: string; valor: number; forte?: boolean; subtrai?: boolean; detalhe?: Array<{ codigo: string; nome: string; valor: number }> }) {
  return (
    <>
      <tr className={forte ? 'bg-slate-50 font-semibold' : ''}>
        <td className="px-4 py-2">
          {subtrai ? '(−) ' : ''}
          {rotulo}
        </td>
        <td className={`px-4 py-2 text-right tabular-nums ${forte && valor < 0 ? 'text-red-700' : ''}`}>{formatBRL(valor)}</td>
      </tr>
      {detalhe?.map((c) => (
        <tr key={c.codigo} className="text-xs text-slate-500">
          <td className="py-1 pr-4 pl-10">
            {c.codigo} · {c.nome}
          </td>
          <td className="px-4 py-1 text-right tabular-nums">{formatBRL(c.valor)}</td>
        </tr>
      ))}
    </>
  )
}

function ColunaDoBalanco({ titulo, linhas, total, extra }: { titulo: string; linhas: LinhaBalancete[]; total: number; extra?: { rotulo: string; valor: number } }) {
  return (
    <div>
      <p className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">{titulo}</p>
      <ul className="text-sm">
        {linhas.map((l) => (
          <li key={l.codigo} className={`flex justify-between gap-3 py-1 pr-4 ${l.analitica ? '' : 'font-medium'}`} style={{ paddingLeft: `${1 + (l.nivel - 1) * 0.8}rem` }}>
            <span>{l.nome}</span>
            <span className={`tabular-nums ${l.saldoFinal < 0 ? 'text-red-700' : ''}`}>{formatBRL(l.saldoFinal)}</span>
          </li>
        ))}
        {extra && (
          <li className="flex justify-between gap-3 py-1 pr-4 pl-4 font-medium">
            <span>{extra.rotulo}</span>
            <span className={`tabular-nums ${extra.valor < 0 ? 'text-red-700' : ''}`}>{formatBRL(extra.valor)}</span>
          </li>
        )}
      </ul>
      <p className="mt-1 flex justify-between border-t border-slate-300 px-4 py-2 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatBRL(total)}</span>
      </p>
    </div>
  )
}

/** Balancete de verificação, DRE e balanço do período, calculados no backend a partir dos lançamentos. */
export function DemonstracoesTab() {
  const { empresa, membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const [periodo, setPeriodo] = useState(mesPassado)
  const [dados, setDados] = useState<Demonstracoes | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)
  const [razao, setRazao] = useState<Razao | null>(null)
  const [abrindoRazao, setAbrindoRazao] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!periodo.de || !periodo.ate) return
    setCarregando(true)
    setErro(null)
    try {
      setDados(await chamar<Demonstracoes>('demonstracoesContabeis', periodo))
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível montar as demonstrações.'))
    } finally {
      setCarregando(false)
    }
  }, [periodo])

  useEffect(() => {
    setRazao(null)
    void carregar()
  }, [carregar, empresa?.id])

  async function abrirRazao(conta: string) {
    setAbrindoRazao(conta)
    setErro(null)
    try {
      setRazao(await chamar<Razao>('razaoContabil', { conta, ...periodo }))
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível abrir o razão.'))
    } finally {
      setAbrindoRazao(null)
    }
  }

  async function encerrar(ate: string | null) {
    const pergunta = ate ? `Encerrar o período até ${dataBr(ate)}? Lançamentos até essa data não poderão mais ser criados, excluídos nem desfeitos.` : 'Reabrir o período? Os lançamentos voltam a poder ser alterados.'
    if (!(await confirmar(pergunta))) return
    setFechando(true)
    setErro(null)
    try {
      await chamar('fecharPeriodoContabil', { ate })
      await carregar()
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível alterar o período.'))
    } finally {
      setFechando(false)
    }
  }

  const b = dados?.balancete
  const d = dados?.dre
  const daLinha = (linha: LinhaDre) => d?.contas.filter((c) => c.linha === linha)
  const bp = dados?.balanco

  return (
    <>
      <Card className="mb-4 print:hidden">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-6">
          <Campo label="De" className="sm:col-span-2">
            <Input type="date" value={periodo.de} max={periodo.ate} onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))} />
          </Campo>
          <Campo label="Até" className="sm:col-span-2">
            <Input type="date" value={periodo.ate} min={periodo.de} onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))} />
          </Campo>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Botao variante="secundario" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimir
            </Botao>
            {ehAdmin &&
              (dados?.fechadoAte ? (
                <Botao variante="secundario" carregando={fechando} onClick={() => void encerrar(null)}>
                  <LockOpen className="h-4 w-4" /> Reabrir
                </Botao>
              ) : (
                <Botao variante="secundario" carregando={fechando} onClick={() => void encerrar(periodo.ate)}>
                  <Lock className="h-4 w-4" /> Encerrar até {dataBr(periodo.ate)}
                </Botao>
              ))}
          </div>
        </div>
        {dados?.fechadoAte && <p className="mt-2 text-xs font-medium text-slate-600">Período encerrado até {dataBr(dados.fechadoAte)}.</p>}
      </Card>

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {carregando && !dados ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !b || !d ? null : (
        <>
          <p className="mb-2 hidden text-sm print:block">
            {empresa?.nome} — {dataBr(periodo.de)} a {dataBr(periodo.ate)}
          </p>

          <Card className="mb-4 p-0">
            <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Demonstração do resultado (DRE)</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <LinhaDaDre rotulo={LINHAS_DRE.receita_bruta} valor={d.receitaBruta} detalhe={daLinha('receita_bruta')} />
                <LinhaDaDre rotulo={LINHAS_DRE.deducoes} valor={d.deducoes} subtrai detalhe={daLinha('deducoes')} />
                <LinhaDaDre rotulo="Receita líquida" valor={d.receitaLiquida} forte />
                <LinhaDaDre rotulo={LINHAS_DRE.custos} valor={d.custos} subtrai detalhe={daLinha('custos')} />
                <LinhaDaDre rotulo="Lucro bruto" valor={d.lucroBruto} forte />
                <LinhaDaDre rotulo={LINHAS_DRE.despesas_pessoal} valor={d.despesas.pessoal} subtrai detalhe={daLinha('despesas_pessoal')} />
                <LinhaDaDre rotulo={LINHAS_DRE.despesas_administrativas} valor={d.despesas.administrativas} subtrai detalhe={daLinha('despesas_administrativas')} />
                <LinhaDaDre rotulo={LINHAS_DRE.despesas_financeiras} valor={d.despesas.financeiras} subtrai detalhe={daLinha('despesas_financeiras')} />
                <LinhaDaDre rotulo={LINHAS_DRE.despesas_tributarias} valor={d.despesas.tributarias} subtrai detalhe={daLinha('despesas_tributarias')} />
                <LinhaDaDre rotulo={`(+) ${LINHAS_DRE.outras_receitas}`} valor={d.outrasReceitas} detalhe={daLinha('outras_receitas')} />
                <LinhaDaDre rotulo={d.resultado >= 0 ? 'Lucro do período' : 'Prejuízo do período'} valor={d.resultado} forte />
              </tbody>
            </table>
          </Card>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold">Balancete de verificação</h2>
              {b.linhas.length > 0 &&
                (b.fechamento.confere && b.totalDebitos === b.totalCreditos ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                    <CircleCheck className="h-4 w-4" /> Fecha: ativo {formatBRL(b.fechamento.ativo)} = passivo e PL {formatBRL(b.fechamento.passivoEPl)} + resultado {formatBRL(b.fechamento.resultado)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                    <TriangleAlert className="h-4 w-4" /> Não fecha — avise o suporte
                  </span>
                ))}
            </div>
            {b.linhas.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Nenhum lançamento até {dataBr(periodo.ate)}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Conta</th>
                      <th className="px-4 py-2 text-right font-medium">Saldo anterior</th>
                      <th className="px-4 py-2 text-right font-medium">Débitos</th>
                      <th className="px-4 py-2 text-right font-medium">Créditos</th>
                      <th className="px-4 py-2 text-right font-medium">Saldo final</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {b.linhas.map((l) => (
                      <tr key={l.codigo} className={l.analitica ? '' : 'bg-slate-50/70 font-medium'}>
                        <td className="py-1.5 pr-4" style={{ paddingLeft: `${1 + (l.nivel - 1) * 0.9}rem` }}>
                          {l.analitica ? (
                            <button type="button" className="text-left hover:underline disabled:opacity-60" disabled={abrindoRazao === l.codigo} onClick={() => void abrirRazao(l.codigo)} title="Ver o razão desta conta">
                              <span className="text-slate-500">{l.codigo}</span> {l.nome}
                            </button>
                          ) : (
                            <>
                              <span className="text-slate-500">{l.codigo}</span> {l.nome}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(l.saldoAnterior)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{l.debitos ? formatBRL(l.debitos) : '—'}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{l.creditos ? formatBRL(l.creditos) : '—'}</td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${l.saldoFinal < 0 ? 'text-red-700' : ''}`}>{formatBRL(l.saldoFinal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-300 font-semibold">
                      <td className="px-4 py-2">Total do período (contas analíticas)</td>
                      <td />
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(b.totalDebitos)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(b.totalCreditos)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              Clique numa conta para ver o razão dela. Os saldos saem na natureza de cada conta: valor positivo é o lado normal dela (devedor no ativo e nas despesas, credor no passivo e nas receitas); em vermelho, saldo invertido — costuma ser conta classificada errado na
              conciliação.
            </p>
          </Card>

          {razao && (
            <Card className="mt-4 p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <h2 className="text-base font-semibold">
                  Razão — {razao.conta} {razao.nome}
                </h2>
                <button type="button" onClick={() => setRazao(null)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 print:hidden" aria-label="Fechar o razão">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Data</th>
                      <th className="px-4 py-2 font-medium">Histórico</th>
                      <th className="px-4 py-2 text-right font-medium">Débito</th>
                      <th className="px-4 py-2 text-right font-medium">Crédito</th>
                      <th className="px-4 py-2 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="text-slate-500">
                      <td className="px-4 py-1.5" colSpan={4}>
                        Saldo anterior
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(razao.saldoAnterior)}</td>
                    </tr>
                    {razao.movimentos.map((m, i) => (
                      <tr key={i}>
                        <td className="px-4 py-1.5 whitespace-nowrap">{dataBr(m.data)}</td>
                        <td className="px-4 py-1.5">
                          {m.historico} <span className="text-xs text-slate-500">· {m.contrapartidas.join(', ')}</span>
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{m.debito ? formatBRL(m.debito) : '—'}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{m.credito ? formatBRL(m.credito) : '—'}</td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${m.saldo < 0 ? 'text-red-700' : ''}`}>{formatBRL(m.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-300 font-semibold">
                      <td className="px-4 py-2" colSpan={2}>
                        Total do período
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(razao.totalDebitos)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(razao.totalCreditos)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(razao.saldoFinal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          {bp && bp.totalAtivo + bp.totalPassivo + bp.totalPatrimonioLiquido !== 0 && (
            <Card className="mt-4 p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <h2 className="text-base font-semibold">Balanço patrimonial em {dataBr(bp.ate)}</h2>
                {!bp.confere && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                    <TriangleAlert className="h-4 w-4" /> Não fecha — avise o suporte
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0">
                <ColunaDoBalanco titulo="Ativo" linhas={bp.ativo.filter((l) => l.codigo !== '1')} total={bp.totalAtivo} />
                <div>
                  <ColunaDoBalanco titulo="Passivo" linhas={bp.passivo} total={bp.totalPassivo} />
                  <ColunaDoBalanco
                    titulo="Patrimônio líquido"
                    linhas={bp.patrimonioLiquido.filter((l) => l.codigo !== '2.3')}
                    total={bp.totalPatrimonioLiquido}
                    extra={{ rotulo: bp.resultadoAcumulado >= 0 ? 'Lucro acumulado ainda não transferido' : 'Prejuízo acumulado ainda não transferido', valor: bp.resultadoAcumulado }}
                  />
                </div>
              </div>
              <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                O resultado aparece dentro do patrimônio líquido como "ainda não transferido" porque o sistema não faz sozinho o lançamento de encerramento do exercício (zerar receitas e despesas contra Lucros acumulados). Faça-o em
                Lançamentos ao fechar o ano.
              </p>
            </Card>
          )}
        </>
      )}
    </>
  )
}
