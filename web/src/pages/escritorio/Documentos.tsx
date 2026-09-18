import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { orderBy, limit, type Timestamp } from 'firebase/firestore'
import { Check, Download, FilePlus2, FolderOpen, Inbox, Trash2, Upload, X } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useAuth } from '../../auth/AuthProvider'
import { useColecao } from '../../services/firestore'
import { confirmar, perguntar } from '../../components/Dialogo'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, EstadoVazio, Input, Select, Spinner } from '../../components/ui'
import { formatData } from '../../lib/utils'
import { dataBr, mesLegivel } from '../../lib/escritorio'

const CATEGORIAS = {
  extrato: 'Extrato bancário',
  nota_despesa: 'Nota de despesa',
  nota_receita: 'Nota de receita',
  folha: 'Folha e pessoal',
  contrato: 'Contrato',
  guia_comprovante: 'Comprovante de pagamento',
  societario: 'Societário',
  outro: 'Outro',
} as const
type Categoria = keyof typeof CATEGORIAS

interface Documento {
  nome: string
  categoria: Categoria
  competencia?: string
  observacao?: string
  solicitacaoId?: string
  tamanho: number
  enviadoPor: string
  enviadoPorNome?: string
  enviadoEm?: Timestamp
}

interface Solicitacao {
  titulo: string
  descricao?: string
  categoria: Categoria
  competencia?: string
  prazo?: string
  situacao: 'aberta' | 'enviada' | 'aceita' | 'recusada'
  motivoRecusa?: string
  documentos: number
  criadaPorNome?: string
}

const SITUACOES: Record<Solicitacao['situacao'], { rotulo: string; tom: 'amarelo' | 'azul' | 'verde' | 'vermelho' }> = {
  aberta: { rotulo: 'Aguardando envio', tom: 'amarelo' },
  enviada: { rotulo: 'Enviado, a conferir', tom: 'azul' },
  aceita: { rotulo: 'Concluída', tom: 'verde' },
  recusada: { rotulo: 'Reenviar', tom: 'vermelho' },
}

const MAX_BYTES = 7 * 1024 * 1024
const tamanhoLegivel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const hoje = () => new Date().toLocaleDateString('en-CA')

function paraBase64(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader()
    leitor.onload = () => ok(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'))
    leitor.readAsDataURL(arquivo)
  })
}

async function enviar(arquivo: File, extras: { categoria?: string; competencia?: string; observacao?: string; solicitacaoId?: string }) {
  if (arquivo.size > MAX_BYTES) throw new Error(`"${arquivo.name}" tem ${tamanhoLegivel(arquivo.size)}: o limite é 7 MB por arquivo.`)
  await httpsCallable(functions, 'enviarDocumentoDaEmpresa')({
    nomeArquivo: arquivo.name,
    conteudoBase64: await paraBase64(arquivo),
    categoria: extras.categoria,
    competencia: extras.competencia || null,
    observacao: extras.observacao || null,
    solicitacaoId: extras.solicitacaoId ?? null,
  })
}

const esquemaPedido = z.object({
  titulo: z.string().trim().min(3, 'Diga o que está sendo pedido').max(120),
  descricao: z.string().trim().max(500),
  categoria: z.string(),
  competencia: z.string(),
  prazo: z.string(),
})
type FormPedido = z.infer<typeof esquemaPedido>

const esquemaEnvio = z.object({ categoria: z.string(), competencia: z.string(), observacao: z.string().trim().max(300) })
type FormEnvio = z.infer<typeof esquemaEnvio>

/** Botão que abre o seletor de arquivos e envia um ou vários de uma vez. */
function BotaoEnviar({ rotulo, extras, aoErro, tamanho = 'sm', variante = 'primario' }: { rotulo: string; extras: () => Parameters<typeof enviar>[1]; aoErro: (m: string | null) => void; tamanho?: 'sm' | 'md'; variante?: 'primario' | 'secundario' }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  async function aoEscolher(arquivos: FileList | null) {
    if (!arquivos?.length) return
    setEnviando(true)
    aoErro(null)
    try {
      for (const a of Array.from(arquivos)) await enviar(a, extras())
    } catch (e) {
      aoErro(e instanceof Error ? e.message : 'Não foi possível enviar.')
    } finally {
      setEnviando(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  return (
    <>
      <input ref={entrada} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.xml,.ofx,.csv,.txt,.xlsx,.xls,.docx,.zip" onChange={(e) => void aoEscolher(e.target.files)} />
      <Botao tamanho={tamanho} variante={variante} carregando={enviando} onClick={() => entrada.current?.click()}>
        <Upload className="h-3.5 w-3.5" /> {rotulo}
      </Botao>
    </>
  )
}

/**
 * Documentos do cliente: o escritório pede, o cliente envia, a equipe confere — e tudo fica
 * arquivado por competência. O arquivo entra e sai pelo backend; o Storage é fechado.
 */
export function Documentos() {
  const { membro, user } = useAuth()
  const daEquipe = membro?.papel !== 'cliente'
  const pedidos = useColecao<Solicitacao>('solicitacoes', [orderBy('criadaEm', 'desc'), limit(200)])
  const arquivos = useColecao<Documento>('documentos', [orderBy('enviadoEm', 'desc'), limit(400)])
  const [erro, setErro] = useState<string | null>(null)
  const [pedindo, setPedindo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState('')

  const mes = hoje().slice(0, 7)
  const pedido = useForm<FormPedido>({ resolver: zodResolver(esquemaPedido), defaultValues: { titulo: '', descricao: '', categoria: 'extrato', competencia: mes, prazo: '' } })
  const envio = useForm<FormEnvio>({ resolver: zodResolver(esquemaEnvio), defaultValues: { categoria: 'outro', competencia: mes, observacao: '' } })

  async function chamar(chave: string, nome: string, dados: unknown) {
    setOcupado(chave)
    setErro(null)
    try {
      return (await httpsCallable(functions, nome)(dados)).data
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
      return null
    } finally {
      setOcupado(null)
    }
  }

  async function criarPedido(v: FormPedido) {
    const r = await chamar('pedido', 'criarSolicitacaoDeDocumento', { ...v, competencia: v.competencia || null, prazo: v.prazo || null, descricao: v.descricao || null })
    if (r) {
      pedido.reset({ titulo: '', descricao: '', categoria: v.categoria, competencia: v.competencia, prazo: '' })
      setPedindo(false)
    }
  }

  async function baixar(id: string) {
    const r = (await chamar(`baixar-${id}`, 'baixarDocumentoDaEmpresa', { documentoId: id })) as { nomeArquivo: string; tipo: string; conteudoBase64: string } | null
    if (!r) return
    const bytes = Uint8Array.from(atob(r.conteudoBase64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: r.tipo }))
    const link = document.createElement('a')
    link.href = url
    link.download = r.nomeArquivo
    link.click()
    URL.revokeObjectURL(url)
  }

  async function excluir(d: Documento & { id: string }) {
    if (!(await confirmar(`Excluir "${d.nome}"? O arquivo é apagado de vez.`))) return
    await chamar(`excluir-${d.id}`, 'excluirDocumentoDaEmpresa', { documentoId: d.id })
  }

  async function recusar(id: string) {
    const motivo = await perguntar('O que faltou? O cliente vê esta mensagem e reenvia.')
    if (motivo?.trim()) await chamar(`avaliar-${id}`, 'avaliarSolicitacaoDeDocumento', { solicitacaoId: id, decisao: 'recusada', motivo })
  }

  const abertas = pedidos.dados.filter((s) => s.situacao !== 'aceita')
  const concluidas = pedidos.dados.filter((s) => s.situacao === 'aceita')
  const visiveis = mostrarConcluidas ? pedidos.dados : abertas
  const docsDoPedido = (id: string) => arquivos.dados.filter((d) => d.solicitacaoId === id)
  const arquivoFiltrado = arquivos.dados.filter((d) => !filtroCategoria || d.categoria === filtroCategoria)

  // arquivo agrupado por competência, a mais recente primeiro
  const grupos = new Map<string, typeof arquivoFiltrado>()
  for (const d of arquivoFiltrado) grupos.set(d.competencia ?? '', [...(grupos.get(d.competencia ?? '') ?? []), d])
  const competencias = [...grupos.keys()].sort((a, b) => b.localeCompare(a))

  return (
    <>
      <CabecalhoPagina
        titulo="Documentos"
        descricao={daEquipe ? 'Peça documentos ao cliente, confira o que chegou e mantenha o arquivo por competência.' : 'Envie o que o escritório pediu e consulte o que já foi entregue.'}
        acoes={
          daEquipe ? (
            <Botao onClick={() => setPedindo((v) => !v)}>
              {pedindo ? <X className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />} {pedindo ? 'Fechar' : 'Pedir documento'}
            </Botao>
          ) : undefined
        }
      />

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {pedindo && (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold">Novo pedido ao cliente</h2>
          <form onSubmit={pedido.handleSubmit(criarPedido)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo label="O que você precisa" className="sm:col-span-4" erro={pedido.formState.errors.titulo?.message} obrigatorio>
              <Input placeholder="Extrato bancário de agosto, em PDF e OFX" {...pedido.register('titulo')} />
            </Campo>
            <Campo label="Tipo" className="sm:col-span-2">
              <Select {...pedido.register('categoria')}>
                {Object.entries(CATEGORIAS).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo label="Competência" className="sm:col-span-2">
              <Input type="month" {...pedido.register('competencia')} />
            </Campo>
            <Campo label="Prazo" className="sm:col-span-2">
              <Input type="date" min={hoje()} {...pedido.register('prazo')} />
            </Campo>
            <Campo label="Detalhes" className="sm:col-span-6" erro={pedido.formState.errors.descricao?.message}>
              <Input placeholder="Opcional: de qual conta, em que formato…" {...pedido.register('descricao')} />
            </Campo>
            <div className="sm:col-span-6">
              <Botao type="submit" tamanho="sm" carregando={ocupado === 'pedido'}>
                <FilePlus2 className="h-3.5 w-3.5" /> Criar pedido
              </Botao>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Inbox className="h-4 w-4" /> Pedidos {abertas.length > 0 && <Badge tom="amarelo">{abertas.length} em aberto</Badge>}
        </h2>
        {concluidas.length > 0 && (
          <button type="button" className="text-sm text-slate-600 underline" onClick={() => setMostrarConcluidas((v) => !v)}>
            {mostrarConcluidas ? 'Esconder concluídos' : `Ver ${concluidas.length} concluído${concluidas.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {pedidos.carregando ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : visiveis.length === 0 ? (
        <div className="mb-8">
          <EstadoVazio icone={<Inbox className="h-8 w-8" />} titulo="Nenhum pedido em aberto" descricao={daEquipe ? 'Use "Pedir documento" para solicitar algo ao cliente.' : 'O escritório não está esperando nenhum documento seu agora.'} />
        </div>
      ) : (
        <div className="mb-8 space-y-3">
          {visiveis.map((s) => {
            const atrasado = s.prazo && s.prazo < hoje() && (s.situacao === 'aberta' || s.situacao === 'recusada')
            return (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{s.titulo}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {CATEGORIAS[s.categoria] ?? s.categoria}
                      {s.competencia ? ` · ${mesLegivel(s.competencia)}` : ''}
                      {s.prazo ? ` · até ${dataBr(s.prazo)}` : ''}
                      {s.criadaPorNome ? ` · pedido por ${s.criadaPorNome}` : ''}
                    </p>
                    {s.descricao && <p className="mt-1 text-sm text-slate-600">{s.descricao}</p>}
                    {s.situacao === 'recusada' && s.motivoRecusa && <p className="mt-1 text-sm font-medium text-red-700">Faltou: {s.motivoRecusa}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {atrasado && <Badge tom="vermelho">prazo vencido</Badge>}
                    <Badge tom={SITUACOES[s.situacao].tom}>{SITUACOES[s.situacao].rotulo}</Badge>
                  </div>
                </div>

                {docsDoPedido(s.id).length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {docsDoPedido(s.id).map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate">
                          {d.nome} <span className="text-xs text-slate-500">· {tamanhoLegivel(d.tamanho)} · {formatData(d.enviadoEm)}</span>
                        </span>
                        <Botao tamanho="sm" variante="fantasma" carregando={ocupado === `baixar-${d.id}`} onClick={() => void baixar(d.id)}>
                          <Download className="h-3.5 w-3.5" /> Baixar
                        </Botao>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {s.situacao !== 'aceita' && <BotaoEnviar rotulo={s.documentos ? 'Enviar mais arquivos' : 'Enviar arquivos'} extras={() => ({ solicitacaoId: s.id })} aoErro={setErro} variante={daEquipe ? 'secundario' : 'primario'} />}
                  {daEquipe && s.situacao === 'enviada' && (
                    <>
                      <Botao tamanho="sm" carregando={ocupado === `avaliar-${s.id}`} onClick={() => void chamar(`avaliar-${s.id}`, 'avaliarSolicitacaoDeDocumento', { solicitacaoId: s.id, decisao: 'aceita' })}>
                        <Check className="h-3.5 w-3.5" /> Está certo
                      </Botao>
                      <Botao tamanho="sm" variante="secundario" onClick={() => void recusar(s.id)}>
                        <X className="h-3.5 w-3.5" /> Faltou algo
                      </Botao>
                    </>
                  )}
                  {daEquipe && s.documentos === 0 && s.situacao === 'aberta' && (
                    <Botao tamanho="sm" variante="fantasma" carregando={ocupado === `avaliar-${s.id}`} onClick={() => void chamar(`avaliar-${s.id}`, 'avaliarSolicitacaoDeDocumento', { solicitacaoId: s.id, decisao: 'excluir' })}>
                      <Trash2 className="h-3.5 w-3.5" /> Cancelar pedido
                    </Botao>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FolderOpen className="h-4 w-4" /> Arquivo
          </h2>
          <form className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-6" onSubmit={(e) => e.preventDefault()}>
            <Campo label="Tipo" className="sm:col-span-2">
              <Select {...envio.register('categoria')}>
                {Object.entries(CATEGORIAS).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo label="Competência" className="sm:col-span-1">
              <Input type="month" {...envio.register('competencia')} />
            </Campo>
            <Campo label="Observação" className="sm:col-span-2">
              <Input placeholder="Opcional" {...envio.register('observacao')} />
            </Campo>
            <div className="sm:col-span-1">
              <BotaoEnviar rotulo="Enviar avulso" tamanho="md" variante="secundario" extras={() => envio.getValues()} aoErro={setErro} />
            </div>
          </form>
          <p className="mt-2 text-xs text-slate-500">PDF, imagem, XML, OFX, planilha, Word ou ZIP, até 7 MB por arquivo.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
          <span className="text-slate-500">Mostrar:</span>
          <Select className="h-8 w-56" value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
            <option value="">Todos os tipos</option>
            {Object.entries(CATEGORIAS).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </div>

        {arquivos.carregando ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : competencias.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Nenhum documento arquivado{filtroCategoria ? ' deste tipo' : ''}.</p>
        ) : (
          competencias.map((c) => (
            <div key={c}>
              <p className="bg-slate-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">{c ? mesLegivel(c) : 'Sem competência'}</p>
              <ul className="divide-y divide-slate-100">
                {grupos.get(c)!.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{d.nome}</p>
                      <p className="text-xs text-slate-500">
                        {CATEGORIAS[d.categoria] ?? d.categoria} · {tamanhoLegivel(d.tamanho)} · {formatData(d.enviadoEm)}
                        {d.enviadoPorNome ? ` · ${d.enviadoPorNome}` : ''}
                        {d.observacao ? ` — ${d.observacao}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Botao tamanho="sm" variante="secundario" carregando={ocupado === `baixar-${d.id}`} onClick={() => void baixar(d.id)}>
                        <Download className="h-3.5 w-3.5" /> Baixar
                      </Botao>
                      {(daEquipe || d.enviadoPor === user?.uid) && (
                        <Botao tamanho="sm" variante="fantasma" carregando={ocupado === `excluir-${d.id}`} onClick={() => void excluir(d)} aria-label="Excluir">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Botao>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Card>
    </>
  )
}
