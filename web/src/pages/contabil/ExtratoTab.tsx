import { useRef, useState } from 'react'
import { orderBy, limit } from 'firebase/firestore'
import { Check, EyeOff, RotateCcw, Upload } from 'lucide-react'
import { useColecao } from '../../services/firestore'
import { Alerta, Badge, Botao, Campo, Card, EstadoVazio, Input, Spinner } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { dataBr } from '../../lib/escritorio'
import { chamar, mensagem, type Conta, type Movimento } from '../../lib/contabil'
import { SeletorDeConta } from './SeletorDeConta'

interface ResultadoImportacao {
  novas: number
  repetidas: number
  sugeridas: number
  de?: string
  ate?: string
  saldoFinal?: number
}

function paraBase64(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader()
    leitor.onload = () => ok(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'))
    leitor.readAsDataURL(arquivo)
  })
}

function LinhaMovimento({ m, contas, aoErro }: { m: Movimento & { id: string }; contas: Conta[]; aoErro: (t: string | null) => void }) {
  const [conta, setConta] = useState(m.contaSugerida ?? '')
  const [historico, setHistorico] = useState('')
  const [lembrar, setLembrar] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const nomeDa = (codigo?: string) => contas.find((c) => c.codigo === codigo)?.nome ?? codigo

  async function agir(acao: 'conciliar' | 'ignorar' | 'restaurar' | 'desfazer') {
    setOcupado(acao)
    aoErro(null)
    try {
      await chamar('conciliarMovimento', { extratoId: m.id, acao, conta, historico, lembrar })
    } catch (e) {
      aoErro(mensagem(e, 'Não foi possível concluir.'))
    } finally {
      setOcupado(null)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{m.memo || 'Sem descrição'}</p>
          <p className="text-xs text-slate-500">
            {dataBr(m.data)} · {nomeDa(m.contaBanco)}
            {m.documento ? ` · doc ${m.documento}` : ''}
          </p>
        </div>
        <p className={`shrink-0 text-right text-sm font-semibold tabular-nums ${m.valor >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBRL(m.valor)}</p>
      </div>

      {m.situacao === 'pendente' ? (
        <div className="mt-2 grid grid-cols-1 items-center gap-2 lg:grid-cols-12">
          <SeletorDeConta className="h-9 lg:col-span-5" contas={contas} value={conta} onChange={(e) => setConta(e.target.value)} filtro={(c) => c.codigo !== m.contaBanco} vazio={m.valor >= 0 ? 'De onde veio este dinheiro?' : 'Para onde foi este dinheiro?'} />
          <Input className="h-9 lg:col-span-4" placeholder="Histórico (em branco: o texto do banco)" value={historico} onChange={(e) => setHistorico(e.target.value)} maxLength={200} />
          <div className="flex flex-wrap items-center gap-2 lg:col-span-3 lg:justify-end">
            <Botao tamanho="sm" disabled={!conta} carregando={ocupado === 'conciliar'} onClick={() => void agir('conciliar')}>
              <Check className="h-3.5 w-3.5" /> Lançar
            </Botao>
            <Botao tamanho="sm" variante="fantasma" carregando={ocupado === 'ignorar'} onClick={() => void agir('ignorar')} title="Não vira lançamento (ex.: transferência entre contas próprias já lançada)">
              <EyeOff className="h-3.5 w-3.5" /> Ignorar
            </Botao>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 lg:col-span-12">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
            Lembrar: sugerir esta conta quando o banco trouxer este mesmo texto
            {m.contaSugerida && <Badge tom="roxo">sugestão de uma conciliação anterior</Badge>}
          </label>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600">{m.situacao === 'conciliada' ? `Lançado em ${m.conta} · ${nomeDa(m.conta)}` : 'Ignorada: não gerou lançamento'}</p>
          <Botao tamanho="sm" variante="fantasma" carregando={ocupado !== null} onClick={() => void agir(m.situacao === 'conciliada' ? 'desfazer' : 'restaurar')}>
            <RotateCcw className="h-3.5 w-3.5" /> {m.situacao === 'conciliada' ? 'Desfazer' : 'Restaurar'}
          </Botao>
        </div>
      )}
    </li>
  )
}

/** Importa o OFX do banco e transforma cada movimentação em lançamento, uma conta por vez. */
export function ExtratoTab({ contas }: { contas: Conta[] }) {
  const movimentos = useColecao<Movimento>('extrato', [orderBy('data', 'desc'), limit(500)])
  const bancos = contas.filter((c) => c.analitica && c.disponivel)
  const [contaBanco, setContaBanco] = useState('1.1.1.02')
  const [situacao, setSituacao] = useState<'pendente' | 'conciliada' | 'ignorada'>('pendente')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  async function importar(arquivo?: File) {
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    setResultado(null)
    try {
      if (arquivo.size > 5 * 1024 * 1024) throw new Error('Arquivo grande demais: o limite é 5 MB. Exporte um período menor.')
      setResultado(await chamar<ResultadoImportacao>('importarExtratoOfx', { contaBanco, conteudoBase64: await paraBase64(arquivo) }))
      setSituacao('pendente')
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível importar o extrato.'))
    } finally {
      setEnviando(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  const visiveis = movimentos.dados.filter((m) => m.situacao === situacao)
  const pendentes = movimentos.dados.filter((m) => m.situacao === 'pendente').length

  return (
    <>
      <Card className="mb-4">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-6">
          <Campo label="Extrato de qual conta?" className="sm:col-span-3">
            <SeletorDeConta contas={bancos} value={contaBanco} onChange={(e) => setContaBanco(e.target.value)} vazio="Escolha o banco ou caixa…" />
          </Campo>
          <div className="sm:col-span-3">
            <input ref={entrada} type="file" accept=".ofx,.OFX" className="hidden" onChange={(e) => void importar(e.target.files?.[0])} />
            <Botao carregando={enviando} disabled={!contaBanco} onClick={() => entrada.current?.click()}>
              <Upload className="h-4 w-4" /> Importar extrato (OFX)
            </Botao>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">No site do banco, exporte o extrato em OFX (às vezes aparece como "Money"). Importar o mesmo período de novo não duplica nada. Tem mais de um banco? Crie uma conta para cada um na aba Plano de contas.</p>
        {resultado && (
          <div className="mt-3">
            <Alerta tipo="sucesso">
              {resultado.novas} {resultado.novas === 1 ? 'movimentação nova' : 'movimentações novas'}
              {resultado.repetidas ? `, ${resultado.repetidas} que já estavam aqui` : ''}
              {resultado.de && resultado.ate ? ` · período de ${dataBr(resultado.de)} a ${dataBr(resultado.ate)}` : ''}
              {resultado.saldoFinal !== undefined ? ` · saldo final no banco: ${formatBRL(resultado.saldoFinal)}` : ''}
              {resultado.sugeridas ? ` · ${resultado.sugeridas} já com conta sugerida` : ''}.
            </Alerta>
          </div>
        )}
      </Card>

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          {(['pendente', 'conciliada', 'ignorada'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSituacao(s)} className={`rounded-full px-3 py-1 text-sm font-medium ${situacao === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {s === 'pendente' ? `A conciliar${pendentes ? ` (${pendentes})` : ''}` : s === 'conciliada' ? 'Conciliadas' : 'Ignoradas'}
            </button>
          ))}
        </div>
        {movimentos.carregando ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : visiveis.length === 0 ? (
          <div className="p-6">
            <EstadoVazio titulo={situacao === 'pendente' ? 'Nada a conciliar' : 'Nada por aqui'} descricao={situacao === 'pendente' ? 'Importe o extrato do banco para começar.' : undefined} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visiveis.map((m) => (
              <LinhaMovimento key={m.id} m={m} contas={contas} aoErro={setErro} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
