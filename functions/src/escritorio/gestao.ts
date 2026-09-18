/**
 * Gestão do próprio escritório: o contrato com o cliente e a cobrança mensal dos honorários.
 *
 *   /empresas/{id}/configuracoes/contrato     termos do último contrato gerado (para reemitir e consultar)
 *   /empresas/{id}/configuracoes/honorarios   { tipo: 'honorarios', recorrente, valorMensal, diaVencimento }
 */
import { FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { db } from '../lib/admin'
import { gerarRecibo } from '../fiscal/guiasServico'
import { guiasRef, raizRef, type ConfiguracaoHonorarios } from '../fiscal/modelo'
import { enviarDocumento } from './documentos'
import { gerarContratoPdf, validarContrato, type DadosContrato } from './contrato'

const contratoRef = (empresaId: string) => raizRef(empresaId).collection('configuracoes').doc('contrato')

/** Gera a minuta em PDF, guarda em Documentos (categoria "contrato") e registra os termos. */
export async function gerarContrato(empresaId: string, quem: { uid: string; nome?: string }, dados: DadosContrato): Promise<{ documentoId: string; pdfBase64: string; nomeArquivo: string }> {
  validarContrato(dados)
  const pdf = await gerarContratoPdf(dados)
  const nomeArquivo = `contrato-servicos-contabeis-${dados.data}.pdf`
  const { id } = await enviarDocumento(empresaId, quem, { nomeArquivo, conteudoBase64: pdf.toString('base64'), categoria: 'contrato', observacao: 'Minuta gerada pelo sistema — falta assinar' })
  // JSON de ida e volta tira os `undefined`, que o Firestore recusa
  await contratoRef(empresaId).set({ ...(JSON.parse(JSON.stringify(dados)) as DadosContrato), documentoId: id, geradoPor: quem.uid, geradoEm: FieldValue.serverTimestamp() })
  return { documentoId: id, pdfBase64: pdf.toString('base64'), nomeArquivo }
}

// ---------- honorários recorrentes ----------

const hojeEmBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

/** Vencimento dentro da competência: dia 31 em mês de 30 vira o último dia do mês. */
export function vencimentoNaCompetencia(competencia: string, dia: number): string {
  const [ano, mes] = competencia.split('-').map(Number)
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${competencia}-${String(Math.min(Math.max(dia, 1), ultimo)).padStart(2, '0')}`
}

/**
 * Gera o recibo do mês para toda empresa com honorário recorrente ligado. Roda todo dia e é
 * idempotente: se a competência já tem recibo, não faz nada — então ligar a recorrência no meio
 * do mês ainda gera o recibo daquele mês, e uma execução repetida não duplica.
 */
export async function gerarHonorariosRecorrentes(): Promise<{ avaliadas: number; geradas: number; falhas: number }> {
  const competencia = hojeEmBrasilia().slice(0, 7)
  const configs = await db.collectionGroup('configuracoes').where('tipo', '==', 'honorarios').where('recorrente', '==', true).get()
  let geradas = 0
  let falhas = 0
  for (const doc of configs.docs) {
    const empresaId = doc.ref.parent.parent?.id
    const c = doc.data() as ConfiguracaoHonorarios & { recorrente?: boolean }
    if (!empresaId || !c.valorMensal || !c.diaVencimento || !c.emitente?.nome) continue
    try {
      const ja = await guiasRef(empresaId).where('tipo', '==', 'honorarios').where('periodo', '==', competencia).limit(1).get()
      if (!ja.empty) continue
      const r = await gerarRecibo(empresaId, 'sistema', { competencia, valor: c.valorMensal, vencimento: vencimentoNaCompetencia(competencia, c.diaVencimento) })
      await guiasRef(empresaId).doc(r.id).set({ recorrente: true }, { merge: true })
      geradas++
    } catch (e) {
      falhas++
      logger.error('honorarios: falha ao gerar o recibo recorrente', { empresaId, competencia, erro: (e as Error).message })
    }
  }
  logger.info('honorarios: recorrencia avaliada', { competencia, avaliadas: configs.size, geradas, falhas })
  return { avaliadas: configs.size, geradas, falhas }
}
