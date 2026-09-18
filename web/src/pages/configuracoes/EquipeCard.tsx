import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { Trash2, UserPlus } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useAuth } from '../../auth/AuthProvider'
import { useColecao } from '../../services/firestore'
import { confirmar } from '../../components/Dialogo'
import { Alerta, Badge, Botao, Campo, Card, Input, Select } from '../../components/ui'
import { PAPEIS, type Membro, type Papel } from '../../types'

const esquema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  papel: z.enum(['admin', 'contador', 'assistente', 'cliente']),
})
type Form = z.infer<typeof esquema>

const DESCRICAO: Record<Papel, string> = {
  admin: 'Tudo, inclusive certificado, Receita, folha e equipe',
  contador: 'Notas, guias, obrigações, Simples e documentos',
  assistente: 'Notas, guias, obrigações, Simples e documentos',
  cliente: 'Só guias, notas e documentos da própria empresa',
}

/** Quem tem acesso à empresa: a equipe do escritório e o próprio cliente. */
export function EquipeCard() {
  const { membro, user } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const membros = useColecao<Membro>('membros')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null)
  const form = useForm<Form>({ resolver: zodResolver(esquema), defaultValues: { email: '', papel: 'cliente' } })
  const papel = form.watch('papel')

  async function chamar(chave: string, nome: string, dados: unknown, sucesso: string) {
    setOcupado(chave)
    setMsg(null)
    try {
      await httpsCallable(functions, nome)(dados)
      setMsg({ texto: sucesso })
      return true
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : 'Não foi possível concluir.', erro: true })
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function adicionar(v: Form) {
    if (await chamar('adicionar', 'adicionarMembroDaEmpresa', v, `${v.email} agora tem acesso como ${PAPEIS[v.papel]}.`)) form.reset({ email: '', papel: v.papel })
  }

  async function remover(m: Membro & { id: string }) {
    if (!(await confirmar(`Tirar o acesso de ${m.nome} a esta empresa?`))) return
    await chamar(`remover-${m.id}`, 'alterarMembroDaEmpresa', { uid: m.id, remover: true }, `${m.nome} não tem mais acesso.`)
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">Equipe e acesso do cliente</h2>
      <p className="mb-4 text-sm text-slate-500">Quem tem acesso aos dados desta empresa. O papel "Cliente" é para o dono da empresa acompanhar guias, notas e documentos.</p>

      {msg && (
        <div className="mb-3">
          <Alerta tipo={msg.erro ? 'erro' : 'sucesso'}>{msg.texto}</Alerta>
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {membros.dados.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {m.nome} {m.id === user?.uid && <span className="text-xs font-normal text-slate-500">(você)</span>}
              </p>
              <p className="truncate text-xs text-slate-500">{m.email}</p>
            </div>
            {ehAdmin && m.id !== user?.uid ? (
              <div className="flex items-center gap-1">
                <Select
                  className="h-8 w-40"
                  value={m.papel}
                  disabled={ocupado === `papel-${m.id}`}
                  onChange={(e) => void chamar(`papel-${m.id}`, 'alterarMembroDaEmpresa', { uid: m.id, papel: e.target.value }, `${m.nome} agora é ${PAPEIS[e.target.value as Papel]}.`)}
                >
                  {Object.entries(PAPEIS).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
                <Botao tamanho="sm" variante="fantasma" carregando={ocupado === `remover-${m.id}`} onClick={() => void remover(m)} aria-label={`Remover ${m.nome}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Botao>
              </div>
            ) : (
              <Badge tom={m.papel === 'admin' ? 'roxo' : m.papel === 'cliente' ? 'azul' : 'neutro'}>{PAPEIS[m.papel]}</Badge>
            )}
          </li>
        ))}
      </ul>

      {ehAdmin && (
        <form onSubmit={form.handleSubmit(adicionar)} className="mt-4 grid grid-cols-1 items-start gap-3 border-t border-slate-200 pt-4 sm:grid-cols-6">
          <Campo label="E-mail da pessoa" className="sm:col-span-3" erro={form.formState.errors.email?.message} dica="Ela precisa já ter criado a conta no sistema com este e-mail">
            <Input type="email" placeholder="pessoa@empresa.com.br" {...form.register('email')} />
          </Campo>
          <Campo label="Papel" className="sm:col-span-2" dica={DESCRICAO[papel]}>
            <Select {...form.register('papel')}>
              {Object.entries(PAPEIS).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Select>
          </Campo>
          <div className="sm:col-span-1 sm:pt-7">
            <Botao type="submit" tamanho="md" carregando={ocupado === 'adicionar'}>
              <UserPlus className="h-4 w-4" /> Dar acesso
            </Botao>
          </div>
        </form>
      )}
    </Card>
  )
}
