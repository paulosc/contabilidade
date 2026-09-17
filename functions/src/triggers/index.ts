/**
 * Gatilhos e utilitários de sessão.
 *
 * A claim `empresaId` no token é o que as regras do Storage usam para isolar os arquivos
 * de cada empresa. Ela é gravada quando o membro é criado e garantida no login pelo app.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions'
import { db } from '../lib/admin'
import { REGIAO } from '../lib/config'

async function aplicarClaim(uid: string, empresaId: string | null): Promise<void> {
  const usuario = await getAuth().getUser(uid)
  const atual = (usuario.customClaims ?? {}) as { empresaId?: string }
  if (atual.empresaId === empresaId) return
  await getAuth().setCustomUserClaims(uid, { ...atual, empresaId: empresaId ?? undefined })
  logger.info('claims atualizadas', { uid, empresaId })
}

/** Mantém a claim `empresaId` sincronizada com /empresas/{id}/membros/{uid}. */
export const aoEscreverMembro = onDocumentWritten(
  { region: REGIAO, document: 'empresas/{empresaId}/membros/{uid}' },
  async (evento) => {
    const { empresaId, uid } = evento.params as { empresaId: string; uid: string }
    const existe = evento.data?.after?.exists === true
    await aplicarClaim(uid, existe ? empresaId : null).catch((e) =>
      logger.error('falha ao aplicar claim', { uid, erro: (e as Error).message }),
    )
  },
)

/** Chamada pelo app no login, para o caso de a claim não ter sido aplicada ainda. */
export const garantirClaims = onCall({ region: REGIAO }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login')
  const perfil = await db.collection('usuarios').doc(uid).get()
  const empresaId = (perfil.data()?.empresaId as string | undefined) ?? null
  if (!empresaId) return { empresaId: null }
  const membro = await db.collection('empresas').doc(empresaId).collection('membros').doc(uid).get()
  if (!membro.exists) throw new HttpsError('permission-denied', 'Sem acesso a esta empresa')
  await aplicarClaim(uid, empresaId)
  return { empresaId }
})
