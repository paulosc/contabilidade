import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../auth/AuthProvider'
import type { ComId } from '../types'

/** Referência a uma subcoleção da empresa (tenant). */
export function colecao(empresaId: string, nome: string) {
  return collection(db, 'empresas', empresaId, nome)
}

export function documento(empresaId: string, nome: string, id: string) {
  return doc(db, 'empresas', empresaId, nome, id)
}

/** Subcoleção da vitrine pública (/sites/{empresaId}/{nome}). */
export function colecaoSite(empresaId: string, nome: string) {
  return collection(db, 'sites', empresaId, nome)
}

export function documentoSite(empresaId: string, nome: string, id: string) {
  return doc(db, 'sites', empresaId, nome, id)
}

function useQueryTempoReal<T>(
  montar: (empresaId: string) => ReturnType<typeof collection>,
  constraints: QueryConstraint[],
  chave: string,
) {
  const { empresa } = useAuth()
  const [dados, setDados] = useState<ComId<T>[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!empresa) return
    setCarregando(true)
    const q = query(montar(empresa.id), ...constraints)
    return onSnapshot(
      q,
      (snap) => {
        setDados(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })))
        setErro(null)
        setCarregando(false)
      },
      (err) => {
        setErro(err.message)
        setCarregando(false)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa?.id, chave])

  return { dados, carregando, erro }
}

/**
 * Assina em tempo real uma subcoleção da empresa atual.
 * `chave` deve mudar sempre que `constraints` mudar (evita re-assinar a cada render).
 */
export function useColecao<T>(nome: string, constraints: QueryConstraint[] = [], chave = '') {
  return useQueryTempoReal<T>((id) => colecao(id, nome), constraints, nome + '|' + chave)
}

/** Assina em tempo real uma subcoleção da vitrine pública da empresa atual. */
export function useColecaoSite<T>(nome: string, constraints: QueryConstraint[] = [], chave = '') {
  return useQueryTempoReal<T>((id) => colecaoSite(id, nome), constraints, 'site:' + nome + '|' + chave)
}

/** Assina em tempo real um documento da empresa atual. */
export function useDocumento<T>(nome: string, id?: string) {
  const { empresa } = useAuth()
  const [dado, setDado] = useState<ComId<T> | null>(null)
  const [carregando, setCarregando] = useState(Boolean(id))

  useEffect(() => {
    if (!empresa || !id) {
      setDado(null)
      setCarregando(false)
      return
    }
    setCarregando(true)
    return onSnapshot(documento(empresa.id, nome, id), (snap) => {
      setDado(snap.exists() ? { id: snap.id, ...(snap.data() as T) } : null)
      setCarregando(false)
    })
  }, [empresa, nome, id])

  return { dado, carregando }
}

export async function criarDoc<T extends object>(empresaId: string, nome: string, dados: T) {
  const ref = await addDoc(colecao(empresaId, nome), {
    ...dados,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  })
  return ref.id
}

export async function atualizarDoc<T extends object>(
  empresaId: string,
  nome: string,
  id: string,
  dados: Partial<T>,
) {
  await updateDoc(documento(empresaId, nome, id), {
    ...dados,
    atualizadoEm: serverTimestamp(),
  })
}

export async function excluirDoc(empresaId: string, nome: string, id: string) {
  await deleteDoc(documento(empresaId, nome, id))
}
