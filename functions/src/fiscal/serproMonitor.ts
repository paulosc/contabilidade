/**
 * Acompanhamento da empresa na Receita Federal, pelo Integra Contador (Serpro):
 *
 *   pagamentos       PAGTOWEB/PAGAMENTOS71 — dá baixa sozinha nas guias que a Receita já recebeu
 *   caixa postal     CAIXAPOSTAL/MSGCONTRIBUINTE61 — só os cabeçalhos das mensagens do e-CAC
 *   situação fiscal  SITFIS — relatório em PDF, o mesmo que sustenta a certidão negativa
 *
 * Cada chamada é tarifada, então nada aqui roda sozinho: é sempre um clique de administrador, e o
 * resultado fica guardado em /empresas/{id}/receita/{doc} para a carteira mostrar sem consultar
 * de novo.
 *
 * A caixa postal é só listada. Abrir o conteúdo de uma mensagem pela API caracteriza ciência da
 * intimação (Decreto 70.235/1972, art. 23, § 2º, III) e começa a contar prazo — isso é feito por
 * quem responde pela empresa, no e-CAC, não por um sistema.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { storage } from '../lib/admin'
import type { MensagemCaixaPostal } from '../providers/fiscal/serproIntegraContador'
import { textoDoPdf } from './guiasServico'
import { guiasRef, raizRef, type Guia } from './modelo'
import { ErroSerpro, abrirSessao } from './serproServico'

export const receitaRef = (empresaId: string) => raizRef(empresaId).collection('receita')
const caminhoSituacaoFiscal = (empresaId: string) => `empresas/${empresaId}/receita/situacao-fiscal.pdf`

const soDigitos = (v?: string) => (v ?? '').replace(/\D/g, '')

// ---------- pagamentos ----------

export interface ResultadoPagamentos {
  consultadas: number
  baixadas: Array<{ guiaId: string; tipo: string; valor?: number; pagaEm: string }>
  /** Guias em aberto que a Receita ainda não tem como pagas */
  semPagamento: number
}

/**
 * Procura na Receita os pagamentos das guias em aberto emitidas por ela (DAS e DARF) e dá baixa
 * nas que foram pagas, com a data contábil da arrecadação. Uma única consulta cobre até 100 guias.
 */
export async function conferirPagamentos(empresaId: string, chaveMestra: string, uid: string): Promise<ResultadoPagamentos> {
  const pendentes = await guiasRef(empresaId).where('status', '==', 'pendente').get()
  const candidatas = pendentes.docs
    .map((d) => ({ id: d.id, guia: d.data() as Guia, numero: soDigitos((d.data() as Guia).numeroDocumento) }))
    .filter((g) => (g.guia.tipo === 'das' || g.guia.tipo === 'darf') && g.numero.length >= 8 && g.numero.length <= 17)
  if (!candidatas.length) return { consultadas: 0, baixadas: [], semPagamento: 0 }

  const s = await abrirSessao(empresaId, chaveMestra)
  try {
    const pagos = await s.cliente.pagamentosDosDocumentos(s.contribuinte, candidatas.map((g) => g.numero))
    const porNumero = new Map(pagos.map((p) => [p.numeroDocumento.replace(/^0+/, ''), p]))
    const baixadas: ResultadoPagamentos['baixadas'] = []
    for (const g of candidatas) {
      const pago = porNumero.get(g.numero.replace(/^0+/, ''))
      if (!pago?.dataArrecadacao) continue
      await guiasRef(empresaId)
        .doc(g.id)
        .set(
          {
            status: 'paga',
            pagaEm: Timestamp.fromDate(new Date(`${pago.dataArrecadacao}T12:00:00-03:00`)),
            pagaPor: uid,
            pagamentoConfirmado: { fonte: 'receita', dataArrecadacao: pago.dataArrecadacao, ...(pago.valorTotal !== undefined ? { valorTotal: pago.valorTotal } : {}), conferidoEm: FieldValue.serverTimestamp() },
            atualizadoEm: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      baixadas.push({ guiaId: g.id, tipo: g.guia.tipo, valor: g.guia.valor, pagaEm: pago.dataArrecadacao })
    }
    logger.info('serpro: pagamentos conferidos', { empresaId, consultadas: candidatas.length, baixadas: baixadas.length, uid })
    return { consultadas: candidatas.length, baixadas, semPagamento: candidatas.length - baixadas.length }
  } finally {
    s.cliente.encerrar()
  }
}

// ---------- caixa postal ----------

export interface CaixaPostalGuardada {
  consultadoEm: Timestamp
  naoLidas: number
  relevantesNaoLidas: number
  temMaisPaginas: boolean
  mensagens: MensagemCaixaPostal[]
}

export async function consultarCaixaPostal(empresaId: string, chaveMestra: string, uid: string): Promise<Omit<CaixaPostalGuardada, 'consultadoEm'>> {
  const s = await abrirSessao(empresaId, chaveMestra)
  try {
    const caixa = await s.cliente.caixaPostal(s.contribuinte)
    const resumo = {
      naoLidas: caixa.naoLidas,
      relevantesNaoLidas: caixa.mensagens.filter((m) => !m.lida && m.relevante).length,
      temMaisPaginas: caixa.temMaisPaginas,
      // sem `undefined`: o Firestore recusa
      mensagens: caixa.mensagens.map((m) => JSON.parse(JSON.stringify(m)) as MensagemCaixaPostal),
    }
    await receitaRef(empresaId).doc('caixaPostal').set({ ...resumo, consultadoEm: FieldValue.serverTimestamp(), consultadoPor: uid })
    logger.info('serpro: caixa postal consultada', { empresaId, mensagens: caixa.mensagens.length, naoLidas: caixa.naoLidas, uid })
    return resumo
  } finally {
    s.cliente.encerrar()
  }
}

// ---------- situação fiscal ----------

export interface ResumoSituacaoFiscal {
  /** true quando o relatório traz, literalmente, que não foram detectadas pendências */
  semPendencias: boolean
  /** "Certidão Negativa", "Certidão Positiva com Efeitos de Negativa"... quando o relatório informa */
  certidao?: string
  /** 'AAAA-MM-DD' */
  certidaoValidaAte?: string
}

const FRASE_SEM_PENDENCIAS = /N[ãa]o foram detectadas pend[êe]ncias/i

/** Lê do texto do relatório só o que ele afirma com todas as letras. */
export function resumirSituacaoFiscal(texto: string): ResumoSituacaoFiscal {
  const certidao = /(Certid[ãa]o (?:Negativa|Positiva(?: com Efeitos? de Negativa)?))\s*:/i.exec(texto)?.[1]
  const validade = /Data de Validade:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(texto)
  const valida = validade && Number(validade[3]) > 1900 && Number(validade[2]) <= 12 ? `${validade[3]}-${validade[2]}-${validade[1]}` : undefined
  return { semPendencias: FRASE_SEM_PENDENCIAS.test(texto), ...(certidao ? { certidao: certidao.replace(/\s+/g, ' ') } : {}), ...(valida ? { certidaoValidaAte: valida } : {}) }
}

export async function emitirSituacaoFiscal(empresaId: string, chaveMestra: string, uid: string): Promise<ResumoSituacaoFiscal & { pdfBase64: string }> {
  const s = await abrirSessao(empresaId, chaveMestra)
  try {
    const pdf = await s.cliente.relatorioSituacaoFiscal(s.contribuinte)
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroSerpro('A Receita devolveu um arquivo que não é PDF.')
    const resumo = resumirSituacaoFiscal(await textoDoPdf(pdf))
    const storagePath = caminhoSituacaoFiscal(empresaId)
    await storage.bucket().file(storagePath).save(pdf, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=0' } })
    await receitaRef(empresaId).doc('situacaoFiscal').set({ ...resumo, storagePath, emitidoEm: FieldValue.serverTimestamp(), emitidoPor: uid })
    logger.info('serpro: situação fiscal emitida', { empresaId, semPendencias: resumo.semPendencias, uid })
    return { ...resumo, pdfBase64: pdf.toString('base64') }
  } finally {
    s.cliente.encerrar()
  }
}

/** Último relatório guardado, sem consultar a Receita de novo. */
export async function pdfSituacaoFiscal(empresaId: string): Promise<{ pdfBase64: string; nomeArquivo: string }> {
  const guardado = (await receitaRef(empresaId).doc('situacaoFiscal').get()).data() as { storagePath?: string } | undefined
  if (!guardado?.storagePath?.startsWith(`empresas/${empresaId}/receita/`)) throw new ErroSerpro('Ainda não há relatório de situação fiscal emitido para esta empresa.')
  const [pdf] = await storage.bucket().file(guardado.storagePath).download()
  return { pdfBase64: pdf.toString('base64'), nomeArquivo: 'situacao-fiscal.pdf' }
}
