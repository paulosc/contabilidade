import { useState, type ComponentProps } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { ClipboardList, Pencil, Save, X } from 'lucide-react'
import { db } from '../../lib/firebase'
import { useAuth } from '../../auth/AuthProvider'
import { useDocumento } from '../../services/firestore'
import { Alerta, Botao, Campo, Card, Input, Select } from '../../components/ui'
import { ANEXOS, REGIMES, mesLegivel, type PerfilFiscal } from '../../lib/escritorio'

const esquema = z
  .object({
    regime: z.enum(['', 'simples', 'mei', 'presumido', 'real']),
    anexo: z.enum(['', 'I', 'II', 'III', 'IV', 'V']),
    sujeitoAoFatorR: z.boolean(),
    inicioAtividade: z.string().refine((v) => !v || /^\d{4}-\d{2}$/.test(v), 'Informe mês e ano'),
    temEmpregados: z.boolean(),
    temProLabore: z.boolean(),
    temReinf: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.regime) ctx.addIssue({ code: 'custom', path: ['regime'], message: 'Escolha o regime tributário' })
    if (v.regime === 'simples' && !v.anexo) ctx.addIssue({ code: 'custom', path: ['anexo'], message: 'Escolha o anexo da atividade principal' })
  })
type Form = z.infer<typeof esquema>

const Marcador = ({ rotulo, dica, ...props }: { rotulo: string; dica?: string } & ComponentProps<'input'>) => (
  <label className="flex items-start gap-2 text-sm text-slate-700">
    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...props} />
    <span>
      {rotulo}
      {dica && <span className="block text-xs text-slate-500">{dica}</span>}
    </span>
  </label>
)

/**
 * Perfil fiscal do cliente: regime, anexo e o que ele tem (empregados, pró-labore, Reinf).
 * É o que decide quais obrigações entram no calendário e como o Simples é conferido.
 */
export function PerfilFiscalCard({ aoSalvar }: { aoSalvar?: () => void }) {
  const { empresa, membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const { dado: perfil, carregando } = useDocumento<PerfilFiscal>('configuracoes', 'perfilFiscal')
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const form = useForm<Form>({
    resolver: zodResolver(esquema),
    values: {
      regime: perfil?.regime ?? '',
      anexo: perfil?.anexo ?? '',
      sujeitoAoFatorR: perfil?.sujeitoAoFatorR ?? false,
      inicioAtividade: perfil?.inicioAtividade ?? '',
      temEmpregados: perfil?.temEmpregados ?? false,
      temProLabore: perfil?.temProLabore ?? false,
      temReinf: perfil?.temReinf ?? false,
    },
  })
  const regime = form.watch('regime')

  async function salvar(v: Form) {
    if (!empresa) return
    setSalvando(true)
    setErro(null)
    try {
      await setDoc(
        doc(db, 'empresas', empresa.id, 'configuracoes', 'perfilFiscal'),
        {
          regime: v.regime,
          anexo: v.regime === 'simples' ? v.anexo : null,
          sujeitoAoFatorR: v.regime === 'simples' && v.sujeitoAoFatorR,
          inicioAtividade: v.inicioAtividade || null,
          temEmpregados: v.temEmpregados,
          temProLabore: v.temProLabore,
          temReinf: v.temReinf,
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      )
      setEditando(false)
      aoSalvar?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return null
  const configurado = Boolean(perfil?.regime)
  const resumo = perfil?.regime
    ? [
        REGIMES[perfil.regime],
        perfil.regime === 'simples' && perfil.anexo ? `Anexo ${perfil.anexo}${perfil.sujeitoAoFatorR ? ' com Fator R' : ''}` : '',
        perfil.temEmpregados ? 'com empregados' : '',
        perfil.temProLabore ? 'com pró-labore' : '',
        perfil.temReinf ? 'com EFD-Reinf' : '',
        perfil.inicioAtividade ? `atividade desde ${mesLegivel(perfil.inicioAtividade)}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardList className="h-4 w-4" /> Perfil fiscal de {empresa?.nome}
        </h2>
        {configurado && ehAdmin && (
          <Botao tamanho="sm" variante="secundario" onClick={() => setEditando((v) => !v)}>
            {editando ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />} {editando ? 'Fechar edição' : 'Editar perfil fiscal'}
          </Botao>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {configurado ? resumo : 'Diga o regime e o que esta empresa tem. É isso que decide quais obrigações entram no calendário e como o Simples é conferido.'}
      </p>
      {!configurado && !ehAdmin && <p className="mt-2 text-sm text-amber-700">Só um administrador da empresa pode cadastrar o perfil fiscal.</p>}

      {erro && (
        <div className="mt-3">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {ehAdmin && (!configurado || editando) && (
        <form onSubmit={form.handleSubmit(salvar)} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Campo label="Regime tributário" className="sm:col-span-2" erro={form.formState.errors.regime?.message} obrigatorio>
            <Select {...form.register('regime')}>
              <option value="">Escolha…</option>
              {Object.entries(REGIMES).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Select>
          </Campo>
          {regime === 'simples' && (
            <Campo label="Anexo da atividade principal" className="sm:col-span-2" erro={form.formState.errors.anexo?.message} obrigatorio>
              <Select {...form.register('anexo')}>
                <option value="">Escolha…</option>
                {Object.entries(ANEXOS).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
          )}
          <Campo label="Início de atividade" className="sm:col-span-2" erro={form.formState.errors.inicioAtividade?.message} dica="Só importa se a empresa tem menos de 13 meses">
            <Input type="month" {...form.register('inicioAtividade')} />
          </Campo>
          <div className="grid grid-cols-1 gap-2 sm:col-span-6 sm:grid-cols-2">
            {regime === 'simples' && (
              <Marcador rotulo="Atividade sujeita ao Fator R" dica="Serviços do § 5º-I do art. 18: folha ÷ receita ≥ 28% tributa no Anexo III, senão no V" {...form.register('sujeitoAoFatorR')} />
            )}
            <Marcador rotulo="Tem empregados" dica="Entram salários, FGTS, eSocial, DCTFWeb e 13º" {...form.register('temEmpregados')} />
            <Marcador rotulo="Sócio retira pró-labore" dica="Entram eSocial, DCTFWeb e o DARF do INSS" {...form.register('temProLabore')} />
            <Marcador rotulo="Tem o que declarar na EFD-Reinf" dica="Retenções, aluguéis ou lucros distribuídos (R-4010)" {...form.register('temReinf')} />
          </div>
          <div className="sm:col-span-6">
            <Botao type="submit" tamanho="sm" carregando={salvando}>
              <Save className="h-3.5 w-3.5" /> Salvar perfil fiscal
            </Botao>
          </div>
        </form>
      )}
    </Card>
  )
}
