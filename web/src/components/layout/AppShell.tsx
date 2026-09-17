import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { FileSpreadsheet, LayoutDashboard, LogOut, Menu, ScanLine, Settings, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta } from '../ui'
import { cn, formatCpfCnpj } from '../../lib/utils'
import { PAPEIS } from '../../types'
import { IconeMarca } from '../Marca'

const itens = [
  { para: '/', rotulo: 'Painel', Icone: LayoutDashboard, fim: true },
  { para: '/notas-fiscais', rotulo: 'Notas fiscais (NF-e)', Icone: ScanLine, fim: undefined },
  { para: '/notas-servico', rotulo: 'Notas de serviço', Icone: FileSpreadsheet, fim: undefined },
  { para: '/configuracoes', rotulo: 'Configurações', Icone: Settings, fim: undefined },
]

export function AppShell() {
  const { empresa, membro, user, sair, erroEmpresa } = useAuth()
  const [aberto, setAberto] = useState(false)

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {itens.map(({ para, rotulo, Icone, fim }) => (
        <NavLink
          key={para}
          to={para}
          end={fim}
          onClick={() => setAberto(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          <Icone className="h-4 w-4" />
          {rotulo}
        </NavLink>
      ))}
    </nav>
  )

  const rodape = (
    <div className="border-t border-slate-200 p-3">
      <div className="mb-2 px-3">
        <p className="truncate text-sm font-medium text-slate-900">{membro?.nome ?? user?.displayName ?? user?.email}</p>
        <p className="truncate text-xs text-slate-500">
          {membro ? PAPEIS[membro.papel] : ''}
          {membro && user?.email ? ' · ' : ''}
          {user?.email}
        </p>
      </div>
      <button
        onClick={() => void sair()}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <LogOut className="h-4 w-4" />
        Sair
      </button>
    </div>
  )

  const marca = (
    <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
      <IconeMarca className="h-8 w-8 shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{empresa?.nome ?? 'Contabilidade'}</p>
        {empresa?.cnpj && <p className="truncate text-xs text-slate-500">{formatCpfCnpj(empresa.cnpj)}</p>}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {marca}
        <div className="flex flex-1 flex-col py-4">{nav}</div>
        {rodape}
      </aside>

      {/* Sidebar mobile */}
      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setAberto(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <div className="flex-1">{marca}</div>
              <button aria-label="Fechar menu" onClick={() => setAberto(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col py-4">{nav}</div>
            {rodape}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button aria-label="Abrir menu" onClick={() => setAberto(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-semibold">{empresa?.nome}</span>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {/* sem a empresa carregada nenhuma listagem funciona: melhor dizer o porquê */}
            {erroEmpresa && (
              <div className="mb-4">
                <Alerta tipo="erro">
                  {erroEmpresa === 'nao-encontrada'
                    ? 'Seu usuário aponta para uma empresa que não existe mais no banco. Saia e entre de novo para cadastrar a empresa.'
                    : erroEmpresa === 'sem-permissao'
                      ? 'Sem permissão para ler os dados desta empresa. Confira se o seu usuário ainda consta como membro dela.'
                      : 'Não foi possível carregar os dados da empresa. Verifique a conexão e recarregue a página.'}
                </Alerta>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
