import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Building2, Check, ChevronsUpDown, FileSpreadsheet, Landmark, LayoutDashboard, LogOut, Menu, Plus, ScanLine, Settings, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta } from '../ui'
import { cn, formatCpfCnpj } from '../../lib/utils'
import { PAPEIS } from '../../types'
import { IconeMarca } from '../Marca'

const itens = [
  { para: '/', rotulo: 'Painel', Icone: LayoutDashboard, fim: true },
  { para: '/notas-fiscais', rotulo: 'Notas fiscais (NF-e)', Icone: ScanLine, fim: undefined },
  { para: '/notas-servico', rotulo: 'Notas de serviço', Icone: FileSpreadsheet, fim: undefined },
  { para: '/guias', rotulo: 'Guias a pagar', Icone: Landmark, fim: undefined },
  { para: '/configuracoes', rotulo: 'Configurações', Icone: Settings, fim: undefined },
]

export function AppShell() {
  const { empresa, membro, user, sair, erroEmpresa, empresas, trocarEmpresa } = useAuth()
  const [aberto, setAberto] = useState(false)
  const [trocando, setTrocando] = useState(false)

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

  // Escritório de contabilidade: o mesmo usuário administra várias empresas.
  const seletor = (
    <div className="relative border-b border-slate-200">
      <button
        onClick={() => setTrocando((v) => !v)}
        className="flex h-16 w-full items-center gap-2 px-5 text-left transition-colors hover:bg-slate-50"
        aria-expanded={trocando}
      >
        <IconeMarca className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{empresa?.nome ?? 'Escolha a empresa'}</p>
          <p className="truncate text-xs text-slate-500">
            {empresa?.cnpj ? formatCpfCnpj(empresa.cnpj) : `${empresas.length} empresa(s)`}
          </p>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {trocando && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setTrocando(false)} />
          <div className="absolute inset-x-2 top-[3.75rem] z-20 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            {empresas.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Nenhuma empresa ainda.</p>}
            {empresas.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setTrocando(false)
                  setAberto(false)
                  if (e.empresaId !== empresa?.id) void trocarEmpresa(e.empresaId)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100',
                  e.empresaId === empresa?.id && 'bg-indigo-50',
                )}
              >
                <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{e.nome}</span>
                  {e.cnpj && <span className="block truncate text-xs text-slate-500">{formatCpfCnpj(e.cnpj)}</span>}
                </span>
                {e.empresaId === empresa?.id && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
              </button>
            ))}
            <Link
              to="/empresas/nova"
              onClick={() => {
                setTrocando(false)
                setAberto(false)
              }}
              className="mt-1 flex items-center gap-2 rounded-lg border-t border-slate-100 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
            >
              <Plus className="h-4 w-4" /> Adicionar empresa
            </Link>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="flex min-h-screen">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {seletor}
        <div className="flex flex-1 flex-col py-4">{nav}</div>
        {rodape}
      </aside>

      {/* Sidebar mobile */}
      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setAberto(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <div className="flex-1">{seletor}</div>
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
