import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { TelaCarregando } from '../components/ui'

/** Exige usuário logado E vinculado a uma empresa. */
export function RequireAuth() {
  const { user, perfil, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <TelaCarregando />
  if (!user) return <Navigate to="/login" state={{ de: location.pathname }} replace />
  if (!perfil?.empresaId) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** Exige usuário logado, mas ainda SEM empresa (tela de onboarding). */
export function RequireSemEmpresa() {
  const { user, perfil, carregando } = useAuth()
  if (carregando) return <TelaCarregando />
  if (!user) return <Navigate to="/login" replace />
  if (perfil?.empresaId) return <Navigate to="/" replace />
  return <Outlet />
}

/** Páginas públicas (login/cadastro): redireciona quem já está logado. */
export function SomenteDeslogado() {
  const { user, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <TelaCarregando />
  if (user) {
    const de = (location.state as { de?: string } | null)?.de
    return <Navigate to={de && de !== '/login' ? de : '/'} replace />
  }
  return <Outlet />
}
