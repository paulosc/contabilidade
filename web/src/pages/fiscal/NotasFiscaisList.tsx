import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { httpsCallable } from 'firebase/functions'
import { ChevronDown, ChevronUp, Download, Eraser, Receipt, RefreshCw, Settings } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useColecao, useDocumento } from '../../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, EstadoVazio, Input, Paginacao, Select, Spinner } from '../../components/ui'
import { formatBRL, formatCpfCnpj, formatData, somenteDigitos } from '../../lib/utils'
import { esquemaFiltroNotas, filtroVazio, formatarChave, nsuLegivel, resumoDaBusca, type FormFiltroNotas } from '../../lib/fiscal'
import {
  SITUACOES_SYNC_FISCAL,
  STATUS_NOTA_FISCAL,
  type ComId,
  type ConfiguracaoFiscal,
  type NotaFiscal,
  type StatusNotaFiscal,
} from '../../types'

const TOM_STATUS: Record<StatusNotaFiscal, 'neutro' | 'verde' | 'vermelho' | 'amarelo'> = {
  resumo: 'amarelo',
  autorizada: 'verde',
  cancelada: 'vermelho',
  denegada: 'vermelho',
}

/** Teto da assinatura em tempo real. Ao ser atingido, a tela avisa em vez de esconder. */
const TETO_LISTAGEM = 500

const inicioDoDia = (iso: string) => new Date(`${iso}T00:00:00`)
const fimDoDia = (iso: string) => new Date(`${iso}T23:59:59`)


/** Detalhe da NF-e, aberto dentro da própria linha da tabela. */
function DetalheNota({
  nota,
  ocupado,
  aoBaixarXml,
}: {
  nota: ComId<NotaFiscal>
  ocupado: string | null
  aoBaixarXml: (n: ComId<NotaFiscal>, caminho?: string) => void
}) {
  return (
    <div className="border-l-2 border-indigo-400 bg-slate-50/70 px-4 py-4">
      <p className="mb-3 font-mono text-xs break-all text-slate-500">{formatarChave(nota.chaveAcesso)}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500 uppercase">Emitente</dt><dd className="font-medium">{nota.razaoSocialEmitente ?? '—'}</dd><dd className="text-xs text-slate-500">{nota.cnpjEmitente ? formatCpfCnpj(nota.cnpjEmitente) : ''}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Destinatário</dt><dd className="font-medium">{nota.razaoSocialDestinatario ?? '—'}</dd><dd className="text-xs text-slate-500">{nota.cnpjDestinatario ? formatCpfCnpj(nota.cnpjDestinatario) : ''}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Emissão</dt><dd>{formatData(nota.dataEmissao)}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Valor</dt><dd className="font-medium">{formatBRL(nota.valorTotal)}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Protocolo</dt><dd className="font-mono text-xs">{nota.protocolo ?? '—'}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">NSU</dt><dd className="font-mono text-xs">{nsuLegivel(nota.nsu)}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Natureza</dt><dd>{nota.naturezaOperacao ?? '—'}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Importada em</dt><dd>{formatData(nota.importadoEm)}</dd></div>
        </dl>

        {nota.produtos?.length ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">NCM</th>
                  <th className="px-3 py-2">CFOP</th>
                  <th className="px-3 py-2">Un.</th>
                  <th className="px-3 py-2 text-right">Qtd.</th>
                  <th className="px-3 py-2 text-right">Vl. unit.</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nota.produtos.map((p, i) => (
                  <tr key={`${p.codigo ?? i}-${i}`}>
                    <td className="px-3 py-2 font-mono text-xs">{p.codigo ?? '—'}</td>
                    <td className="px-3 py-2">{p.descricao}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.ncm ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.cfop ?? '—'}</td>
                    <td className="px-3 py-2">{p.unidade ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{p.quantidade ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(p.valorUnitario)}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(p.valorTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            {nota.xmlCompleto
              ? 'Esta nota não trouxe itens.'
              : 'Só o resumo desta nota foi disponibilizado pela SEFAZ. O XML completo é liberado após a manifestação do destinatário.'}
          </p>
        )}

        {nota.eventos?.length ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-800">Eventos</p>
            <ul className="space-y-1 text-sm text-slate-600">
              {nota.eventos.map((e) => (
                <li key={`${e.tpEvento}-${e.nSeqEvento}`} className="flex flex-wrap items-center gap-2">
                  <Badge tom="azul">{e.tpEvento}</Badge>
                  <span>{e.descricao}</span>
                  <span className="text-xs text-slate-500">{formatData(e.dataEvento)}</span>
                  {e.storagePath && (
                    <button onClick={() => aoBaixarXml(nota, e.storagePath)} className="text-xs text-indigo-600 hover:underline">
                      baixar XML
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {nota.storagePath && (
          <div className="mt-4">
            <Botao tamanho="sm" variante="secundario" carregando={ocupado === `xml-${nota.id}`} onClick={() => aoBaixarXml(nota)}>
              <Download className="h-3.5 w-3.5" /> Baixar XML
            </Botao>
          </div>
        )}
    </div>
  )
}

export function NotasFiscaisList() {
  const { dados, carregando, erro } = useColecao<NotaFiscal>('notasFiscais', [orderBy('dataEmissao', 'desc'), limit(TETO_LISTAGEM)])
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const [expandida, setExpandida] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(50)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null)

  const form = useForm<FormFiltroNotas>({ resolver: zodResolver(esquemaFiltroNotas), defaultValues: filtroVazio })
  const filtro = form.watch()

  const filtradas = useMemo(() => {
    const fornecedor = filtro.fornecedor.trim().toLowerCase()
    const cnpj = somenteDigitos(filtro.cnpj)
    const numero = somenteDigitos(filtro.numero)
    const chave = somenteDigitos(filtro.chave)
    const de = filtro.de ? inicioDoDia(filtro.de) : null
    const ate = filtro.ate ? fimDoDia(filtro.ate) : null
    return dados.filter((n) => {
      const emissao = n.dataEmissao?.toDate?.()
      if (de && (!emissao || emissao < de)) return false
      if (ate && (!emissao || emissao > ate)) return false
      if (fornecedor && !(n.razaoSocialEmitente ?? '').toLowerCase().includes(fornecedor)) return false
      if (cnpj && !(n.cnpjEmitente ?? '').includes(cnpj)) return false
      if (numero && !(n.numero ?? '').includes(numero)) return false
      if (chave && !n.chaveAcesso.includes(chave)) return false
      if (filtro.status && n.status !== filtro.status) return false
      return true
    })
  }, [dados, filtro])

  // mudou o filtro: volta para a primeira página, senão a tela fica num trecho que sumiu
  useEffect(() => {
    setPagina(1)
  }, [dados, filtro])

  const daPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
  )

  const totais = useMemo(
    () => ({
      quantidade: filtradas.length,
      valor: filtradas.filter((n) => n.status !== 'cancelada' && n.status !== 'denegada').reduce((s, n) => s + (n.valorTotal ?? 0), 0),
      semXml: filtradas.filter((n) => !n.xmlCompleto).length,
    }),
    [filtradas],
  )

  async function sincronizar() {
    setOcupado('sincronizar')
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, { executou: boolean; motivo?: string; documentosProcessados: number; notasNovas: number; notasAtualizadas: number; mensagemRetorno?: string }>(
        functions,
        'sincronizarFiscalAgora',
      )({})
      setMsg(
        r.data.executou
          ? { tipo: 'sucesso', texto: `${resumoDaBusca(r.data)}${r.data.mensagemRetorno ? ` ${r.data.mensagemRetorno}` : ''}` }
          : { tipo: 'info', texto: r.data.motivo ?? 'Sincronização não executada.' },
      )
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao sincronizar.' })
    } finally {
      setOcupado(null)
    }
  }

  async function baixarXml(nota: ComId<NotaFiscal>, storagePath?: string) {
    setOcupado(`xml-${nota.id}`)
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, { xml: string; nomeArquivo: string }>(functions, 'xmlNotaFiscal')({
        chaveAcesso: nota.chaveAcesso,
        storagePath,
      })
      const url = URL.createObjectURL(new Blob([r.data.xml], { type: 'application/xml' }))
      const link = document.createElement('a')
      link.href = url
      link.download = r.data.nomeArquivo
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível baixar o XML.' })
    } finally {
      setOcupado(null)
    }
  }

  const sync = config?.sincronizacao

  return (
    <>
      <CabecalhoPagina
        titulo="Notas fiscais"
        descricao="Documentos fiscais eletrônicos emitidos para o CNPJ da empresa, buscados automaticamente no Ambiente Nacional da NF-e."
        acoes={
          <>
            <Botao variante="secundario" carregando={ocupado === 'sincronizar'} onClick={() => void sincronizar()}>
              <RefreshCw className="h-4 w-4" /> Sincronizar agora
            </Botao>
            <Link to="/configuracoes">
              <Botao variante="secundario">
                <Settings className="h-4 w-4" /> Configuração fiscal
              </Botao>
            </Link>
          </>
        }
      />

      {msg && (
        <div className="mb-4">
          <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
        </div>
      )}
      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {!config?.certificado && (
        <div className="mb-4">
          <Alerta tipo="info">
            Nenhum certificado digital cadastrado.{' '}
            <Link to="/configuracoes" className="font-medium underline">
              Configure a integração fiscal
            </Link>{' '}
            para começar a receber as notas automaticamente.
          </Alerta>
        </div>
      )}

      {dados.length >= TETO_LISTAGEM && (
        <div className="mb-4">
          <Alerta tipo="info">
            Esta tela acompanha as {TETO_LISTAGEM} notas fiscais mais recentes. Use o filtro de período para
            alcançar as anteriores.
          </Alerta>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase">Notas</p>
          <p className="text-xl font-semibold">{totais.quantidade}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase">Valor</p>
          <p className="text-xl font-semibold">{formatBRL(totais.valor)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-700 uppercase">Sem XML completo</p>
          <p className="text-xl font-semibold text-amber-800">{totais.semXml}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase">Sincronização</p>
          <p className="text-sm font-semibold">{sync ? SITUACOES_SYNC_FISCAL[sync.status] : '—'}</p>
          <p className="text-xs text-slate-500">
            {sync?.ultimaSincronizacao ? formatData(sync.ultimaSincronizacao) : 'nunca'} · NSU {nsuLegivel(sync?.ultimoNsu)}
          </p>
        </div>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Campo label="De"><Input type="date" {...form.register('de')} /></Campo>
          <Campo label="Até"><Input type="date" {...form.register('ate')} /></Campo>
          <Campo label="Fornecedor"><Input placeholder="Razão social" {...form.register('fornecedor')} /></Campo>
          <Campo label="CNPJ do emitente"><Input placeholder="00.000.000/0001-00" {...form.register('cnpj')} /></Campo>
          <Campo label="Número"><Input inputMode="numeric" {...form.register('numero')} /></Campo>
          <Campo label="Chave de acesso"><Input placeholder="44 dígitos" {...form.register('chave')} /></Campo>
          <Campo label="Status">
            <Select {...form.register('status')}>
              <option value="">Todos</option>
              {Object.entries(STATUS_NOTA_FISCAL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Campo>
        </div>
        <div className="mt-3">
          <Botao tamanho="sm" variante="fantasma" onClick={() => form.reset(filtroVazio)}>
            <Eraser className="h-3.5 w-3.5" /> Limpar filtros
          </Botao>
        </div>
      </Card>

      {carregando ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : dados.length === 0 ? (
        config?.ativo && config.certificado ? (
          <EstadoVazio
            icone={<Receipt className="h-10 w-10" />}
            titulo="Nenhuma NF-e recebida"
            descricao="A busca automática está ligada e em dia, mas nenhum fornecedor emitiu NF-e (nota de mercadoria) para este CNPJ. A SEFAZ só entrega as notas dos últimos 90 dias. Notas de serviço (NFS-e) ficam em Notas de serviço."
          />
        ) : (
          <EstadoVazio
            icone={<Receipt className="h-10 w-10" />}
            titulo="Nenhuma nota fiscal ainda"
            descricao="Assim que o certificado estiver ativo, a sincronização automática traz aqui as notas emitidas para o CNPJ da empresa."
            acao={
              <Link to="/configuracoes">
                <Botao><Settings className="h-4 w-4" /> Configurar integração</Botao>
              </Link>
            }
          />
        )
      ) : filtradas.length === 0 ? (
        <EstadoVazio titulo="Nenhum resultado" descricao="Ajuste os filtros." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Número / série</th>
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Emissão</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {daPagina.map((n) => {
                const aberta = expandida === n.id
                return (
                  <Fragment key={n.id}>
                    <tr
                      className={`cursor-pointer ${aberta ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
                      onClick={() => setExpandida(aberta ? null : n.id)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {n.numero ?? '—'}
                        <span className="text-slate-400"> / {n.serie ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{n.razaoSocialEmitente ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{n.cnpjEmitente ? formatCpfCnpj(n.cnpjEmitente) : '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{formatData(n.dataEmissao)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{formatBRL(n.valorTotal)}</td>
                      <td className="px-4 py-3">
                        <Badge tom={TOM_STATUS[n.status]}>{STATUS_NOTA_FISCAL[n.status]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {n.storagePath && (
                            <button
                              onClick={(e) => { e.stopPropagation(); void baixarXml(n) }}
                              disabled={ocupado === `xml-${n.id}`}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                              title="Baixar XML"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          )}
                          <span className="rounded-lg p-1.5 text-slate-400" title={aberta ? 'Fechar detalhes' : 'Ver detalhes'} aria-hidden>
                            {aberta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <DetalheNota nota={n} ocupado={ocupado} aoBaixarXml={(x, caminho) => void baixarXml(x, caminho)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <Paginacao
            pagina={pagina}
            porPagina={porPagina}
            total={filtradas.length}
            aoMudarPagina={setPagina}
            aoMudarPorPagina={setPorPagina}
          />
        </div>
      )}
    </>
  )
}
