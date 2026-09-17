import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta, Botao, Campo, Input } from '../../components/ui'
import { BotoesSociais } from '../../components/BotoesSociais'
import { traduzirErroAuth } from '../../lib/utils'
import { AuthLayout } from './AuthLayout'

const schema = z.object({
  email: z.string().email('Informe um e-mail válido'),
  senha: z.string().min(1, 'Informe a senha'),
})
type Form = z.infer<typeof schema>

export function Login() {
  const { entrar, recuperarSenha } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  const destino = (location.state as { de?: string } | null)?.de ?? '/'

  async function onSubmit(dados: Form) {
    setErro(null)
    try {
      await entrar(dados.email, dados.senha)
      navigate(destino, { replace: true })
    } catch (e) {
      setErro(e instanceof FirebaseError ? traduzirErroAuth(e.code) : 'Não foi possível entrar.')
    }
  }

  async function esqueciSenha() {
    const email = getValues('email')
    if (!email) {
      setErro('Informe seu e-mail para recuperar a senha.')
      return
    }
    setErro(null)
    try {
      await recuperarSenha(email)
      setAviso('Enviamos um link de redefinição de senha para o seu e-mail.')
    } catch (e) {
      setErro(e instanceof FirebaseError ? traduzirErroAuth(e.code) : 'Falha ao enviar e-mail.')
    }
  }

  return (
    <AuthLayout titulo="Entrar" subtitulo="Acesse o painel da sua empresa">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {erro && <Alerta>{erro}</Alerta>}
        {aviso && <Alerta tipo="sucesso">{aviso}</Alerta>}

        <Campo label="E-mail" erro={errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="voce@empresa.com.br" {...register('email')} />
        </Campo>
        <Campo label="Senha" erro={errors.senha?.message}>
          <Input type="password" autoComplete="current-password" {...register('senha')} />
        </Campo>

        <Botao type="submit" carregando={isSubmitting} className="mt-2 w-full">
          Entrar
        </Botao>

        <button
          type="button"
          onClick={() => void esqueciSenha()}
          className="text-center text-sm text-indigo-600 hover:underline"
        >
          Esqueci minha senha
        </button>

        <BotoesSociais onErro={(m) => setErro(m || null)} onSucesso={() => navigate(destino, { replace: true })} />
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Ainda não tem conta?{' '}
        <Link to="/cadastro" className="font-medium text-indigo-600 hover:underline">
          Criar conta
        </Link>
      </p>
    </AuthLayout>
  )
}
