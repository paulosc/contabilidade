import { useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { useAuth, type ProvedorSocial } from '../auth/AuthProvider'
import { traduzirErroAuth } from '../lib/utils'
import { Botao } from './ui'

function LogoGoogle() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1 2.4-2 3.1l3.3 2.6c1.9-1.8 3-4.4 3-7.5 0-.7-.1-1.4-.2-2.1H12z" />
      <path fill="#34A853" d="M5.3 14.3l-.8.6-2.6 2C3.6 20.3 7.5 22.5 12 22.5c2.9 0 5.3-.9 7-2.6l-3.3-2.6c-.9.6-2.1 1-3.7 1-2.8 0-5.2-1.9-6.1-4.5z" />
      <path fill="#4A90E2" d="M1.9 7.1C1.1 8.6.7 10.2.7 12s.4 3.4 1.2 4.9c0 0 3.4-2.6 3.4-2.6-.2-.7-.4-1.4-.4-2.3s.1-1.6.4-2.3z" />
      <path fill="#FBBC05" d="M12 5.2c1.6 0 3 .5 4.1 1.6l3-3C17.3 2.1 14.9 1.5 12 1.5 7.5 1.5 3.6 3.7 1.9 7.1l3.4 2.6C6.2 7.1 8.9 5.2 12 5.2z" />
    </svg>
  )
}

function LogoApple() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.3.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1.1-2.8-4.1zM14 5.3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  )
}

/** Botões "Continuar com Google/Apple" com separador. Erros vão para o callback. */
export function BotoesSociais({
  onErro,
  onSucesso,
}: {
  onErro: (mensagem: string) => void
  onSucesso: () => void
}) {
  const { entrarComProvedor } = useAuth()
  const [carregando, setCarregando] = useState<ProvedorSocial | null>(null)

  async function clicar(provedor: ProvedorSocial) {
    setCarregando(provedor)
    onErro('')
    try {
      await entrarComProvedor(provedor)
      onSucesso()
    } catch (e) {
      onErro(
        e instanceof FirebaseError
          ? traduzirErroAuth(e.code)
          : `Não foi possível entrar com ${provedor === 'google' ? 'o Google' : 'a Apple'}.`,
      )
    } finally {
      setCarregando(null)
    }
  }

  return (
    <>
      <div className="relative my-2 flex items-center">
        <div className="flex-1 border-t border-slate-200" />
        <span className="px-3 text-xs text-slate-400 uppercase">ou</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>
      <div className="flex flex-col gap-2">
        <Botao
          type="button"
          variante="secundario"
          carregando={carregando === 'google'}
          disabled={carregando !== null}
          onClick={() => void clicar('google')}
          className="w-full"
        >
          {carregando !== 'google' && <LogoGoogle />}
          Continuar com Google
        </Botao>
        <Botao
          type="button"
          variante="secundario"
          carregando={carregando === 'apple'}
          disabled={carregando !== null}
          onClick={() => void clicar('apple')}
          className="w-full"
        >
          {carregando !== 'apple' && <LogoApple />}
          Continuar com Apple
        </Botao>
      </div>
    </>
  )
}
