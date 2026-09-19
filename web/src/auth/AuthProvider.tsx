import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../lib/firebase'
import type { CadastroCnpj, ComId, Empresa, Endereco, Membro, Usuario, VinculoEmpresa } from '../types'

export type ProvedorSocial = 'google' | 'apple'

export interface DadosNovaEmpresa {
  nome: string
  cnpj: string
  uf?: string
  inscricaoEstadual?: string
  telefone?: string
  email?: string
  nomeFantasia?: string
  endereco?: Endereco
  cadastro?: CadastroCnpj
}

interface AuthContextValue {
  user: User | null
  perfil: Usuario | null
  /** Empresa aberta no momento */
  empresa: ComId<Empresa> | null
  membro: Membro | null
  /** Todas as empresas que este usuário administra (escritório de contabilidade) */
  empresas: ComId<VinculoEmpresa>[]
  trocarEmpresa(empresaId: string): Promise<void>
  /** Por que a empresa não carregou, quando o usuário tem empresaId mas o documento não veio. */
  erroEmpresa: 'nao-encontrada' | 'sem-permissao' | 'falha' | null
  carregando: boolean
  entrar(email: string, senha: string): Promise<void>
  entrarComProvedor(provedor: ProvedorSocial): Promise<void>
  cadastrar(nome: string, email: string, senha: string): Promise<void>
  recuperarSenha(email: string): Promise<void>
  sair(): Promise<void>
  criarEmpresa(dados: DadosNovaEmpresa): Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [authPronto, setAuthPronto] = useState(false)
  const [erroEmpresa, setErroEmpresa] = useState<AuthContextValue['erroEmpresa']>(null)
  // Logo depois de criar a empresa, o perfil já aponta para ela (escrita local) antes de o
  // servidor confirmar o lote com o vínculo de membro: a primeira leitura pode ser negada.
  // O Firestore não retoma um listener negado, então ele é reaberto algumas vezes.
  const [tentativaLeitura, setTentativaLeitura] = useState(0)
  const [vinculos, setVinculos] = useState<{ uid: string | null; lista: ComId<VinculoEmpresa>[] }>({ uid: null, lista: [] })

  // Perfil carregado e para qual uid ele vale (evita usar dado de outro usuário / estado antigo)
  const [perfilEstado, setPerfilEstado] = useState<{ uid: string | null; perfil: Usuario | null }>({ uid: null, perfil: null })
  // Tenant carregado e para qual empresaId ele vale
  const [tenantEstado, setTenantEstado] = useState<{ id: string | null; empresa: ComId<Empresa> | null; membro: Membro | null }>({
    id: null,
    empresa: null,
    membro: null,
  })

  // 1) sessão do Firebase Auth
  useEffect(() => {
    const off = onAuthStateChanged(auth, (u) => setUser(u))
    void auth.authStateReady().then(() => setAuthPronto(true))
    return off
  }, [])

  // 2) perfil em /usuarios/{uid}
  useEffect(() => {
    if (!user) {
      setPerfilEstado({ uid: null, perfil: null })
      return
    }
    const uid = user.uid
    return onSnapshot(
      doc(db, 'usuarios', uid),
      (snap) => setPerfilEstado({ uid, perfil: snap.exists() ? (snap.data() as Usuario) : null }),
      () => setPerfilEstado({ uid, perfil: null }),
    )
  }, [user])

  // 2b) empresas do usuário (espelho mantido pelo backend)
  useEffect(() => {
    if (!user) {
      setVinculos({ uid: null, lista: [] })
      return
    }
    const uid = user.uid
    return onSnapshot(
      collection(db, 'usuarios', uid, 'empresas'),
      (snap) => {
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as VinculoEmpresa) }))
          .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''))
        setVinculos({ uid, lista })
        // espelho vazio com perfil apontando para uma empresa: reconstrói uma vez
        if (snap.empty) void httpsCallable(functions, 'sincronizarMinhasEmpresas')({}).catch(() => undefined)
      },
      () => setVinculos({ uid, lista: [] }),
    )
  }, [user])

  const perfil = user && perfilEstado.uid === user.uid ? perfilEstado.perfil : null
  const empresas = user && vinculos.uid === user.uid ? vinculos.lista : []
  // a empresa aberta é a do perfil; se ela sumir do espelho, cai para a primeira disponível
  const empresaId = perfil?.empresaId ?? (empresas.length ? empresas[0].empresaId : null)

  // 3) empresa + membro
  useEffect(() => {
    if (!user || !empresaId) {
      setTenantEstado({ id: null, empresa: null, membro: null })
      setErroEmpresa(null)
      return
    }
    const id = empresaId
    let emp: ComId<Empresa> | null | undefined
    let membro: Membro | null | undefined
    const publicar = () => {
      if (emp !== undefined && membro !== undefined) setTenantEstado({ id, empresa: emp, membro })
    }
    const offEmpresa = onSnapshot(
      doc(db, 'empresas', id),
      (snap) => {
        emp = snap.exists() ? { id: snap.id, ...(snap.data() as Empresa) } : null
        setErroEmpresa(snap.exists() ? null : 'nao-encontrada')
        publicar()
      },
      (err) => {
        if (err.code === 'permission-denied' && tentativaLeitura < 4) {
          setTimeout(() => setTentativaLeitura((t) => t + 1), 800 * (tentativaLeitura + 1))
          return
        }
        emp = null
        setErroEmpresa(err.code === 'permission-denied' ? 'sem-permissao' : 'falha')
        publicar()
      },
    )
    const offMembro = onSnapshot(
      doc(db, 'empresas', id, 'membros', user.uid),
      (snap) => {
        membro = snap.exists() ? (snap.data() as Membro) : null
        publicar()
      },
      () => {
        membro = null
        publicar()
      },
    )
    return () => {
      offEmpresa()
      offMembro()
    }
  }, [user, empresaId, tentativaLeitura])

  // empresa diferente, contagem nova
  useEffect(() => setTentativaLeitura(0), [empresaId])

  const perfilPronto = !user || perfilEstado.uid === user.uid
  const tenantPronto = !empresaId || tenantEstado.id === empresaId
  const carregando = !authPronto || !perfilPronto || !tenantPronto
  const empresa = empresaId && tenantEstado.id === empresaId ? tenantEstado.empresa : null
  const membro = empresaId && tenantEstado.id === empresaId ? tenantEstado.membro : null

  const valor: AuthContextValue = {
    user,
    perfil,
    empresa,
    membro,
    empresas,
    erroEmpresa: empresa ? null : erroEmpresa,
    carregando,

    async trocarEmpresa(empresaId) {
      if (!user) throw new Error('Usuário não autenticado')
      // `empresaId` no perfil é só a preferência de qual empresa abrir; o acesso continua
      // sendo decidido por /empresas/{id}/membros/{uid}, no backend e nas Rules
      await updateDoc(doc(db, 'usuarios', user.uid), { empresaId })
    },

    async entrar(email, senha) {
      await signInWithEmailAndPassword(auth, email, senha)
    },

    async entrarComProvedor(nome) {
      let provider: GoogleAuthProvider | OAuthProvider
      if (nome === 'google') {
        provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
      } else {
        provider = new OAuthProvider('apple.com')
        provider.addScope('email')
        provider.addScope('name')
        provider.setCustomParameters({ locale: 'pt_BR' })
      }
      const cred = await signInWithPopup(auth, provider)
      // Primeiro acesso social: cria o perfil em /usuarios/{uid}.
      // (A Apple só envia o nome no primeiro login; por isso gravamos já aqui.)
      const ref = doc(db, 'usuarios', cred.user.uid)
      const snap = await getDoc(ref)
      if (!snap.exists()) {
        await setDoc(ref, {
          nome: cred.user.displayName ?? cred.user.email ?? 'Usuário',
          email: cred.user.email,
          criadoEm: serverTimestamp(),
        })
      }
    },

    async cadastrar(nome, email, senha) {
      const cred = await createUserWithEmailAndPassword(auth, email, senha)
      await updateProfile(cred.user, { displayName: nome })
      await setDoc(doc(db, 'usuarios', cred.user.uid), {
        nome,
        email,
        criadoEm: serverTimestamp(),
      })
    },

    async recuperarSenha(email) {
      await sendPasswordResetEmail(auth, email)
    },

    async sair() {
      await signOut(auth)
    },

    async criarEmpresa(dados) {
      if (!user) throw new Error('Usuário não autenticado')
      const nome = user.displayName ?? perfil?.nome ?? user.email ?? 'Usuário'
      const empresaRef = doc(collection(db, 'empresas'))
      const batch = writeBatch(db)
      batch.set(empresaRef, {
        ...dados,
        criadoPor: user.uid,
        criadoEm: serverTimestamp(),
      })
      batch.set(doc(empresaRef, 'membros', user.uid), {
        nome,
        email: user.email,
        papel: 'admin',
        criadoEm: serverTimestamp(),
      })
      batch.set(doc(db, 'usuarios', user.uid), { nome, email: user.email, empresaId: empresaRef.id }, { merge: true })
      await batch.commit()
      return empresaRef.id
    },
  }

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
