import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Check, ChevronLeft, ChevronRight, MinusCircle, RotateCcw } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta, Badge, Botao, CabecalhoPagina, Card, EstadoVazio, Input, Spinner } from '../../components/ui'
import { AREAS, SITUACOES, buscarCalendario, competenciaLegivel, dataBr, marcarObrigacao, mesAtual, mesLegivel, type Obrigacao } from '../../lib/escritorio'
import { PerfilFiscalCard } from './PerfilFiscalCard'

const deslocar = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')

function Linha({ o, aoMarcar }: { o: Obrigacao; aoMarcar: (o: Obrigacao, marcacao: 'feita' | 'dispensada' | null, observacao?: string) => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [aberta, setAberta] = useState(false)
  const resolvida = o.situacao === 'feita' || o.situacao === 'dispensada'
  const s = SITUACOES[o.situacao]

  async function marcar(marcacao: 'feita' | 'dispensada' | null) {
    setOcupado(true)
    try {
      await aoMarcar(o, marcacao, observacao)
      setObservacao('')
      setAberta(false)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <li className={`px-4 py-3 ${resolvida ? 'bg-slate-50/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={() => setAberta((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className={`font-medium ${resolvida ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-900'}`}>{o.nome}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>
              vence {diaDaSemana(o.vencimento)}, <strong className="text-slate-700">{dataBr(o.vencimento)}</strong>
            </span>
            <span>· ref. {competenciaLegivel(o.competencia)}</span>
            <span>· {AREAS[o.area]}</span>
            {o.tipo === 'interna' && <span>· rotina interna</span>}
          </p>
          {o.evidencia && !resolvida && <p className="mt-1 text-xs font-medium text-indigo-700">{o.evidencia}</p>}
          {resolvida && (
            <p className="mt-1 text-xs text-slate-500">
              {o.marcadaPor ? `${o.marcadaPor} · ` : ''}
              {o.marcadaEm ? new Date(o.marcadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
              {o.observacao ? ` — ${o.observacao}` : ''}
            </p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tom={s.tom}>{s.rotulo}</Badge>
          {resolvida ? (
            <Botao tamanho="sm" variante="fantasma" carregando={ocupado} onClick={() => void marcar(null)} title="Reabrir">
              <RotateCcw className="h-3.5 w-3.5" /> Reabrir
            </Botao>
          ) : (
            <Botao tamanho="sm" carregando={ocupado} onClick={() => void marcar('feita')}>
              <Check className="h-3.5 w-3.5" /> Feita
            </Botao>
          )}
        </div>
      </div>

      {aberta && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            <strong>Base:</strong> {o.base}
          </p>
          {!resolvida && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input className="h-8 max-w-md flex-1" placeholder="Observação (opcional): nº do recibo, motivo da dispensa…" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} />
              <Botao tamanho="sm" variante="secundario" carregando={ocupado} onClick={() => void marcar('dispensada')}>
                <MinusCircle className="h-3.5 w-3.5" /> Não se aplica neste mês
              </Botao>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Calendário de obrigações do cliente aberto: o que vence no mês, em ordem, com checklist. */
export function Obrigacoes() {
  const { empresa } = useAuth()
  const [mes, setMes] = useState(mesAtual())
  const [lista, setLista] = useState<Obrigacao[] | null>(null)
  const [temPerfil, setTemPerfil] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const r = await buscarCalendario(mes)
      setLista(r.obrigacoes)
      setTemPerfil(Boolean(r.perfil))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as obrigações.')
    } finally {
      setCarregando(false)
    }
  }, [mes])

  useEffect(() => {
    void carregar()
    // troca de empresa também recarrega
  }, [carregar, empresa?.id])

  async function aoMarcar(o: Obrigacao, marcacao: 'feita' | 'dispensada' | null, observacao?: string) {
    try {
      await marcarObrigacao(o, marcacao, observacao)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível marcar.')
    }
  }

  const abertas = (lista ?? []).filter((o) => o.situacao !== 'feita' && o.situacao !== 'dispensada')
  const atrasadas = abertas.filter((o) => o.situacao === 'atrasada').length

  return (
    <>
      <CabecalhoPagina
        titulo="Obrigações"
        descricao={`O que vence no mês para ${empresa?.nome ?? 'a empresa'}, com o prazo já ajustado para dia útil.`}
        acoes={
          <div className="flex items-center gap-1">
            <Botao variante="secundario" onClick={() => setMes((m) => deslocar(m, -1))} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Botao>
            <Input type="month" className="h-10 w-40" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
            <Botao variante="secundario" onClick={() => setMes((m) => deslocar(m, 1))} aria-label="Próximo mês">
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

      {carregando && !lista ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !temPerfil ? (
        <EstadoVazio icone={<CalendarCheck className="h-8 w-8" />} titulo="Cadastre o perfil fiscal" descricao="Com o regime e o que a empresa tem (empregados, pró-labore), o calendário mostra só o que se aplica a ela." />
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold">Vencimentos de {mesLegivel(mes)}</h2>
            <p className="text-sm text-slate-500">
              {abertas.length === 0 ? 'Tudo resolvido neste mês' : `${abertas.length} em aberto`}
              {atrasadas > 0 && <span className="font-medium text-red-700"> · {atrasadas} atrasada{atrasadas > 1 ? 's' : ''}</span>}
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {(lista ?? []).map((o) => (
              <Linha key={`${o.competencia}|${o.codigo}`} o={o} aoMarcar={aoMarcar} />
            ))}
          </ul>
          <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            Só entram prazos nacionais. ISS próprio, taxas e alvarás têm data municipal; feriado estadual ou municipal também pode mexer no prazo bancário. Clique numa obrigação para ver a base legal ou marcar
            como "não se aplica".
          </p>
        </Card>
      )}
    </>
  )
}
