/**
 * Espelho das empresas de cada usuário.
 *
 * O sistema é de escritório de contabilidade: um usuário administra várias empresas. A fonte da
 * verdade do acesso continua sendo /empresas/{id}/membros/{uid} — é ela que as Rules e as
 * callables consultam. Este gatilho só mantém um índice invertido em
 * /usuarios/{uid}/empresas/{empresaId}, para a tela listar as empresas do usuário com uma
 * leitura simples, sem precisar de consulta em collection group.
 *
 * Não há mais custom claim de empresa: com N empresas por usuário ela não caberia no token, e o
 * Storage passou a ser inacessível pelo cliente (XML e PDF saem por callable, que confere o
 * vínculo e ainda registra quem baixou).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { db } from '../lib/admin'
import { REGIAO } from '../lib/config'

const vinculoRef = (uid: string, empresaId: string) =>
  db.collection('usuarios').doc(uid).collection('empresas').doc(empresaId)

async function espelhar(uid: string, empresaId: string, papel?: string): Promise<void> {
  if (!papel) {
    await vinculoRef(uid, empresaId).delete().catch(() => undefined)
    return
  }
  const empresa = await db.collection('empresas').doc(empresaId).get()
  await vinculoRef(uid, empresaId).set(
    {
      empresaId,
      nome: (empresa.data()?.nome as string) ?? 'Empresa',
      cnpj: (empresa.data()?.cnpj as string) ?? '',
      papel,
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

/** Mantém /usuarios/{uid}/empresas/{empresaId} em dia com os membros de cada empresa. */
export const aoEscreverMembro = onDocumentWritten(
  { region: REGIAO, document: 'empresas/{empresaId}/membros/{uid}' },
  async (evento) => {
    const { empresaId, uid } = evento.params as { empresaId: string; uid: string }
    const depois = evento.data?.after
    const papel = depois?.exists ? ((depois.data()?.papel as string) ?? 'assistente') : undefined
    await espelhar(uid, empresaId, papel).catch((e) =>
      logger.error('falha ao espelhar vínculo', { uid, empresaId, erro: (e as Error).message }),
    )
  },
)

/** Renomear a empresa atualiza o nome mostrado na troca de empresa. */
export const aoEscreverEmpresa = onDocumentWritten({ region: REGIAO, document: 'empresas/{empresaId}' }, async (evento) => {
  const { empresaId } = evento.params as { empresaId: string }
  const depois = evento.data?.after
  if (!depois?.exists) return
  const membros = await db.collection('empresas').doc(empresaId).collection('membros').get()
  await Promise.all(
    membros.docs.map((m) =>
      vinculoRef(m.id, empresaId)
        .set(
          {
            nome: (depois.data()?.nome as string) ?? 'Empresa',
            cnpj: (depois.data()?.cnpj as string) ?? '',
            atualizadoEm: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => undefined),
    ),
  )
})

/**
 * Reconstrói o espelho do usuário que está entrando.
 * Serve para vínculos criados antes deste gatilho existir e para o caso de o gatilho ter falhado.
 */
export const sincronizarMinhasEmpresas = onCall({ region: REGIAO }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Faça login')

  const perfil = await db.collection('usuarios').doc(uid).get()
  const atual = perfil.data()?.empresaId as string | undefined
  // o espelho pode estar vazio; a empresa do perfil é o ponto de partida garantido
  if (atual) {
    const membro = await db.collection('empresas').doc(atual).collection('membros').doc(uid).get()
    if (membro.exists) await espelhar(uid, atual, (membro.data()?.papel as string) ?? 'assistente')
  }

  const espelho = await db.collection('usuarios').doc(uid).collection('empresas').get()
  return { empresas: espelho.docs.map((d) => ({ id: d.id, ...d.data() })) }
})
