import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Lock, LockOpen, Printer, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { confirmar } from '../../components/Dialogo'
import { Alerta, Botao, Campo, Card, Input, Spinner } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { dataBr } from '../../lib/escritorio'
import { LINHAS_DRE, chamar, mensagem, type Demonstracoes, type LinhaDre } from '../../lib/contabil'

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

/** Balancete de verificação e DRE do período, calculados no backend a partir dos lançamentos. */
export function DemonstracoesTab() {
  const { empresa, membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const [periodo, setPeriodo] = useState(mesPassado)
  const [dados, setDados] = useState<Demonstracoes | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)

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
    void carregar()
  }, [carregar, empresa?.id])

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
                          <span className="text-slate-500">{l.codigo}</span> {l.nome}
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
              Os saldos saem na natureza de cada conta: valor positivo é o lado normal dela (devedor no ativo e nas despesas, credor no passivo e nas receitas); em vermelho, saldo invertido — costuma ser conta classificada errado na
              conciliação.
            </p>
          </Card>
        </>
      )}
    </>
  )
}
