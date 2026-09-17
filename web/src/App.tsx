import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth, RequireSemEmpresa, SomenteDeslogado } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { DialogoHost } from './components/Dialogo'
import { Login } from './pages/auth/Login'
import { Cadastro } from './pages/auth/Cadastro'
import { Onboarding } from './pages/Onboarding'
import { Dashboard } from './pages/Dashboard'
import { Configuracoes } from './pages/Configuracoes'
import { NotasFiscaisList } from './pages/fiscal/NotasFiscaisList'
import { NotasServicoList } from './pages/fiscal/NotasServicoList'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<SomenteDeslogado />}>
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
          </Route>

          <Route element={<RequireSemEmpresa />}>
            <Route path="/onboarding" element={<Onboarding />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="notas-fiscais" element={<NotasFiscaisList />} />
              <Route path="notas-servico" element={<NotasServicoList />} />
              <Route path="configuracoes" element={<Configuracoes />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <DialogoHost />
      </AuthProvider>
    </BrowserRouter>
  )
}
