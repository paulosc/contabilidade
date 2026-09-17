import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta, Botao, Campo, Input } from '../../components/ui'
import { BotoesSociais } from '../../components/BotoesSociais'
import { traduzirErroAuth } from '../../lib/utils'
import { AuthLayout } from './AuthLayout'

const schema = z
  .object({
    nome: z.string().min(3, 'Informe seu nome completo'),
    email: z.string().email('Informe um e-mail válido'),
    senha: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres'),
    confirmar: z.string(),
  })
  .refine((d) => d.senha === d.confirmar, {
    path: ['confirmar'],
    message: 'As senhas não conferem',
  })
type Form = z.infer<typeof schema>

export function Cadastro() {
  const { cadastrar } = useAuth()
  const navigate = useNavigate()
  const [erro, setErro] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  async function onSubmit(dados: Form) {
    setErro(null)
    try {
      await cadastrar(dados.nome.trim(), dados.email, dados.senha)
      navigate('/onboarding', { replace: true })
    } catch (e) {
      setErro(e instanceof FirebaseError ? traduzirErroAuth(e.code) : 'Não foi possível criar a conta.')
    }
  }

  return (
    <AuthLayout titulo="Criar conta" subtitulo="Em seguida você cadastra a sua empresa">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {erro && <Alerta>{erro}</Alerta>}

        <Campo label="Nome completo" erro={errors.nome?.message}>
          <Input autoComplete="name" {...register('nome')} />
        </Campo>
        <Campo label="E-mail" erro={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Campo>
        <Campo label="Senha" erro={errors.senha?.message}>
          <Input type="password" autoComplete="new-password" {...register('senha')} />
        </Campo>
        <Campo label="Confirmar senha" erro={errors.confirmar?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirmar')} />
        </Campo>

        <Botao type="submit" carregando={isSubmitting} className="mt-2 w-full">
          Criar conta
        </Botao>

        <BotoesSociais onErro={(m) => setErro(m || null)} onSucesso={() => navigate('/', { replace: true })} />
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  )
}
