import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { AlertTriangle, FileWarning, Receipt, Settings, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useColecao, useDocumento } from '../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Card, EstadoVazio, Spinner } from '../components/ui'
import { formatBRL, formatCpfCnpj, formatData } from '../lib/utils'
import { diasAte, nsuLegivel } from '../lib/fiscal'
import { TIPOS_GUIA, diasAteVencer } from '../lib/guias'
import {
  SITUACOES_SYNC_FISCAL,
  STATUS_NOTA_FISCAL,
  type ConfiguracaoFiscal,
  type Guia,
  type NotaFiscal,
} from '../types'

function Indicador({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string; tom?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{rotulo}</p>
      <p className={`text-xl font-semibold ${tom ?? 'text-slate-900'}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>}
    </div>
  )
}

export function Dashboard() {
  const { empresa } = useAuth()
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const { dados: notas, carregando } = useColecao<NotaFiscal>('notasFiscais', [orderBy('dataEmissao', 'desc'), limit(100)])

  const { dados: guias } = useColecao<Guia>('guias', [orderBy('criadoEm', 'desc'), limit(200)])
  // o que está para vencer (ou já venceu) e ainda não foi pago
  const guiasUrgentes = useMemo(
    () =>
      guias
        .filter((g) => g.status !== 'paga' && (diasAteVencer(g.vencimento) ?? 99) <= 7)
        .sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? '')),
    [guias],
  )

  const sync = config?.sincronizacao
  const validoAte = config?.certificado?.validoAte?.toDate?.()
  const diasRestantes = validoAte ? diasAte(validoAte) : null

  const resumo = useMemo(() => {
    const inicioDoMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const doMes = notas.filter((n) => {
      const d = n.dataEmissao?.toDate?.()
      return d ? d >= inicioDoMes : false
    })
    return {
      totalMes: doMes.filter((n) => n.status !== 'cancelada' && n.status !== 'denegada').reduce((s, n) => s + (n.valorTotal ?? 0), 0),
      quantidadeMes: doMes.length,
      semXml: notas.filter((n) => !n.xmlCompleto).length,
      ultimas: notas.slice(0, 5),
    }
  }, [notas])

  return (
    <>
      <CabecalhoPagina
        titulo={empresa?.nome ?? 'Painel'}
        descricao={empresa?.cnpj ? `CNPJ ${formatCpfCnpj(empresa.cnpj)}` : undefined}
        acoes={
          <Link to="/configuracoes">
            <Botao variante="secundario">
              <Settings className="h-4 w-4" /> Configurações
            </Botao>
          </Link>
        }
      />

      {!config?.certificado && (
        <div className="mb-4">
          <Alerta tipo="info">
            Para começar a receber as notas automaticamente, cadastre o certificado digital A1 em{' '}
            <Link to="/configuracoes" className="font-medium underline">
              Configurações
            </Link>
            .
          </Alerta>
        </div>
      )}

      {diasRestantes !== null && diasRestantes < 30 && (
        <div className="mb-4">
          <Alerta tipo="erro">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {diasRestantes < 0
                ? `Certificado digital vencido em ${formatData(config?.certificado?.validoAte)}. A sincronização está parada.`
                : `O certificado digital vence em ${diasRestantes} dia(s) (${formatData(config?.certificado?.validoAte)}).`}
            </span>
          </Alerta>
        </div>
      )}

      {guiasUrgentes.length > 0 && (
        <div className="mb-4">
          <Alerta tipo={guiasUrgentes.some((g) => (diasAteVencer(g.vencimento) ?? 0) < 0) ? 'erro' : 'info'}>
            <span className="font-medium">Guias para pagar: </span>
            {guiasUrgentes
              .slice(0, 4)
              .map((g) => {
                const d = diasAteVencer(g.vencimento) ?? 0
                return `${TIPOS_GUIA[g.tipo]} de ${formatBRL(g.valor ?? 0)} (${d < 0 ? `vencida há ${-d} dia(s)` : d === 0 ? 'vence hoje' : `vence em ${d} dia(s)`})`
              })
              .join(' · ')}
            {guiasUrgentes.length > 4 ? ` · e mais ${guiasUrgentes.length - 4}` : ''}.{' '}
            <Link to="/guias" className="font-medium underline">
              Ver guias
            </Link>
          </Alerta>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Notas no mês"
          valor={String(resumo.quantidadeMes)}
          detalhe={formatBRL(resumo.totalMes)}
        />
        <Indicador
          rotulo="Aguardando XML"
          valor={String(resumo.semXml)}
          detalhe="liberado após a manifestação"
          tom={resumo.semXml ? 'text-amber-700' : undefined}
        />
        <Indicador
          rotulo="Sincronização"
          valor={sync ? SITUACOES_SYNC_FISCAL[sync.status] : '—'}
          detalhe={sync?.ultimaSincronizacao ? formatData(sync.ultimaSincronizacao) : 'nunca executada'}
          tom={sync?.status === 'erro' ? 'text-red-700' : sync?.status === 'aguardando' ? 'text-emerald-700' : undefined}
        />
        <Indicador rotulo="Último NSU" valor={nsuLegivel(sync?.ultimoNsu)} detalhe={sync ? `maior na SEFAZ: ${nsuLegivel(sync.maxNsu)}` : undefined} />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Receipt className="h-4 w-4" /> Últimas notas recebidas
          </h2>
          <Link to="/notas-fiscais" className="text-sm font-medium text-indigo-600 hover:underline">
            ver todas
          </Link>
        </div>

        {carregando ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : resumo.ultimas.length === 0 ? (
          <EstadoVazio
            icone={<FileWarning className="h-10 w-10" />}
            titulo="Nenhuma nota ainda"
            descricao={
              config?.ativo
                ? 'A sincronização roda de hora em hora. Assim que a SEFAZ liberar documentos para este CNPJ, eles aparecem aqui.'
                : 'Cadastre o certificado e ative a integração para começar.'
            }
            acao={
              <Link to="/configuracoes">
                <Botao>
                  <ShieldCheck className="h-4 w-4" /> Configurar integração
                </Botao>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {resumo.ultimas.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{n.razaoSocialEmitente ?? 'Emitente não informado'}</p>
                  <p className="text-xs text-slate-500">
                    NF-e {n.numero ?? '—'} · {formatData(n.dataEmissao)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm whitespace-nowrap">{formatBRL(n.valorTotal)}</span>
                  <Badge tom={n.status === 'autorizada' ? 'verde' : n.status === 'resumo' ? 'amarelo' : 'vermelho'}>
                    {STATUS_NOTA_FISCAL[n.status]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
