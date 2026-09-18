import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { doc, limit, orderBy, serverTimestamp, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Check, ChevronDown, ChevronUp, Copy, FilePlus2, Landmark, Pencil, QrCode, Save, Trash2, Undo2, Upload, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { db, functions } from '../lib/firebase'
import { useColecao, useDocumento } from '../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, EstadoVazio, Input, Select, Spinner } from '../components/ui'
import { confirmar } from '../components/Dialogo'
import { formatBRL, formatData } from '../lib/utils'
import { TIPOS_GUIA, diasAteVencer, formatarLinhaDigitavel, periodoLegivel } from '../lib/guias'
import { AcoesDaGuia, GuiaPronta } from './guias/AcoesDaGuia'
import { ReceitaCard } from './guias/ReceitaCard'
import { MonitorReceitaCard } from './guias/MonitorReceitaCard'
import type { ComId, ConfiguracaoHonorarios, Guia, NotaServico } from '../types'

type Msg = { tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null

const hoje = () => new Date().toLocaleDateString('en-CA')
const dataBr = (iso?: string) => (iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') : '—')

/** Arquivo → base64, em blocos para não estourar a pilha em PDFs maiores. */
async function paraBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}


function SeloVencimento({ guia }: { guia: Guia }) {
  if (guia.status === 'paga') return <Badge tom="verde">Paga</Badge>
  const dias = diasAteVencer(guia.vencimento)
  if (dias === null) return <Badge tom="neutro">Sem vencimento</Badge>
  if (dias < 0) return <Badge tom="vermelho">Vencida há {-dias} dia(s)</Badge>
  if (dias === 0) return <Badge tom="vermelho">Vence hoje</Badge>
  if (dias <= 7) return <Badge tom="amarelo">Vence em {dias} dia(s)</Badge>
  return <Badge tom="azul">A vencer</Badge>
}

// ---------- detalhe, aberto na própria linha ----------

function DetalheGuia({
  guia,
  receitaDoPeriodo,
  ehAdmin,
  ocupado,
  aoMarcar,
  aoExcluir,
}: {
  guia: ComId<Guia>
  /** Soma das NFS-e emitidas na competência da guia — só para conferência do DAS */
  receitaDoPeriodo: number | null
  ehAdmin: boolean
  ocupado: string | null
  aoMarcar: (g: ComId<Guia>, paga: boolean, data?: string) => void
  aoExcluir: (g: ComId<Guia>) => void
}) {
  const [copiado, setCopiado] = useState(false)
  const [dataPagamento, setDataPagamento] = useState(hoje())
  const [avisoAcao, setAvisoAcao] = useState<string | null>(null)

  async function copiar() {
    if (!guia.linhaDigitavel) return
    await navigator.clipboard.writeText(guia.linhaDigitavel)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="border-l-2 border-indigo-400 bg-slate-50/70 px-4 py-4">
      {guia.avisos?.length > 0 && (
        <div className="mb-3">
          <Alerta tipo="info">{guia.avisos.join(' ')}</Alerta>
        </div>
      )}

      {guia.linhaDigitavel && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500 uppercase">Linha digitável</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm break-all text-slate-900">{formatarLinhaDigitavel(guia.linhaDigitavel)}</code>
            <Botao tamanho="sm" variante="secundario" onClick={() => void copiar()}>
              {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copiado ? 'Copiada' : 'Copiar'}
            </Botao>
          </div>
          {guia.linhaDigitavelValida === false && <p className="mt-1 text-xs text-red-700">Os dígitos verificadores não conferem — use o PDF para pagar.</p>}
          <p className="mt-1 text-xs text-slate-500">O QR Code do PIX está no PDF.</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500 uppercase">Documento</dt>
          <dd className="font-mono text-xs">{guia.numeroDocumento ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">{guia.tipo === 'honorarios' ? 'Emitente' : 'Contribuinte'}</dt>
          <dd>{guia.tipo === 'honorarios' ? (guia.emitente ?? '—') : (guia.contribuinte ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Origem</dt>
          <dd>{guia.origem === 'gerada' ? 'Recibo gerado aqui' : guia.origem === 'serpro' ? 'Emitida pela Receita (Integra Contador)' : 'PDF oficial enviado'}</dd>
        </div>
        {guia.observacoes && (
          <div>
            <dt className="text-xs text-slate-500 uppercase">Observações</dt>
            <dd>{guia.observacoes}</dd>
          </div>
        )}
      </dl>

      {guia.composicao?.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Tributo</th>
                <th className="px-3 py-2 text-right">Principal</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {guia.composicao.map((i) => (
                <tr key={i.codigo}>
                  <td className="px-3 py-2 font-mono text-xs">{i.codigo}</td>
                  <td className="px-3 py-2">{i.denominacao}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(i.principal)}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {guia.tipo === 'das' && receitaDoPeriodo !== null && receitaDoPeriodo > 0 && guia.valor && (
        <p className="mt-3 text-sm text-slate-600">
          Conferência: as notas de serviço emitidas em {periodoLegivel(guia.periodo)} somam <strong>{formatBRL(receitaDoPeriodo)}</strong>; este DAS corresponde a{' '}
          <strong>{((guia.valor / receitaDoPeriodo) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</strong> desse valor.
        </p>
      )}

      <div className="mt-4">
        <AcoesDaGuia guia={guia} aoAvisar={(texto) => setAvisoAcao(texto)} />
        {avisoAcao && <p className="mt-2 text-xs text-slate-600">{avisoAcao}</p>}
      </div>

      {guia.compartilhamento?.enviadoEm && (
        <p className={`mt-3 text-xs font-medium ${guia.compartilhamento.visualizacoes ? 'text-emerald-700' : 'text-slate-500'}`}>
          Link enviado em {formatData(guia.compartilhamento.enviadoEm)} ·{' '}
          {guia.compartilhamento.visualizacoes
            ? `aberto ${guia.compartilhamento.visualizacoes} ${guia.compartilhamento.visualizacoes === 1 ? 'vez' : 'vezes'}, a primeira em ${guia.compartilhamento.primeiraVisualizacaoEm?.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) ?? '—'}`
            : 'ainda não foi aberto'}
          .
        </p>
      )}

      {guia.pagamentoConfirmado && (
        <p className="mt-3 text-xs font-medium text-emerald-700">
          Pagamento confirmado pela Receita Federal: arrecadado em {guia.pagamentoConfirmado.dataArrecadacao.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1')}
          {guia.pagamentoConfirmado.valorTotal !== undefined ? ` · ${formatBRL(guia.pagamentoConfirmado.valorTotal)}` : ''}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {guia.status === 'paga' ? (
          <Botao tamanho="sm" variante="secundario" carregando={ocupado === `pagar-${guia.id}`} onClick={() => aoMarcar(guia, false)}>
            <Undo2 className="h-3.5 w-3.5" /> Desfazer pagamento
          </Botao>
        ) : (
          <>
            <Campo label="Pago em" className="w-40">
              <Input type="date" value={dataPagamento} max={hoje()} onChange={(e) => setDataPagamento(e.target.value)} />
            </Campo>
            <Botao tamanho="sm" variante="secundario" carregando={ocupado === `pagar-${guia.id}`} onClick={() => aoMarcar(guia, true, dataPagamento)}>
              <Check className="h-3.5 w-3.5" /> Marcar como paga
            </Botao>
          </>
        )}
        {ehAdmin && (
          <Botao tamanho="sm" variante="fantasma" carregando={ocupado === `excluir-${guia.id}`} onClick={() => aoExcluir(guia)}>
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </Botao>
        )}
      </div>
    </div>
  )
}

// ---------- honorários: dados do escritório e geração do recibo ----------

const CHAVES_PIX = {
  cpf_cnpj: { rotulo: 'CPF ou CNPJ', exemplo: '00.000.000/0001-00', valida: (v: string) => [11, 14].includes(v.replace(/\D/g, '').length) },
  celular: { rotulo: 'Celular', exemplo: '(35) 99999-0000', valida: (v: string) => [10, 11].includes(v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').length) },
  email: { rotulo: 'E-mail', exemplo: 'financeiro@escritorio.com.br', valida: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
  aleatoria: { rotulo: 'Chave aleatória', exemplo: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', valida: (v: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v) },
} as const

const esquemaEscritorio = z
  .object({
  nome: z.string().trim().min(3, 'Informe o nome do escritório ou do contador'),
  documento: z.string().trim(),
  crc: z.string().trim(),
  telefone: z.string().trim(),
  valorMensal: z.string().trim(),
  diaVencimento: z.string().trim().refine((v) => !v || (Number(v) >= 1 && Number(v) <= 31), 'Dia de 1 a 31'),
  mensagem: z.string().trim().max(200, 'No máximo 200 caracteres'),
  recorrente: z.boolean(),
  pixTipo: z.enum(['', 'cpf_cnpj', 'celular', 'email', 'aleatoria']),
  pixChave: z.string().trim(),
  pixNome: z.string().trim().max(60),
  pixCidade: z.string().trim().max(40),
})
  .superRefine((v, ctx) => {
    if (v.recorrente && !(Number(v.valorMensal.replace(/\./g, '').replace(',', '.')) > 0)) ctx.addIssue({ code: 'custom', path: ['valorMensal'], message: 'Para gerar todo mês, informe o valor' })
    if (v.recorrente && !v.diaVencimento) ctx.addIssue({ code: 'custom', path: ['diaVencimento'], message: 'Para gerar todo mês, informe o dia' })
    if (!v.pixTipo) return
    if (!CHAVES_PIX[v.pixTipo].valida(v.pixChave)) ctx.addIssue({ code: 'custom', path: ['pixChave'], message: `Não parece uma chave do tipo ${CHAVES_PIX[v.pixTipo].rotulo}` })
    if (!v.pixCidade) ctx.addIssue({ code: 'custom', path: ['pixCidade'], message: 'O PIX exige a cidade do recebedor' })
  })
type FormEscritorio = z.infer<typeof esquemaEscritorio>

const esquemaRecibo = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Informe o mês de competência'),
  valor: z.string().refine((v) => Number(v.replace(/\./g, '').replace(',', '.')) > 0, 'Informe o valor'),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe o vencimento'),
  descricao: z.string().trim().max(200),
  comPix: z.boolean(),
})
type FormRecibo = z.infer<typeof esquemaRecibo>

function HonorariosCard() {
  const { empresa } = useAuth()
  const { dado: config } = useDocumento<ConfiguracaoHonorarios>('configuracoes', 'honorarios')
  const [editando, setEditando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState<string | null>(null)
  const temPix = Boolean(config?.pix?.chave)

  const escritorio = useForm<FormEscritorio>({
    resolver: zodResolver(esquemaEscritorio),
    values: {
      nome: config?.emitente?.nome ?? '',
      documento: config?.emitente?.documento ?? '',
      crc: config?.emitente?.crc ?? '',
      telefone: config?.emitente?.telefone ?? '',
      valorMensal: config?.valorMensal ? config.valorMensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
      diaVencimento: config?.diaVencimento ? String(config.diaVencimento) : '',
      mensagem: config?.mensagem ?? '',
      recorrente: config?.recorrente ?? false,
      pixTipo: config?.pix?.tipo ?? '',
      pixChave: config?.pix?.chave ?? '',
      pixNome: config?.pix?.nome ?? '',
      pixCidade: config?.pix?.cidade ?? '',
    },
  })

  const mesAtual = new Date().toLocaleDateString('en-CA').slice(0, 7)
  const recibo = useForm<FormRecibo>({ resolver: zodResolver(esquemaRecibo), defaultValues: { competencia: mesAtual, valor: '', vencimento: '', descricao: '', comPix: true } })

  // o valor e o vencimento combinados viram a sugestão do próximo recibo
  useEffect(() => {
    if (!config) return
    if (config.valorMensal && !recibo.getValues('valor')) recibo.setValue('valor', config.valorMensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
    if (config.diaVencimento && !recibo.getValues('vencimento')) {
      const agora = new Date()
      const alvo = new Date(agora.getFullYear(), agora.getMonth() + (agora.getDate() > config.diaVencimento ? 1 : 0), config.diaVencimento)
      recibo.setValue('vencimento', alvo.toLocaleDateString('en-CA'))
    }
  }, [config, recibo])

  async function salvar(v: FormEscritorio) {
    if (!empresa) return
    setOcupado('salvar')
    setErro(null)
    try {
      await setDoc(
        doc(db, 'empresas', empresa.id, 'configuracoes', 'honorarios'),
        {
          emitente: { nome: v.nome, documento: v.documento, crc: v.crc, telefone: v.telefone },
          valorMensal: v.valorMensal ? Number(v.valorMensal.replace(/\./g, '').replace(',', '.')) : null,
          diaVencimento: v.diaVencimento ? Number(v.diaVencimento) : null,
          mensagem: v.mensagem,
          // `tipo` é o que o agendamento procura em todas as empresas
          tipo: 'honorarios',
          recorrente: v.recorrente,
          pix: v.pixTipo ? { tipo: v.pixTipo, chave: v.pixChave, nome: v.pixNome, cidade: v.pixCidade } : null,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      )
      setEditando(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setOcupado(null)
    }
  }

  async function gerar(v: FormRecibo) {
    setOcupado('gerar')
    setErro(null)
    try {
      setPronto(null)
      const r = await httpsCallable<unknown, { id: string; numero: string }>(functions, 'gerarReciboDeHonorarios')({
        competencia: v.competencia,
        valor: Number(v.valor.replace(/\./g, '').replace(',', '.')),
        vencimento: v.vencimento,
        descricao: v.descricao || undefined,
        comPix: temPix && v.comPix,
      })
      setPronto(r.data.id)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gerar o recibo.')
    } finally {
      setOcupado(null)
    }
  }

  const configurado = Boolean(config?.emitente?.nome)
  const pixTipo = escritorio.watch('pixTipo')

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FilePlus2 className="h-4 w-4" /> Recibo de honorários
        </h2>
        {configurado && (
          <Botao tamanho="sm" variante="secundario" onClick={() => setEditando((v) => !v)}>
            {editando ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />} {editando ? 'Fechar edição' : 'Editar dados do escritório'}
          </Botao>
        )}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        O recibo é documento do próprio escritório, então este o sistema gera. {configurado ? `Emitente: ${config?.emitente.nome}.` : 'Cadastre os dados do escritório para começar.'}
      </p>

      {erro && (
        <div className="mb-3">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}
      {pronto && <GuiaPronta guiaId={pronto} aoFechar={() => setPronto(null)} />}

      {(!configurado || editando) && (
        <form onSubmit={escritorio.handleSubmit(salvar)} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Campo label="Escritório / contador" className="sm:col-span-3" erro={escritorio.formState.errors.nome?.message} obrigatorio>
            <Input {...escritorio.register('nome')} />
          </Campo>
          <Campo label="CPF ou CNPJ" className="sm:col-span-3">
            <Input {...escritorio.register('documento')} />
          </Campo>
          <Campo label="CRC" className="sm:col-span-3">
            <Input placeholder="000.000 - MG" {...escritorio.register('crc')} />
          </Campo>
          <Campo label="Telefone" className="sm:col-span-3">
            <Input {...escritorio.register('telefone')} />
          </Campo>
          <Campo label="Honorário mensal (R$)" className="sm:col-span-3" erro={escritorio.formState.errors.valorMensal?.message}>
            <Input inputMode="decimal" {...escritorio.register('valorMensal')} />
          </Campo>
          <Campo label="Dia do vencimento" className="sm:col-span-3" erro={escritorio.formState.errors.diaVencimento?.message}>
            <Input inputMode="numeric" {...escritorio.register('diaVencimento')} />
          </Campo>
          <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-6">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...escritorio.register('recorrente')} />
            <span>
              Gerar o recibo sozinho todo mês
              <span className="block text-xs text-slate-500">Com o valor e o dia de vencimento acima. O recibo do mês aparece em Guias a pagar; se já existir um daquela competência, nada é duplicado.</span>
            </span>
          </label>
          <Campo label="Mensagem no recibo" className="sm:col-span-6" erro={escritorio.formState.errors.mensagem?.message}>
            <Input placeholder="Pagamento até a data de vencimento." {...escritorio.register('mensagem')} />
          </Campo>
          <div className="mt-1 border-t border-slate-200 pt-3 sm:col-span-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <QrCode className="h-4 w-4" /> PIX para receber os honorários
            </p>
            <p className="text-xs text-slate-500">Com a chave cadastrada, o recibo sai com QR Code e PIX copia e cola já no valor cobrado. O dinheiro cai direto na conta da chave.</p>
          </div>
          <Campo label="Tipo da chave PIX" className="sm:col-span-3">
            <Select {...escritorio.register('pixTipo')}>
              <option value="">Não usar PIX no recibo</option>
              {Object.entries(CHAVES_PIX).map(([valor, c]) => (
                <option key={valor} value={valor}>
                  {c.rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          {pixTipo ? (
            <>
              <Campo label="Chave PIX" className="sm:col-span-3" erro={escritorio.formState.errors.pixChave?.message} obrigatorio>
                <Input placeholder={CHAVES_PIX[pixTipo].exemplo} {...escritorio.register('pixChave')} />
              </Campo>
              <Campo label="Nome do titular da conta" className="sm:col-span-3" erro={escritorio.formState.errors.pixNome?.message}>
                <Input placeholder="Em branco: o nome do escritório" {...escritorio.register('pixNome')} />
              </Campo>
              <Campo label="Cidade do titular" className="sm:col-span-3" erro={escritorio.formState.errors.pixCidade?.message} obrigatorio>
                <Input {...escritorio.register('pixCidade')} />
              </Campo>
            </>
          ) : (
            <div className="hidden sm:col-span-3 sm:block" />
          )}
          <div className="sm:col-span-6">
            <Botao type="submit" tamanho="sm" carregando={ocupado === 'salvar'}>
              <Save className="h-3.5 w-3.5" /> Salvar dados do escritório
            </Botao>
          </div>
        </form>
      )}

      {configurado && (
        <form onSubmit={recibo.handleSubmit(gerar)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Campo label="Competência" className="sm:col-span-2" erro={recibo.formState.errors.competencia?.message} obrigatorio>
            <Input type="month" {...recibo.register('competencia')} />
          </Campo>
          <Campo label="Valor (R$)" className="sm:col-span-2" erro={recibo.formState.errors.valor?.message} obrigatorio>
            <Input inputMode="decimal" placeholder="265,00" {...recibo.register('valor')} />
          </Campo>
          <Campo label="Vencimento" className="sm:col-span-2" erro={recibo.formState.errors.vencimento?.message} obrigatorio>
            <Input type="date" {...recibo.register('vencimento')} />
          </Campo>
          <Campo label="Descrição" className="sm:col-span-6" dica="Em branco: Honorários contábeis - mês/ano">
            <Input {...recibo.register('descricao')} />
          </Campo>
          <div className="sm:col-span-6">
            {temPix ? (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...recibo.register('comPix')} />
                <QrCode className="h-4 w-4 text-slate-500" /> Incluir PIX para pagamento (QR Code e copia e cola) — chave {config?.pix?.chave}
              </label>
            ) : (
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <QrCode className="h-4 w-4" /> Para o recibo sair com PIX, cadastre a chave em
                <button type="button" className="font-medium text-slate-700 underline" onClick={() => setEditando(true)}>
                  Editar dados do escritório
                </button>
              </p>
            )}
          </div>
          <div className="sm:col-span-6">
            <Botao type="submit" tamanho="sm" carregando={ocupado === 'gerar'}>
              <FilePlus2 className="h-3.5 w-3.5" /> Gerar recibo
            </Botao>
          </div>
        </form>
      )}
    </Card>
  )
}

// ---------- página ----------

export function Guias() {
  const { membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const { dados, carregando, erro } = useColecao<Guia>('guias', [orderBy('criadoEm', 'desc'), limit(400)])
  const { dados: notas } = useColecao<NotaServico>('notasServico', [orderBy('dataEmissao', 'desc'), limit(500)])
  const [expandida, setExpandida] = useState<string | null>(null)
  const [situacao, setSituacao] = useState<'pendentes' | 'pagas' | 'todas'>('pendentes')
  const [tipo, setTipo] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [enviando, setEnviando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  const ordenadas = useMemo(
    () => [...dados].sort((a, b) => (a.vencimento ?? '9999').localeCompare(b.vencimento ?? '9999')),
    [dados],
  )
  const visiveis = useMemo(
    () =>
      ordenadas
        .filter((g) => (situacao === 'todas' ? true : situacao === 'pagas' ? g.status === 'paga' : g.status !== 'paga'))
        .filter((g) => !tipo || g.tipo === tipo)
        // pagas: a mais recente primeiro; a pagar: a que vence antes primeiro
        .sort((a, b) => (situacao === 'pagas' ? (b.vencimento ?? '').localeCompare(a.vencimento ?? '') : 0)),
    [ordenadas, situacao, tipo],
  )

  /**
   * Guias em aberto que cobram o MESMO débito: mesmo tipo, competência e valor, com números de
   * documento diferentes. Acontece quando a guia é emitida de novo (cada emissão ganha um número
   * novo) — pagar as duas é pagar o imposto em dobro.
   */
  const duplicadas = useMemo(() => {
    const grupos = new Map<string, ComId<Guia>[]>()
    for (const g of dados) {
      if (g.status === 'paga' || (g.tipo !== 'das' && g.tipo !== 'darf') || !g.periodo || g.valor === undefined) continue
      const chave = `${g.tipo}|${g.periodo}|${g.valor.toFixed(2)}|${g.composicao?.[0]?.codigo ?? ''}`
      grupos.set(chave, [...(grupos.get(chave) ?? []), g])
    }
    return new Set([...grupos.values()].filter((l) => l.length > 1).flat().map((g) => g.id))
  }, [dados])

  const resumo = useMemo(() => {
    // o mesmo débito emitido duas vezes conta uma vez só no que há a pagar
    const vistos = new Set<string>()
    const pendentes = dados.filter((g) => {
      if (g.status === 'paga') return false
      if (!duplicadas.has(g.id)) return true
      const chave = `${g.tipo}|${g.periodo}|${g.valor?.toFixed(2)}`
      if (vistos.has(chave)) return false
      vistos.add(chave)
      return true
    })
    const soma = (l: Guia[]) => l.reduce((s, g) => s + (g.valor ?? 0), 0)
    const vencidas = pendentes.filter((g) => (diasAteVencer(g.vencimento) ?? 1) < 0)
    const semana = pendentes.filter((g) => {
      const d = diasAteVencer(g.vencimento)
      return d !== null && d >= 0 && d <= 7
    })
    const mes = hoje().slice(0, 7)
    const pagasNoMes = dados.filter((g) => g.status === 'paga' && g.pagaEm?.toDate?.().toLocaleDateString('en-CA').startsWith(mes))
    return { aPagar: soma(pendentes), qtdPendentes: pendentes.length, vencidas: soma(vencidas), qtdVencidas: vencidas.length, semana: soma(semana), qtdSemana: semana.length, pagas: soma(pagasNoMes) }
  }, [dados, duplicadas])

  /** Receita das NFS-e emitidas por competência — só valores que estão nas notas, nada calculado. */
  const receitaPorPeriodo = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const n of notas) {
      if (n.papel !== 'prestador' || n.status === 'cancelada' || n.ambiente === 'homologacao' || !n.competencia) continue
      const periodo = n.competencia.slice(0, 7)
      mapa.set(periodo, (mapa.get(periodo) ?? 0) + (n.valorServico ?? 0))
    }
    return mapa
  }, [notas])

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return
    setEnviando(true)
    setMsg(null)
    const linhas: string[] = []
    let falhas = 0
    for (const arquivo of Array.from(arquivos)) {
      try {
        if (arquivo.size > 7 * 1024 * 1024) throw new Error('arquivo maior que 7 MB')
        const r = await httpsCallable<unknown, { nova: boolean; tipo: keyof typeof TIPOS_GUIA; valor: number | null; vencimento: string | null; avisos: string[] }>(
          functions,
          'importarGuia',
        )({ nomeArquivo: arquivo.name, pdfBase64: await paraBase64(arquivo) })
        const d = r.data
        linhas.push(
          `${TIPOS_GUIA[d.tipo]}${d.valor ? ` de ${formatBRL(d.valor)}` : ''}${d.vencimento ? `, vence em ${dataBr(d.vencimento)}` : ''}${d.nova ? '' : ' (já estava na lista; atualizada)'}${d.avisos.length ? ' — confira os avisos na guia' : ''}.`,
        )
      } catch (e) {
        falhas++
        linhas.push(`${arquivo.name}: ${e instanceof Error ? e.message : 'falhou'}`)
      }
    }
    setMsg({ tipo: falhas === arquivos.length ? 'erro' : falhas ? 'info' : 'sucesso', texto: linhas.join(' ') })
    setEnviando(false)
    if (entrada.current) entrada.current.value = ''
  }


  async function marcar(g: ComId<Guia>, paga: boolean, dataPagamento?: string) {
    setOcupado(`pagar-${g.id}`)
    try {
      await httpsCallable(functions, 'marcarGuiaPaga')({ guiaId: g.id, paga, dataPagamento })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível atualizar a guia.' })
    } finally {
      setOcupado(null)
    }
  }

  async function excluir(g: ComId<Guia>) {
    const ok = await confirmar(`Excluir a guia ${TIPOS_GUIA[g.tipo]} de ${formatBRL(g.valor ?? 0)}? O PDF guardado também é apagado.`, {
      titulo: 'Excluir guia',
      textoConfirmar: 'Excluir',
      perigo: true,
    })
    if (!ok) return
    setOcupado(`excluir-${g.id}`)
    try {
      await httpsCallable(functions, 'excluirGuia')({ guiaId: g.id })
      setExpandida(null)
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível excluir.' })
    } finally {
      setOcupado(null)
    }
  }

  return (
    <>
      <CabecalhoPagina titulo="Guias a pagar" descricao="DAS, DARF e honorários da empresa: o que vence, quanto é e como pagar." />

      {msg && (
        <div className="mb-4">
          <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
        </div>
      )}
      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">Não foi possível carregar as guias.</Alerta>
        </div>
      )}

      {duplicadas.size > 0 && (
        <div className="mb-4">
          <Alerta tipo="erro">
            <strong>Atenção: há {duplicadas.size} guias em aberto para o mesmo débito.</strong> Quando uma guia é emitida de novo, a Receita dá a ela um número novo — mas o imposto é o
            mesmo. Pague <strong>só uma</strong> e marque-a como paga; depois exclua a outra (ou marque também, para ela sair da lista). Elas estão sinalizadas abaixo.
          </Alerta>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { rotulo: 'A pagar', valor: formatBRL(resumo.aPagar), detalhe: `${resumo.qtdPendentes} guia(s)`, tom: '' },
          { rotulo: 'Vencidas', valor: formatBRL(resumo.vencidas), detalhe: `${resumo.qtdVencidas} guia(s)`, tom: resumo.qtdVencidas ? 'text-red-700' : '' },
          { rotulo: 'Vencem em 7 dias', valor: formatBRL(resumo.semana), detalhe: `${resumo.qtdSemana} guia(s)`, tom: resumo.qtdSemana ? 'text-amber-700' : '' },
          { rotulo: 'Pagas neste mês', valor: formatBRL(resumo.pagas), detalhe: '', tom: 'text-emerald-700' },
        ].map((c) => (
          <Card key={c.rotulo}>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{c.rotulo}</p>
            <p className={`mt-1 text-xl font-semibold ${c.tom}`}>{c.valor}</p>
            {c.detalhe && <p className="text-xs text-slate-500">{c.detalhe}</p>}
          </Card>
        ))}
      </div>

      {ehAdmin && (
        <div className="mb-4">
          <ReceitaCard />
        </div>
      )}

      {ehAdmin && (
        <div className="mb-4">
          <MonitorReceitaCard />
        </div>
      )}

      {ehAdmin && (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
              <Landmark className="h-4 w-4" /> Enviar guias da Receita
            </h2>
            <p className="mb-3 text-sm text-slate-500">
              DAS e DARF só a Receita Federal emite. Envie aqui o PDF que saiu do PGDAS-D ou da DCTFWeb: o sistema lê o vencimento, o valor, a linha digitável e a
              composição por tributo, e confere se a guia é mesmo desta empresa.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50/40">
              {enviando ? <Spinner /> : <Upload className="h-6 w-6 text-slate-400" />}
              <span className="text-sm font-medium text-slate-700">{enviando ? 'Lendo as guias…' : 'Clique para escolher os PDFs'}</span>
              <span className="text-xs text-slate-500">Pode enviar vários de uma vez · até 7 MB cada</span>
              <input ref={entrada} type="file" accept="application/pdf" multiple className="sr-only" disabled={enviando} onChange={(e) => void enviar(e.target.files)} />
            </label>
          </Card>
          <HonorariosCard />
        </div>
      )}

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Campo label="Situação" className="sm:col-span-2">
            <Select value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
              <option value="pendentes">A pagar</option>
              <option value="pagas">Pagas</option>
              <option value="todas">Todas</option>
            </Select>
          </Campo>
          <Campo label="Tipo" className="sm:col-span-2">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(TIPOS_GUIA).map(([c, t]) => (
                <option key={c} value={c}>
                  {t}
                </option>
              ))}
            </Select>
          </Campo>
        </div>
      </Card>

      {carregando ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : dados.length === 0 ? (
        <EstadoVazio titulo="Nenhuma guia ainda" descricao={ehAdmin ? 'Envie o PDF de um DAS ou DARF, ou gere um recibo de honorários.' : 'Quando o escritório enviar uma guia, ela aparece aqui.'} />
      ) : visiveis.length === 0 ? (
        <EstadoVazio titulo="Nada nesta situação" descricao="Troque o filtro para ver as outras guias." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Guia</th>
                <th className="px-4 py-3">Competência</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visiveis.map((g) => {
                const aberta = expandida === g.id
                return (
                  <Fragment key={g.id}>
                    <tr className={`cursor-pointer ${aberta ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={() => setExpandida(aberta ? null : g.id)}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">{TIPOS_GUIA[g.tipo]}</span>
                        {g.descricao && <span className="mt-0.5 block text-xs text-slate-500">{g.descricao}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{periodoLegivel(g.periodo)}</td>
                      <td className="px-4 py-3 text-slate-600">{dataBr(g.vencimento)}</td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{g.valor !== undefined ? formatBRL(g.valor) : '—'}</td>
                      <td className="px-4 py-3">
                        <SeloVencimento guia={g} />
                        {duplicadas.has(g.id) && (
                          <span className="mt-1 block">
                            <Badge tom="vermelho">Mesmo débito de outra guia</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400">{aberta ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />}</td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <DetalheGuia
                            guia={g}
                            receitaDoPeriodo={g.periodo ? (receitaPorPeriodo.get(g.periodo) ?? null) : null}
                            ehAdmin={ehAdmin}
                            ocupado={ocupado}
                            aoMarcar={(x, paga, data) => void marcar(x, paga, data)}
                            aoExcluir={(x) => void excluir(x)}
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
    </>
  )
}
