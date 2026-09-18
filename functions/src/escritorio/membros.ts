/**
 * Quem tem acesso à empresa: a equipe do escritório (admin, contador, assistente) e o próprio
 * cliente (papel 'cliente'), que vê guias, notas e documentos, mas não a folha, as configurações
 * nem nada que gaste requisição na Receita.
 *
 * A pessoa precisa já ter conta: o convite é pelo e-mail com que ela se cadastrou. Procurar o
 * usuário pelo e-mail só o Admin SDK faz — por isso isto é backend, e só administrador chama.
 */
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { raizRef } from '../fiscal/modelo'

export class ErroMembro extends Error {}

export const PAPEIS = ['admin', 'contador', 'assistente', 'cliente'] as const
export type Papel = (typeof PAPEIS)[number]

const membrosRef = (empresaId: string) => raizRef(empresaId).collection('membros')

const validarPapel = (p: unknown): Papel => {
  if (!PAPEIS.includes(p as Papel)) throw new ErroMembro('Papel inválido.')
  return p as Papel
}

export async function adicionarMembro(empresaId: string, email: string, papel: unknown): Promise<{ uid: string; nome: string }> {
  const endereco = (email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(endereco)) throw new ErroMembro('E-mail inválido.')
  const p = validarPapel(papel)
  const usuario = await getAuth()
    .getUserByEmail(endereco)
    .catch(() => undefined)
  if (!usuario) throw new ErroMembro('Ninguém se cadastrou com este e-mail ainda. Peça para a pessoa criar a conta no sistema e tente de novo.')
  const ref = membrosRef(empresaId).doc(usuario.uid)
  if ((await ref.get()).exists) throw new ErroMembro('Esta pessoa já tem acesso a esta empresa.')
  const nome = usuario.displayName?.trim() || endereco.split('@')[0]
  await ref.set({ nome, email: endereco, papel: p, criadoEm: FieldValue.serverTimestamp() })
  return { uid: usuario.uid, nome }
}

/** Nunca deixa a empresa sem administrador, nem o administrador mexer no próprio acesso. */
async function protegerUltimoAdmin(empresaId: string, quem: string, alvo: string): Promise<void> {
  if (quem === alvo) throw new ErroMembro('Você não pode alterar o seu próprio acesso. Peça a outro administrador.')
  const alvoAtual = (await membrosRef(empresaId).doc(alvo).get()).data()
  if (!alvoAtual) throw new ErroMembro('Esta pessoa não tem acesso a esta empresa.')
  if (alvoAtual.papel !== 'admin') return
  const admins = await membrosRef(empresaId).where('papel', '==', 'admin').get()
  if (admins.size <= 1) throw new ErroMembro('A empresa precisa de pelo menos um administrador.')
}

export async function alterarPapel(empresaId: string, quem: string, alvo: string, papel: unknown): Promise<void> {
  const p = validarPapel(papel)
  await protegerUltimoAdmin(empresaId, quem, alvo)
  await membrosRef(empresaId).doc(alvo).set({ papel: p }, { merge: true })
}

export async function removerMembro(empresaId: string, quem: string, alvo: string): Promise<void> {
  await protegerUltimoAdmin(empresaId, quem, alvo)
  await membrosRef(empresaId).doc(alvo).delete()
}
