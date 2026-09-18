/**
 * Documentos do cliente: o escritório pede ("extrato de agosto", "notas de despesa"), o cliente
 * envia, e tudo fica arquivado por competência.
 *
 *   /empresas/{id}/solicitacoes/{id}   pedidos de documento, com prazo e situação
 *   /empresas/{id}/documentos/{id}     um arquivo guardado (avulso ou resposta a um pedido)
 *   Storage: empresas/{id}/documentos/{docId}/{nome}
 *
 * O Storage continua fechado a todo cliente: envio e download passam por aqui, que confere o
 * vínculo de quem pede com a empresa. Só o backend grava nas duas coleções.
 */
import { createHash, randomUUID } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { storage } from '../lib/admin'
import { raizRef } from '../fiscal/modelo'

export class ErroDocumento extends Error {}

export const CATEGORIAS = ['extrato', 'nota_despesa', 'nota_receita', 'folha', 'contrato', 'guia_comprovante', 'societario', 'outro'] as const
export type Categoria = (typeof CATEGORIAS)[number]

/** Extensões aceitas e o tipo com que são servidas. Nada executável, nada de HTML. */
const TIPOS: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  xml: 'application/xml',
  ofx: 'application/x-ofx',
  csv: 'text/csv',
  txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
}

/** Mesmo teto das guias: cabe com folga no limite de 10 MB de uma callable. */
const MAX_BYTES = 7 * 1024 * 1024

export interface Documento {
  nome: string
  categoria: Categoria
  /** 'AAAA-MM' */
  competencia?: string
  observacao?: string
  solicitacaoId?: string
  tamanho: number
  tipo: string
  hash: string
  storagePath: string
  enviadoPor: string
  enviadoPorNome?: string
  enviadoEm: Timestamp
}

export type SituacaoSolicitacao = 'aberta' | 'enviada' | 'aceita' | 'recusada'

export interface Solicitacao {
  titulo: string
  descricao?: string
  categoria: Categoria
  competencia?: string
  /** 'AAAA-MM-DD' */
  prazo?: string
  situacao: SituacaoSolicitacao
  /** Por que o que foi enviado não serviu */
  motivoRecusa?: string
  documentos: number
  criadaPor: string
  criadaPorNome?: string
  criadaEm: Timestamp
  atualizadaEm: Timestamp
}

const documentosRef = (empresaId: string) => raizRef(empresaId).collection('documentos')
const solicitacoesRef = (empresaId: string) => raizRef(empresaId).collection('solicitacoes')

/** Nome seguro para guardar e devolver: sem caminho, sem caractere de controle, com extensão aceita. */
export function nomeSeguro(nome: string): { nome: string; tipo: string } {
  const base = (nome ?? '').split(/[\\/]/).pop()!.normalize('NFC').replace(/[\p{Cc}<>:"|?*]/gu, '').trim().slice(-120)
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(base)?.[1]?.toLowerCase()
  if (!base || !ext || !TIPOS[ext]) throw new ErroDocumento(`Tipo de arquivo não aceito. Envie ${Object.keys(TIPOS).join(', ')}.`)
  return { nome: base, tipo: TIPOS[ext] }
}

const validarCompetencia = (c?: string) => {
  if (c && !/^\d{4}-(0[1-9]|1[0-2])$/.test(c)) throw new ErroDocumento('Competência inválida.')
  return c || undefined
}

const validarCategoria = (c: unknown): Categoria => {
  if (!CATEGORIAS.includes(c as Categoria)) throw new ErroDocumento('Categoria inválida.')
  return c as Categoria
}

const limpar = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T

export interface PedidoEnvio {
  nomeArquivo: string
  conteudoBase64: string
  categoria?: string
  competencia?: string
  observacao?: string
  solicitacaoId?: string
}

export async function enviarDocumento(empresaId: string, quem: { uid: string; nome?: string }, p: PedidoEnvio): Promise<{ id: string }> {
  const { nome, tipo } = nomeSeguro(p.nomeArquivo)
  if (typeof p.conteudoBase64 !== 'string' || !p.conteudoBase64) throw new ErroDocumento('Arquivo vazio.')
  if (p.conteudoBase64.length > Math.ceil((MAX_BYTES * 4) / 3) + 4) throw new ErroDocumento('Arquivo grande demais: o limite é 7 MB.')
  const conteudo = Buffer.from(p.conteudoBase64, 'base64')
  if (!conteudo.length) throw new ErroDocumento('Arquivo vazio.')
  if (conteudo.length > MAX_BYTES) throw new ErroDocumento('Arquivo grande demais: o limite é 7 MB.')

  let categoria = p.categoria ? validarCategoria(p.categoria) : 'outro'
  let competencia = validarCompetencia(p.competencia)
  let solicitacao: Solicitacao | undefined
  if (p.solicitacaoId) {
    solicitacao = (await solicitacoesRef(empresaId).doc(p.solicitacaoId).get()).data() as Solicitacao | undefined
    if (!solicitacao) throw new ErroDocumento('Solicitação não encontrada nesta empresa.')
    if (solicitacao.situacao === 'aceita') throw new ErroDocumento('Esta solicitação já foi concluída.')
    categoria = solicitacao.categoria
    competencia = solicitacao.competencia ?? competencia
  }

  const id = randomUUID()
  const storagePath = `empresas/${empresaId}/documentos/${id}/${nome}`
  await storage.bucket().file(storagePath).save(conteudo, { contentType: tipo, resumable: false, metadata: { cacheControl: 'private, max-age=0' } })
  await documentosRef(empresaId)
    .doc(id)
    .set(
      limpar({
        nome,
        categoria,
        competencia,
        observacao: p.observacao?.trim().slice(0, 300),
        solicitacaoId: p.solicitacaoId,
        tamanho: conteudo.length,
        tipo,
        hash: createHash('sha256').update(conteudo).digest('hex'),
        storagePath,
        enviadoPor: quem.uid,
        enviadoPorNome: quem.nome,
        enviadoEm: FieldValue.serverTimestamp(),
      }),
    )
  if (p.solicitacaoId) {
    await solicitacoesRef(empresaId).doc(p.solicitacaoId).set({ situacao: 'enviada', documentos: FieldValue.increment(1), motivoRecusa: FieldValue.delete(), atualizadaEm: FieldValue.serverTimestamp() }, { merge: true })
  }
  return { id }
}

export async function baixarDocumento(empresaId: string, documentoId: string): Promise<{ nomeArquivo: string; tipo: string; conteudoBase64: string }> {
  const d = (await documentosRef(empresaId).doc(documentoId).get()).data() as Documento | undefined
  if (!d) throw new ErroDocumento('Documento não encontrado nesta empresa.')
  if (!d.storagePath.startsWith(`empresas/${empresaId}/documentos/`)) throw new ErroDocumento('O arquivo deste documento não está disponível.')
  const [conteudo] = await storage.bucket().file(d.storagePath).download()
  return { nomeArquivo: d.nome, tipo: d.tipo, conteudoBase64: conteudo.toString('base64') }
}

/** Quem enviou pode apagar o que enviou; a equipe do escritório apaga qualquer um. */
export async function excluirDocumento(empresaId: string, quem: { uid: string; daEquipe: boolean }, documentoId: string): Promise<void> {
  const ref = documentosRef(empresaId).doc(documentoId)
  const d = (await ref.get()).data() as Documento | undefined
  if (!d) throw new ErroDocumento('Documento não encontrado nesta empresa.')
  if (!quem.daEquipe && d.enviadoPor !== quem.uid) throw new ErroDocumento('Só quem enviou ou a equipe do escritório pode excluir este documento.')
  if (d.storagePath.startsWith(`empresas/${empresaId}/documentos/`)) await storage.bucket().file(d.storagePath).delete({ ignoreNotFound: true })
  await ref.delete()
  // `update` e não `set`: se o pedido já foi apagado, não é para nascer um documento fantasma
  if (d.solicitacaoId) {
    await solicitacoesRef(empresaId)
      .doc(d.solicitacaoId)
      .update({ documentos: FieldValue.increment(-1), atualizadaEm: FieldValue.serverTimestamp() })
      .catch(() => undefined)
  }
}

export interface PedidoSolicitacao {
  titulo: string
  descricao?: string
  categoria: string
  competencia?: string
  prazo?: string
}

export async function criarSolicitacao(empresaId: string, quem: { uid: string; nome?: string }, p: PedidoSolicitacao): Promise<{ id: string }> {
  const titulo = (p.titulo ?? '').trim().slice(0, 120)
  if (titulo.length < 3) throw new ErroDocumento('Diga o que está sendo pedido.')
  if (p.prazo && !/^\d{4}-\d{2}-\d{2}$/.test(p.prazo)) throw new ErroDocumento('Prazo inválido.')
  const ref = await solicitacoesRef(empresaId).add(
    limpar({
      titulo,
      descricao: p.descricao?.trim().slice(0, 500),
      categoria: validarCategoria(p.categoria),
      competencia: validarCompetencia(p.competencia),
      prazo: p.prazo,
      situacao: 'aberta' as const,
      documentos: 0,
      criadaPor: quem.uid,
      criadaPorNome: quem.nome,
      criadaEm: FieldValue.serverTimestamp(),
      atualizadaEm: FieldValue.serverTimestamp(),
    }),
  )
  return { id: ref.id }
}

/** A equipe confere o que chegou: aceita (encerra) ou recusa dizendo o que faltou (volta a ficar em aberto para o cliente). */
export async function avaliarSolicitacao(empresaId: string, solicitacaoId: string, decisao: 'aceita' | 'recusada' | 'excluir', motivo?: string): Promise<void> {
  const ref = solicitacoesRef(empresaId).doc(solicitacaoId)
  const s = (await ref.get()).data() as Solicitacao | undefined
  if (!s) throw new ErroDocumento('Solicitação não encontrada nesta empresa.')
  if (decisao === 'excluir') {
    if (s.documentos > 0) throw new ErroDocumento('Esta solicitação já tem documentos. Aceite ou recuse em vez de excluir.')
    await ref.delete()
    return
  }
  if (decisao === 'recusada' && !(motivo ?? '').trim()) throw new ErroDocumento('Diga o que faltou, para o cliente saber o que reenviar.')
  await ref.set(
    decisao === 'aceita'
      ? { situacao: 'aceita', motivoRecusa: FieldValue.delete(), atualizadaEm: FieldValue.serverTimestamp() }
      : { situacao: 'recusada', motivoRecusa: motivo!.trim().slice(0, 300), atualizadaEm: FieldValue.serverTimestamp() },
    { merge: true },
  )
}
