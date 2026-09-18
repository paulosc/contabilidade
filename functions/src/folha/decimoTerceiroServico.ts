/**
 * 13º salário dos empregados da empresa. É cálculo de conferência: nada é gravado — o que sai
 * daqui alimenta a folha de novembro/dezembro que o escritório fecha. Só administrador, porque
 * expõe salário.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { REGIAO } from '../lib/config'
import { exigirAdmin } from '../fiscal'
import { ErroDecimoTerceiro, calcularDecimoTerceiro, type DecimoTerceiro } from './decimoTerceiro'
import { ErroTabela } from './tabelas'
import { funcionariosRef, type Funcionario } from './modelo'

interface Ajuste {
  variaveisAteNovembro?: number
  mesesSemDireito?: number
  adiantamentoPago?: number
}

const numero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

export const decimoTerceiroDoAno = onCall({ region: REGIAO }, async (req) => {
  const { id } = await exigirAdmin(req.auth?.uid, req.data)
  const d = (req.data ?? {}) as { ano?: number; mesDoAdiantamento?: number; ajustes?: Record<string, Ajuste> }
  const ano = Number(d.ano)
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) throw new HttpsError('invalid-argument', 'Informe o ano')
  const mesDoAdiantamento = d.mesDoAdiantamento === undefined ? 11 : Number(d.mesDoAdiantamento)

  const snap = await funcionariosRef(id).get()
  const linhas: Array<{ funcionarioId: string; nome: string; cargo: string; salario: number; resultado?: DecimoTerceiro; erro?: string }> = []
  for (const doc of snap.docs) {
    const f = doc.data() as Funcionario
    // sócio com pró-labore não tem 13º; desligado antes do ano também não entra aqui (o da rescisão é outro cálculo)
    if (f.tipo === 'prolabore' || !f.ativo || (f.dataDesligamento && f.dataDesligamento < `${ano}-12-20`)) continue
    const a = d.ajustes?.[doc.id] ?? {}
    try {
      const resultado = calcularDecimoTerceiro({
        ano,
        tipo: f.tipo,
        dataAdmissao: f.dataAdmissao,
        salario: f.salarioBase,
        dependentes: f.dependentesIrrf,
        pensaoAlimenticia: f.pensaoAlimenticia,
        mesDoAdiantamento,
        variaveisAteNovembro: numero(a.variaveisAteNovembro),
        mesesSemDireito: numero(a.mesesSemDireito),
        adiantamentoPago: numero(a.adiantamentoPago),
      })
      linhas.push({ funcionarioId: doc.id, nome: f.nome, cargo: f.cargo, salario: f.salarioBase, resultado })
    } catch (e) {
      if (e instanceof ErroDecimoTerceiro || e instanceof ErroTabela) linhas.push({ funcionarioId: doc.id, nome: f.nome, cargo: f.cargo, salario: f.salarioBase, erro: e.message })
      else throw e
    }
  }
  linhas.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'))
  return { ano, mesDoAdiantamento, linhas }
})
