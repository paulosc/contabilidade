/**
 * Sandbox: funcionalidades em estudo, separadas do resto. Nada daqui grava dados da empresa, envia
 * algo a terceiros ou gera obrigação. Só a equipe do escritório acessa.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { REGIAO } from '../lib/config'
import { exigirEquipe } from '../fiscal'
import { ErroSplit, debitosDaOperacao, simularSplit, type EntradaSplit } from './splitPayment'

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Simula o split payment de uma operação (LC 214/2025, arts. 31 a 36). Não consulta nem envia nada. */
export const simularSplitPayment = onCall({ region: REGIAO }, async (req) => {
  await exigirEquipe(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as Record<string, unknown>
  try {
    const valorOperacao = num(d.valorOperacao) ?? 0
    // sem os débitos do documento fiscal, calcula pelas alíquotas informadas (padrão: as de teste de 2026)
    const calculados = debitosDaOperacao(valorOperacao, num(d.aliquotaIbs), num(d.aliquotaCbs))
    const entrada: EntradaSplit = {
      valorOperacao,
      debitoIbs: num(d.debitoIbs) ?? calculados.ibs,
      debitoCbs: num(d.debitoCbs) ?? calculados.cbs,
      extintoIbs: num(d.extintoIbs),
      extintoCbs: num(d.extintoCbs),
      procedimento: d.procedimento === 'simplificado' ? 'simplificado' : 'padrao',
      tributosInformados: d.tributosInformados !== false,
      consultaDisponivel: d.consultaDisponivel !== false,
      percentualSimplificadoIbs: num(d.percentualSimplificadoIbs),
      percentualSimplificadoCbs: num(d.percentualSimplificadoCbs),
      parcelas: num(d.parcelas),
      instrumento: (['pix', 'boleto', 'cartao', 'ted', 'dinheiro'] as const).find((i) => i === d.instrumento) ?? 'pix',
      adquirenteContribuinte: d.adquirenteContribuinte === true,
    }
    return { entrada, resultado: simularSplit(entrada) }
  } catch (e) {
    if (e instanceof ErroSplit) throw new HttpsError('failed-precondition', e.message)
    throw new HttpsError('internal', (e as Error).message)
  }
})
