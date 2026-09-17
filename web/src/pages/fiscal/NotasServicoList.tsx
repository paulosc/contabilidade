import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { httpsCallable } from 'firebase/functions'
import { Download, Eraser, FileDown, FileText, Receipt, RefreshCw, Settings, X } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useColecao, useDocumento } from '../../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, EstadoVazio, Input, Paginacao, Select, Spinner } from '../../components/ui'
import { formatBRL, formatCpfCnpj, formatData, somenteDigitos } from '../../lib/utils'
import { esquemaFiltroNotas, filtroVazio, formatarChave, nsuLegivel, resumoDaBusca, type FormFiltroNotas } from '../../lib/fiscal'
import {
  PAPEIS_NOTA_SERVICO,
  SITUACOES_SYNC_FISCAL,
  STATUS_NOTA_SERVICO,
  type ComId,
  type ConfiguracaoFiscal,
  type NotaServico,
} from '../../types'

/** Teto da assinatura em tempo real. Ao ser atingido, a tela avisa em vez de esconder. */
const TETO_LISTAGEM = 500

const inicioDoDia = (iso: string) => new Date(`${iso}T00:00:00`)
const fimDoDia = (iso: string) => new Date(`${iso}T23:59:59`)

export function NotasServicoList() {
  const { dados, carregando, erro } = useColecao<NotaServico>('notasServico', [orderBy('dataEmissao', 'desc'), limit(TETO_LISTAGEM)])
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const [selecionada, setSelecionada] = useState<ComId<NotaServico> | null>(null)
  const [papel, setPapel] = useState('')
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(50)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null)

  const form = useForm<FormFiltroNotas>({ resolver: zodResolver(esquemaFiltroNotas), defaultValues: filtroVazio })
  const filtro = form.watch()

  const filtradas = useMemo(() => {
    const parte = filtro.fornecedor.trim().toLowerCase()
    const cnpj = somenteDigitos(filtro.cnpj)
    const numero = somenteDigitos(filtro.numero)
    const chave = somenteDigitos(filtro.chave)
    const de = filtro.de ? inicioDoDia(filtro.de) : null
    const ate = filtro.ate ? fimDoDia(filtro.ate) : null
    return dados.filter((n) => {
      const emissao = n.dataEmissao?.toDate?.()
      if (de && (!emissao || emissao < de)) return false
      if (ate && (!emissao || emissao > ate)) return false
      if (parte && !`${n.razaoSocialTomador ?? ''} ${n.razaoSocialPrestador ?? ''}`.toLowerCase().includes(parte)) return false
      if (cnpj && !`${n.cnpjTomador ?? ''}${n.cnpjPrestador ?? ''}`.includes(cnpj)) return false
      if (numero && !(n.numero ?? '').includes(numero)) return false
      if (chave && !n.chaveAcesso.includes(chave)) return false
      if (filtro.status && n.status !== filtro.status) return false
      if (papel && n.papel !== papel) return false
      return true
    })
  }, [dados, filtro, papel])

  // mudou o filtro: volta para a primeira página, senão a tela fica num trecho que sumiu
  useEffect(() => {
    setPagina(1)
  }, [dados, filtro, papel])

  const daPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
  )

  const totais = useMemo(() => {
    const validas = filtradas.filter((n) => n.status !== 'cancelada')
    return {
      quantidade: filtradas.length,
      emitidas: validas.filter((n) => n.papel === 'prestador').reduce((s, n) => s + (n.valorServico ?? 0), 0),
      recebidas: validas.filter((n) => n.papel === 'tomador').reduce((s, n) => s + (n.valorServico ?? 0), 0),
      iss: validas.filter((n) => n.papel === 'prestador').reduce((s, n) => s + (n.valorIss ?? 0), 0),
    }
  }, [filtradas])

  async function sincronizar() {
    setOcupado('sincronizar')
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, { executou: boolean; motivo?: string; documentosProcessados: number; notasNovas: number; notasAtualizadas: number; mensagemRetorno?: string }>(
        functions,
        'sincronizarNfseAgora',
      )({})
      setMsg(
        r.data.executou
          ? { tipo: 'sucesso', texto: `${resumoDaBusca(r.data)}${r.data.mensagemRetorno ? ` ${r.data.mensagemRetorno}` : ''}` }
          : { tipo: 'info', texto: r.data.motivo ?? 'Busca não executada.' },
      )
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao buscar.' })
    } finally {
      setOcupado(null)
    }
  }

  async function baixarPdf(nota: ComId<NotaServico>) {
    setOcupado(`pdf-${nota.id}`)
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, { pdfBase64: string; nomeArquivo: string }>(functions, 'pdfNotaServico')({
        chaveAcesso: nota.chaveAcesso,
      })
      const bytes = Uint8Array.from(atob(r.data.pdfBase64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = r.data.nomeArquivo
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível gerar o PDF.' })
    } finally {
      setOcupado(null)
    }
  }

  async function baixarXml(nota: ComId<NotaServico>, storagePath?: string) {
    setOcupado(`xml-${nota.id}`)
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, { xml: string; nomeArquivo: string }>(functions, 'xmlNotaServico')({
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

  const sync = config?.sincronizacaoNfse

  return (
    <>
      <CabecalhoPagina
        titulo="Notas de serviço"
        descricao="NFS-e do padrão nacional em que a empresa é prestadora ou tomadora, buscadas no Ambiente de Dados Nacional."
        acoes={
          <>
            <Botao variante="secundario" carregando={ocupado === 'sincronizar'} onClick={() => void sincronizar()}>
              <RefreshCw className="h-4 w-4" /> Buscar agora
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

      {!config?.nfseAtivo && (
        <div className="mb-4">
          <Alerta tipo="info">
            A busca de NFS-e ainda não foi ativada.{' '}
            <Link to="/configuracoes" className="font-medium underline">
              Ative em Configurações
            </Link>{' '}
            para começar a receber as notas de serviço automaticamente.
          </Alerta>
        </div>
      )}

      {dados.length >= TETO_LISTAGEM && (
        <div className="mb-4">
          <Alerta tipo="info">
            Esta tela acompanha as {TETO_LISTAGEM} notas de serviço mais recentes. Use o filtro de período para
            alcançar as anteriores.
          </Alerta>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase">Notas</p>
          <p className="text-xl font-semibold">{totais.quantidade}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-700 uppercase">Emitidas (receita)</p>
          <p className="text-xl font-semibold text-emerald-800">{formatBRL(totais.emitidas)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase">Recebidas (despesa)</p>
          <p className="text-xl font-semibold">{formatBRL(totais.recebidas)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase">ISS das emitidas</p>
          <p className="text-xl font-semibold">{formatBRL(totais.iss)}</p>
          <p className="text-xs text-slate-500">
            {sync ? SITUACOES_SYNC_FISCAL[sync.status] : '—'} · NSU {nsuLegivel(sync?.ultimoNsu)}
          </p>
        </div>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Campo label="De"><Input type="date" {...form.register('de')} /></Campo>
          <Campo label="Até"><Input type="date" {...form.register('ate')} /></Campo>
          <Campo label="Prestador ou tomador"><Input placeholder="Razão social" {...form.register('fornecedor')} /></Campo>
          <Campo label="CNPJ / CPF"><Input placeholder="00.000.000/0001-00" {...form.register('cnpj')} /></Campo>
          <Campo label="Número"><Input inputMode="numeric" {...form.register('numero')} /></Campo>
          <Campo label="Tipo">
            <Select value={papel} onChange={(e) => setPapel(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(PAPEIS_NOTA_SERVICO).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Status">
            <Select {...form.register('status')}>
              <option value="">Todos</option>
              {Object.entries(STATUS_NOTA_SERVICO).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Campo>
        </div>
        <div className="mt-3">
          <Botao tamanho="sm" variante="fantasma" onClick={() => { form.reset(filtroVazio); setPapel('') }}>
            <Eraser className="h-3.5 w-3.5" /> Limpar filtros
          </Botao>
        </div>
      </Card>

      {selecionada && (
        <Card className="mb-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                NFS-e {selecionada.numero ?? '—'}
                {selecionada.numeroDps ? ` · DPS ${selecionada.numeroDps}/${selecionada.serieDps ?? ''}` : ''}
              </h2>
              <p className="font-mono text-xs break-all text-slate-500">{formatarChave(selecionada.chaveAcesso)}</p>
            </div>
            <button onClick={() => setSelecionada(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Fechar detalhe">
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500 uppercase">Prestador</dt><dd className="font-medium">{selecionada.razaoSocialPrestador ?? '—'}</dd><dd className="text-xs text-slate-500">{selecionada.cnpjPrestador ? formatCpfCnpj(selecionada.cnpjPrestador) : ''}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">Tomador</dt><dd className="font-medium">{selecionada.razaoSocialTomador ?? '—'}</dd><dd className="text-xs text-slate-500">{selecionada.cnpjTomador ? formatCpfCnpj(selecionada.cnpjTomador) : ''}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">Emissão</dt><dd>{formatData(selecionada.dataEmissao)}</dd><dd className="text-xs text-slate-500">competência {selecionada.competencia ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">Município</dt><dd>{selecionada.municipioPrestacao ?? selecionada.municipioEmissao ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">Valor do serviço</dt><dd className="font-medium">{formatBRL(selecionada.valorServico)}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">Base / alíquota</dt><dd>{formatBRL(selecionada.baseCalculo)}{selecionada.aliquota != null ? ` · ${selecionada.aliquota}%` : ''}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">ISSQN</dt><dd>{formatBRL(selecionada.valorIss)}</dd></div>
            <div><dt className="text-xs text-slate-500 uppercase">Valor líquido</dt><dd className="font-medium">{formatBRL(selecionada.valorLiquido)}</dd></div>
          </dl>

          {selecionada.descricaoServico && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500 uppercase">Descrição do serviço</p>
              <p className="mt-1 text-sm whitespace-pre-line text-slate-800">{selecionada.descricaoServico}</p>
              {selecionada.codigoTributacaoNacional && (
                <p className="mt-2 text-xs text-slate-500">Código de tributação nacional: {selecionada.codigoTributacaoNacional}</p>
              )}
            </div>
          )}

          {selecionada.eventos?.length ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-800">Eventos</p>
              <ul className="space-y-1 text-sm text-slate-600">
                {selecionada.eventos.map((e) => (
                  <li key={`${e.tipoEvento}-${e.numeroSequencial}`} className="flex flex-wrap items-center gap-2">
                    <Badge tom="azul">{e.tipoEvento}</Badge>
                    <span>{e.descricao}</span>
                    <span className="text-xs text-slate-500">{formatData(e.dataEvento)}</span>
                    {e.storagePath && (
                      <button onClick={() => void baixarXml(selecionada, e.storagePath)} className="text-xs text-indigo-600 hover:underline">
                        baixar XML
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Botao tamanho="sm" carregando={ocupado === `pdf-${selecionada.id}`} onClick={() => void baixarPdf(selecionada)}>
              <FileDown className="h-3.5 w-3.5" /> Baixar PDF (DANFSe)
            </Botao>
            {selecionada.storagePath && (
              <Botao tamanho="sm" variante="secundario" carregando={ocupado === `xml-${selecionada.id}`} onClick={() => void baixarXml(selecionada)}>
                <Download className="h-3.5 w-3.5" /> Baixar XML
              </Botao>
            )}
          </div>
        </Card>
      )}

      {carregando ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : dados.length === 0 ? (
        <EstadoVazio
          icone={<Receipt className="h-10 w-10" />}
          titulo="Nenhuma nota de serviço ainda"
          descricao="Com a busca de NFS-e ativa, as notas que você emite e as que recebe aparecem aqui automaticamente."
          acao={
            <Link to="/configuracoes">
              <Botao><Settings className="h-4 w-4" /> Configurar integração</Botao>
            </Link>
          }
        />
      ) : filtradas.length === 0 ? (
        <EstadoVazio titulo="Nenhum resultado" descricao="Ajuste os filtros." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Prestador / tomador</th>
                <th className="px-4 py-3">Emissão</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {daPagina.map((n) => (
                <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelecionada(n)}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {n.numero ?? '—'}
                    {n.origem === 'municipal' && (
                      <span className="mt-0.5 block text-[10px] font-normal text-slate-400">sistema municipal</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tom={n.papel === 'prestador' ? 'verde' : n.papel === 'tomador' ? 'azul' : 'neutro'}>
                      {n.papel === 'prestador' ? 'Emitida' : n.papel === 'tomador' ? 'Recebida' : 'Outro'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {n.papel === 'prestador' ? (n.razaoSocialTomador ?? '—') : (n.razaoSocialPrestador ?? '—')}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatData(n.dataEmissao)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{formatBRL(n.valorServico)}</td>
                  <td className="px-4 py-3">
                    <Badge tom={n.status === 'cancelada' ? 'vermelho' : 'verde'}>{STATUS_NOTA_SERVICO[n.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelecionada(n) }}
                        className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50"
                        title="Ver detalhes"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void baixarPdf(n) }}
                        disabled={ocupado === `pdf-${n.id}`}
                        className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        title="Baixar PDF (DANFSe)"
                      >
                        <FileDown className="h-4 w-4" />
                      </button>
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
                    </div>
                  </td>
                </tr>
              ))}
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
