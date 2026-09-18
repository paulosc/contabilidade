import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { orderBy, limit } from 'firebase/firestore'
import { HandCoins, Save, Trash2 } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useColecao } from '../../services/firestore'
import { confirmar } from '../../components/Dialogo'
import { Alerta, Badge, Botao, Campo, Card, Input } from '../../components/ui'
import { formatBRL, formatCpfCnpj, validarCpf } from '../../lib/utils'
import { dataBr, mesLegivel, numero } from '../../lib/escritorio'

interface Lucro {
  socioNome: string
  socioCpf: string
  data: string
  competencia: string
  valor: number
  excecao2025: boolean
  irrfRetido: number
  liquido: number
  observacao?: string
}

// Espelho de functions/src/folha/lucros.ts — a retenção de cada pagamento é calculada lá;
// aqui só se resume o mês para mostrar se ficou algo por reter.
const LIMITE = 50_000
const resumoDoMes = (competencia: string, pagamentos: Lucro[]) => {
  const sujeito = pagamentos.filter((p) => !p.excecao2025).reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100
  const retido = pagamentos.reduce((s, p) => s + Math.round(p.irrfRetido * 100), 0) / 100
  const devido = competencia >= '2026-01' && sujeito > LIMITE ? Math.round(sujeito * 10) / 100 : 0
  return { sujeito, retido, devido, falta: Math.round((devido - retido) * 100) / 100, folga: Math.max(0, LIMITE - sujeito) }
}

const esquema = z.object({
  socioNome: z.string().trim().min(3, 'Informe o nome do sócio'),
  socioCpf: z.string().refine(validarCpf, 'CPF inválido'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data'),
  valor: z.string().refine((v) => numero(v) > 0, 'Informe o valor'),
  excecao2025: z.boolean(),
  observacao: z.string().trim().max(300),
})
type Form = z.infer<typeof esquema>

const hoje = () => new Date().toLocaleDateString('en-CA')

/**
 * Lucros distribuídos por sócio. Desde 2026, passar de R$ 50 mil no mês para o mesmo sócio
 * obriga a reter 10% sobre o total do mês (Lei 9.250/1995, art. 6º-A).
 */
export function LucrosCard() {
  const lucros = useColecao<Lucro>('lucros', [orderBy('data', 'desc'), limit(300)])
  const [salvando, setSalvando] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null)
  const form = useForm<Form>({ resolver: zodResolver(esquema), defaultValues: { socioNome: '', socioCpf: '', data: hoje(), valor: '', excecao2025: false, observacao: '' } })

  async function registrar(v: Form) {
    setSalvando(true)
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, { irrf: number; liquido: number; mes: { folgaAteOLimite: number; diferenca: number } }>(functions, 'registrarLucroDistribuido')({ ...v, valor: numero(v.valor), observacao: v.observacao || null })
      const { irrf, liquido, mes } = r.data
      setMsg({
        texto: irrf
          ? `Reter ${formatBRL(irrf)} de IR neste pagamento (DARF 1841-01): o sócio recebe ${formatBRL(liquido)}. A retenção considera tudo o que ele já recebeu no mês.${mes.diferenca > 0 ? ` Ainda ficam ${formatBRL(mes.diferenca)} por recolher.` : ''}`
          : v.excecao2025
            ? 'Registrado sem retenção: lucro enquadrado na exceção dos resultados até 2025.'
            : `Registrado sem retenção. O sócio ainda pode receber ${formatBRL(mes.folgaAteOLimite)} neste mês sem disparar o IR de 10%.`,
      })
      form.reset({ socioNome: v.socioNome, socioCpf: v.socioCpf, data: v.data, valor: '', excecao2025: false, observacao: '' })
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : 'Não foi possível registrar.', erro: true })
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(l: Lucro & { id: string }) {
    if (!(await confirmar(`Excluir o pagamento de ${formatBRL(l.valor)} a ${l.socioNome}, de ${dataBr(l.data)}? A retenção dos outros pagamentos do mês não é refeita sozinha.`))) return
    setExcluindo(l.id)
    try {
      await httpsCallable(functions, 'excluirLucroDistribuido')({ lucroId: l.id })
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : 'Não foi possível excluir.', erro: true })
    } finally {
      setExcluindo(null)
    }
  }

  // um bloco por sócio e mês, do mais recente ao mais antigo
  const grupos = new Map<string, Array<Lucro & { id: string }>>()
  for (const l of lucros.dados) grupos.set(`${l.competencia}|${l.socioCpf}`, [...(grupos.get(`${l.competencia}|${l.socioCpf}`) ?? []), l])
  const chaves = [...grupos.keys()].sort((a, b) => b.localeCompare(a))
  const erros = form.formState.errors

  return (
    <Card className="mt-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <HandCoins className="h-4 w-4" /> Lucros distribuídos aos sócios
      </h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Desde janeiro de 2026, quando a empresa paga ao mesmo sócio mais de R$ 50.000,00 de lucros no mês, retém 10% de IR <strong>sobre o total do mês</strong>, sem deduções (Lei 9.250/1995, art. 6º-A). A lei não abre exceção para o
        Simples Nacional. Registre cada pagamento: o sistema diz quanto reter.
      </p>

      {msg && (
        <div className="mb-4">
          <Alerta tipo={msg.erro ? 'erro' : 'sucesso'}>{msg.texto}</Alerta>
        </div>
      )}

      <form onSubmit={form.handleSubmit(registrar)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <Campo label="Sócio" className="sm:col-span-2" erro={erros.socioNome?.message} obrigatorio>
          <Input {...form.register('socioNome')} />
        </Campo>
        <Campo label="CPF" className="sm:col-span-2" erro={erros.socioCpf?.message} obrigatorio>
          <Input inputMode="numeric" placeholder="000.000.000-00" {...form.register('socioCpf')} />
        </Campo>
        <Campo label="Data do pagamento" className="sm:col-span-1" erro={erros.data?.message} obrigatorio>
          <Input type="date" {...form.register('data')} />
        </Campo>
        <Campo label="Valor (R$)" className="sm:col-span-1" erro={erros.valor?.message} obrigatorio>
          <Input inputMode="decimal" placeholder="0,00" {...form.register('valor')} />
        </Campo>
        <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-6">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...form.register('excecao2025')} />
          <span>
            Lucro de resultado apurado até 2025, com distribuição aprovada até 31/12/2025
            <span className="block text-xs text-slate-500">Fica fora da retenção (art. 6º-A, § 3º), desde que pago como previsto no ato de aprovação. Guarde a ata: é ela que prova o enquadramento.</span>
          </span>
        </label>
        <Campo label="Observação" className="sm:col-span-5">
          <Input placeholder="Opcional: ata, período do resultado…" {...form.register('observacao')} />
        </Campo>
        <div className="sm:col-span-1 sm:pt-7">
          <Botao type="submit" carregando={salvando}>
            <Save className="h-4 w-4" /> Registrar
          </Botao>
        </div>
      </form>

      {chaves.length > 0 && (
        <div className="mt-6 space-y-4">
          {chaves.map((chave) => {
            const itens = grupos.get(chave)!
            const [competencia] = chave.split('|')
            const r = resumoDoMes(competencia, itens)
            return (
              <div key={chave} className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">
                    {itens[0].socioNome} <span className="font-normal text-slate-500">· {formatCpfCnpj(itens[0].socioCpf)} · {mesLegivel(competencia)}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-600">no mês: {formatBRL(r.sujeito)}</span>
                    {r.devido > 0 ? <Badge tom="amarelo">IR devido: {formatBRL(r.devido)}</Badge> : r.folga < LIMITE * 0.2 ? <Badge tom="amarelo">faltam {formatBRL(r.folga)} para o limite</Badge> : <Badge tom="verde">sem retenção</Badge>}
                    {r.falta > 0 && <Badge tom="vermelho">falta reter {formatBRL(r.falta)}</Badge>}
                  </div>
                </div>
                <ul className="divide-y divide-slate-100 text-sm">
                  {itens.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        {dataBr(l.data)} · <span className="tabular-nums">{formatBRL(l.valor)}</span>
                        {l.irrfRetido > 0 && <span className="text-slate-500"> − IR {formatBRL(l.irrfRetido)} = {formatBRL(l.liquido)}</span>}
                        {l.excecao2025 && <span className="ml-2 text-xs text-slate-500">resultado até 2025</span>}
                        {l.observacao && <span className="ml-2 text-xs text-slate-500">— {l.observacao}</span>}
                      </span>
                      <Botao tamanho="sm" variante="fantasma" carregando={excluindo === l.id} onClick={() => void excluir(l)} aria-label="Excluir pagamento">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Botao>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">
        O IR retido vai no DARF 1841-01, com vencimento no último dia útil do 2º decêndio do mês seguinte; o pagamento é informado no R-4010 da EFD-Reinf e confessado na DCTFWeb. No Simples, sem escrituração contábil a
        isenção do lucro distribuído se limita à presunção da Lei 9.249 menos o DAS; com escrituração que evidencie lucro maior, vale o lucro contábil (LC 123, art. 14) — veja o resultado em Contabilidade.
      </p>
    </Card>
  )
}
