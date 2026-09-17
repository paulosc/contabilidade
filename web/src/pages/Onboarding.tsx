import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../auth/AuthProvider'
import { Alerta, Botao, Campo, Input, Select } from '../components/ui'
import { formatCpfCnpj, formatTelefone, somenteDigitos, validarCnpj } from '../lib/utils'
import { UFS } from '../lib/fiscal'
import { AuthLayout } from './auth/AuthLayout'

const schema = z.object({
  nome: z.string().min(2, 'Informe o nome da empresa'),
  // o CNPJ é o que será consultado na SEFAZ, então aqui ele é obrigatório
  cnpj: z.string().refine((v) => validarCnpj(v), 'CNPJ inválido'),
  uf: z.enum(UFS, { message: 'Escolha a UF' }),
  inscricaoEstadual: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
})
type Form = z.infer<typeof schema>

export function Onboarding() {
  const { criarEmpresa, user, sair } = useAuth()
  const navigate = useNavigate()
  const [erro, setErro] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: user?.email ?? '', uf: 'MG' },
  })

  async function onSubmit(dados: Form) {
    setErro(null)
    try {
      await criarEmpresa({
        nome: dados.nome.trim(),
        cnpj: somenteDigitos(dados.cnpj),
        uf: dados.uf,
        inscricaoEstadual: dados.inscricaoEstadual?.trim() || undefined,
        telefone: dados.telefone ? somenteDigitos(dados.telefone) : undefined,
        email: dados.email?.trim() || undefined,
      })
      navigate('/', { replace: true })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar a empresa.')
    }
  }

  return (
    <AuthLayout titulo="Cadastre sua empresa" subtitulo="É o CNPJ dela que será consultado na SEFAZ">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {erro && <Alerta>{erro}</Alerta>}

        <Campo label="Razão social" erro={errors.nome?.message} obrigatorio>
          <Input autoFocus placeholder="Minha Empresa Ltda" {...register('nome')} />
        </Campo>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo label="CNPJ" erro={errors.cnpj?.message} className="sm:col-span-2" obrigatorio>
            <Input
              inputMode="numeric"
              placeholder="00.000.000/0001-00"
              {...register('cnpj')}
              onChange={(e) => setValue('cnpj', formatCpfCnpj(e.target.value), { shouldValidate: true })}
            />
          </Campo>
          <Campo label="UF" erro={errors.uf?.message}>
            <Select {...register('uf')}>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Campo>
        </div>

        <Campo label="Inscrição estadual" erro={errors.inscricaoEstadual?.message} dica="Opcional">
          <Input {...register('inscricaoEstadual')} />
        </Campo>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Telefone" erro={errors.telefone?.message}>
            <Input
              inputMode="tel"
              placeholder="(31) 99999-9999"
              {...register('telefone')}
              onChange={(e) => setValue('telefone', formatTelefone(e.target.value))}
            />
          </Campo>
          <Campo label="E-mail" erro={errors.email?.message}>
            <Input type="email" {...register('email')} />
          </Campo>
        </div>

        <Botao type="submit" carregando={isSubmitting} className="mt-2 w-full">
          Criar empresa e entrar
        </Botao>

        <button type="button" onClick={() => void sair()} className="text-center text-sm text-slate-500 hover:underline">
          Sair desta conta
        </button>
      </form>
    </AuthLayout>
  )
}
