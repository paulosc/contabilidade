/**
 * Security Rules da integração fiscal, rodadas de verdade no emulador do Firestore.
 *
 * Provam o que a arquitetura promete:
 *  - a empresa A não enxerga nada da empresa B;
 *  - visitante sem login não enxerga nada;
 *  - o certificado (/privado/fiscal) é inacessível para qualquer cliente, inclusive o admin;
 *  - notas, sincronizações e auditoria são só leitura — quem escreve é o backend;
 *  - a auditoria fiscal é só do administrador.
 *
 * Rode com:  npm run test:regras   (levanta o emulador e executa este arquivo)
 */
import { after, before, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from '@firebase/firestore'

const PROJETO = 'regras-fiscal-teste'
const EMPRESA_A = 'empA'
const EMPRESA_B = 'empB'
const ADMIN_A = 'uid-admin-a'
const ASSISTENTE_A = 'uid-assistente-a'
const ADMIN_B = 'uid-admin-b'
const CHAVE = '31260912345678000199550010000012341000012347'
const CHAVE_NFSE = '31178012260748857000116000000000000926090381879606'

let ambiente: RulesTestEnvironment

/** O host do emulador é publicado pelo `firebase emulators:exec`. */
function emulador(): { host: string; port: number } {
  const bruto = process.env.FIRESTORE_EMULATOR_HOST
  if (!bruto) throw new Error('Rode com "npm run test:regras" (precisa do emulador do Firestore).')
  const [host, porta] = bruto.split(':')
  return { host, port: Number(porta) }
}

before(async () => {
  const { host, port } = emulador()
  ambiente = await initializeTestEnvironment({
    projectId: PROJETO,
    firestore: { host, port, rules: readFileSync(join(__dirname, '../../../../firestore.rules'), 'utf8') },
  })

  // estado inicial gravado por fora das regras, como o backend faria
  await ambiente.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [imob, admin] of [
      [EMPRESA_A, ADMIN_A],
      [EMPRESA_B, ADMIN_B],
    ] as const) {
      await setDoc(doc(db, 'empresas', imob), { nome: imob, criadoPor: admin })
      await setDoc(doc(db, 'empresas', imob, 'membros', admin), { papel: 'admin', nome: 'Admin' })
      await setDoc(doc(db, 'empresas', imob, 'configuracoes', 'fiscal'), {
        tipo: 'fiscal',
        ativo: true,
        ambiente: 'homologacao',
        cnpj: '12345678000199',
        sincronizacao: { ultimoNsu: '000000000000010', maxNsu: '000000000000010', status: 'aguardando' },
      })
      await setDoc(doc(db, 'empresas', imob, 'privado', 'fiscal'), {
        certificado: { arquivoCifrado: 'v1.x.y.z', senhaCifrada: 'v1.a.b.c', documento: '12345678000199' },
      })
      await setDoc(doc(db, 'empresas', imob, 'notasFiscais', CHAVE), {
        chaveAcesso: CHAVE,
        status: 'autorizada',
        valorTotal: 1530.75,
      })
      await setDoc(doc(db, 'empresas', imob, 'sincronizacoesFiscais', 's1'), { origem: 'agendada', lotes: 1 })
      await setDoc(doc(db, 'empresas', imob, 'auditoriaFiscal', 'a1'), { operacao: 'certificado_cadastrado', uid: admin })
    }
    await setDoc(doc(db, 'empresas', EMPRESA_A, 'membros', ASSISTENTE_A), { papel: 'assistente', nome: 'Assistente' })
  })
})

after(async () => {
  await ambiente?.cleanup()
})

const comoAdminA = () => ambiente.authenticatedContext(ADMIN_A).firestore()
const comoAssistenteA = () => ambiente.authenticatedContext(ASSISTENTE_A).firestore()
const comoAdminB = () => ambiente.authenticatedContext(ADMIN_B).firestore()
const semLogin = () => ambiente.unauthenticatedContext().firestore()

describe('notas fiscais', () => {
  it('membro da empresa lê as notas dela', async () => {
    await assertSucceeds(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasFiscais', CHAVE)))
    await assertSucceeds(getDocs(collection(comoAssistenteA(), 'empresas', EMPRESA_A, 'notasFiscais')))
  })

  it('TENANT A NÃO LÊ AS NOTAS DO TENANT B', async () => {
    await assertFails(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'notasFiscais', CHAVE)))
    await assertFails(getDocs(collection(comoAdminA(), 'empresas', EMPRESA_B, 'notasFiscais')))
  })

  it('tenant A não escreve nas notas do tenant B', async () => {
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'notasFiscais', CHAVE), { status: 'cancelada' }))
    await assertFails(deleteDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'notasFiscais', CHAVE)))
  })

  it('nem o próprio tenant escreve: quem grava é só o backend', async () => {
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasFiscais', CHAVE), { valorTotal: 0 }))
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasFiscais', 'inventada'), { chaveAcesso: 'x' }))
    await assertFails(deleteDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasFiscais', CHAVE)))
  })

  it('visitante sem login não lê nota nenhuma', async () => {
    await assertFails(getDoc(doc(semLogin(), 'empresas', EMPRESA_A, 'notasFiscais', CHAVE)))
  })
})

describe('notas de serviço (NFS-e)', () => {
  it('membro da empresa lê as NFS-e dela', async () => {
    await assertSucceeds(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasServico', CHAVE_NFSE)))
    await assertSucceeds(getDocs(collection(comoAssistenteA(), 'empresas', EMPRESA_A, 'notasServico')))
  })

  it('EMPRESA A NÃO LÊ AS NFS-e DA EMPRESA B', async () => {
    await assertFails(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'notasServico', CHAVE_NFSE)))
    await assertFails(getDocs(collection(comoAdminA(), 'empresas', EMPRESA_B, 'notasServico')))
  })

  it('NFS-e é só leitura: quem grava é o backend', async () => {
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasServico', CHAVE_NFSE), { valorServico: 0 }))
    await assertFails(deleteDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'notasServico', CHAVE_NFSE)))
  })

  it('visitante sem login não lê NFS-e', async () => {
    await assertFails(getDoc(doc(semLogin(), 'empresas', EMPRESA_A, 'notasServico', CHAVE_NFSE)))
  })
})

describe('certificado digital (/privado/fiscal)', () => {
  it('nem o administrador da própria empresa consegue ler', async () => {
    await assertFails(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'privado', 'fiscal')))
  })

  it('nem escrever', async () => {
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'privado', 'fiscal'), { certificado: { arquivoCifrado: 'x' } }))
  })

  it('e muito menos o de outra empresa', async () => {
    await assertFails(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'privado', 'fiscal')))
    await assertFails(getDoc(doc(semLogin(), 'empresas', EMPRESA_A, 'privado', 'fiscal')))
  })
})

describe('configuração fiscal', () => {
  it('membro lê o resumo (é o que a tela acompanha em tempo real)', async () => {
    await assertSucceeds(getDoc(doc(comoAssistenteA(), 'empresas', EMPRESA_A, 'configuracoes', 'fiscal')))
  })

  it('admin NÃO escreve: NSU e estado da sincronização são do backend', async () => {
    await assertFails(
      setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'configuracoes', 'fiscal'), { ativo: false }, { merge: true }),
    )
  })

  it('os outros documentos de configuração continuam editáveis pelo admin', async () => {
    await assertSucceeds(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'configuracoes', 'geral'), { regra: {} }))
  })

  it('assistente não escreve configuração nenhuma', async () => {
    await assertFails(setDoc(doc(comoAssistenteA(), 'empresas', EMPRESA_A, 'configuracoes', 'geral'), { regra: {} }))
  })

  it('tenant A não lê nem escreve a configuração fiscal do tenant B', async () => {
    await assertFails(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'configuracoes', 'fiscal')))
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_B, 'configuracoes', 'geral'), { regra: {} }))
  })
})

describe('histórico e auditoria', () => {
  it('membro lê o histórico de sincronizações da própria empresa', async () => {
    await assertSucceeds(getDoc(doc(comoAssistenteA(), 'empresas', EMPRESA_A, 'sincronizacoesFiscais', 's1')))
  })

  it('histórico é só leitura e só do próprio tenant', async () => {
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'sincronizacoesFiscais', 's2'), { origem: 'manual' }))
    await assertFails(getDoc(doc(comoAdminB(), 'empresas', EMPRESA_A, 'sincronizacoesFiscais', 's1')))
  })

  it('auditoria fiscal é só do administrador', async () => {
    await assertSucceeds(getDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'auditoriaFiscal', 'a1')))
    await assertFails(getDoc(doc(comoAssistenteA(), 'empresas', EMPRESA_A, 'auditoriaFiscal', 'a1')))
    await assertFails(getDoc(doc(comoAdminB(), 'empresas', EMPRESA_A, 'auditoriaFiscal', 'a1')))
  })

  it('ninguém apaga a auditoria pelo cliente', async () => {
    await assertFails(deleteDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'auditoriaFiscal', 'a1')))
    await assertFails(setDoc(doc(comoAdminA(), 'empresas', EMPRESA_A, 'auditoriaFiscal', 'a2'), { operacao: 'x' }))
  })
})
