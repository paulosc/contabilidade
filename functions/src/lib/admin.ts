import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

if (getApps().length === 0) {
  initializeApp()
}

export const db = getFirestore()
export const storage = getStorage()

/** Referência ao documento de uma empresa (tenant). */
export const empresaRef = (empresaId: string) =>
  db.collection('empresas').doc(empresaId)
