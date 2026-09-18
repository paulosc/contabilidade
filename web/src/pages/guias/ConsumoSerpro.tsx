import { useMemo } from 'react'
import { limit, orderBy } from 'firebase/firestore'
import { Coins } from 'lucide-react'
import { useColecao } from '../../services/firestore'
import { formatBRL } from '../../lib/utils'
import { cicloDe, resumirPorCiclo, type TipoConsumo, type Uso } from '../../lib/serproConsumo'
import type { RegistroAuditoria } from '../../types'

/** Operações da auditoria que correspondem a uma requisição tarifada pelo Serpro. */
const TARIFADAS: Record<string, TipoConsumo> = {
  guia_gerada_receita: 'emissao',
  serpro_consulta: 'consulta',
}

const diaMes = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const nomeDoCiclo = (chave: string) => chave.replace(/^(\d{4})-(\d{2})$/, '$2/$1')

/**
 * Quanto já se gastou com o Serpro, pelo que o sistema registrou. Sai da auditoria — cada guia
 * emitida pela Receita já fica gravada lá — então não depende de nenhum contador à parte.
 */
export function ConsumoSerpro() {
  const { dados } = useColecao<RegistroAuditoria>('auditoriaFiscal', [orderBy('criadoEm', 'desc'), limit(1000)])

  const { ciclos, atual, total, requisicoes } = useMemo(() => {
    const usos: Uso[] = dados
      .filter((r) => TARIFADAS[r.operacao] && r.criadoEm?.toDate)
      .map((r) => ({ tipo: TARIFADAS[r.operacao], quando: r.criadoEm.toDate() }))
    const lista = resumirPorCiclo(usos)
    const chaveAtual = cicloDe(new Date()).chave
    return {
      ciclos: lista.slice(-6),
      atual: lista.find((c) => c.chave === chaveAtual),
      total: Math.round(lista.reduce((s, c) => s + c.total, 0) * 100) / 100,
      requisicoes: usos.length,
    }
  }, [dados])

  const cicloAtual = cicloDe(new Date())
  const maior = Math.max(0.01, ...ciclos.map((c) => c.total))

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800">
        <Coins className="h-4 w-4" /> Gasto com o Serpro
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500 uppercase">
            Ciclo atual · {diaMes(cicloAtual.inicio)} a {diaMes(cicloAtual.fim)}
          </p>
          <p className="mt-1 text-xl font-semibold">{formatBRL(atual?.total ?? 0)}</p>
          <p className="text-xs text-slate-500">
            {atual?.emissoes ?? 0} guia(s) emitida(s) · {atual?.consultas ?? 0} consulta(s)
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500 uppercase">Total desde a contratação</p>
          <p className="mt-1 text-xl font-semibold">{formatBRL(total)}</p>
          <p className="text-xs text-slate-500">{requisicoes} requisição(ões) tarifada(s)</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500 uppercase">Por ciclo de faturamento</p>
          {ciclos.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nenhuma requisição tarifada ainda.</p>
          ) : (
            <div className="mt-2 flex h-14 items-end gap-1.5">
              {ciclos.map((c) => (
                <div key={c.chave} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={`${nomeDoCiclo(c.chave)}: ${formatBRL(c.total)} — ${c.emissoes} emissão(ões), ${c.consultas} consulta(s)`}>
                  <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max(6, (c.total / maior) * 40)}px` }} />
                  <span className="text-[10px] text-slate-500">{nomeDoCiclo(c.chave).slice(0, 5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Estimativa pela tabela do contrato (emissão R$ 0,32 · consulta R$ 0,24 na 1ª faixa), contando o que foi pedido por este sistema. O valor oficial é o da fatura, na{' '}
        <a href="https://cliente.serpro.gov.br" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
          Área do Cliente do Serpro
        </a>
        ; o ciclo fecha todo dia 20.
      </p>
    </div>
  )
}
