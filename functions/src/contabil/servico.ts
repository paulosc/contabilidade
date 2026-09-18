/**
 * Contabilidade da empresa no Firestore. Só o backend grava; a equipe do escritório lê.
 *
 *   /empresas/{id}/contas/{codigo}            plano de contas (nasce do padrão, o escritório acrescenta)
 *   /empresas/{id}/lancamentos/{id}           partidas dobradas
 *   /empresas/{id}/extrato/{id}               movimentações importadas do OFX (id estável → reimportar não duplica)
 *   /empresas/{id}/regrasConciliacao/{id}     "memo que contém X vai para a conta Y", aprendidas ao conciliar
 *   /empresas/{id}/configuracoes/contabilidade  { fechadoAte } — período encerrado não aceita mais mudança
 */
import { createHash } from 'node:crypto'
import { FieldValue, type Timestamp } from 'firebase-admin/firestore'
import { db } from '../lib/admin'
import { raizRef } from '../fiscal/modelo'
import { decodificarOfx, lerOfx, ErroOfx } from './ofx'
import { PLANO_PADRAO, ancestrais, grupoDoCodigo, naturezaPadrao, type Conta, type LinhaDre } from './planoDeContas'
import { ErroContabil, balancete, balancoPatrimonial, dre, razaoDaConta, lancamentoDoExtrato, normalizarMemo, sugerirConta, validarLancamento, type Balancete, type BalancoPatrimonial, type Dre, type RazaoDaConta, type Lancamento, type RegraDeConciliacao } from './razao'

export { ErroContabil, ErroOfx }

const contasRef = (e: string) => raizRef(e).collection('contas')
const lancamentosRef = (e: string) => raizRef(e).collection('lancamentos')
const extratoRef = (e: string) => raizRef(e).collection('extrato')
const regrasRef = (e: string) => raizRef(e).collection('regrasConciliacao')
const configRef = (e: string) => raizRef(e).collection('configuracoes').doc('contabilidade')

const MAX_OFX = 5 * 1024 * 1024
const LINHAS_DRE: LinhaDre[] = ['receita_bruta', 'deducoes', 'custos', 'despesas_pessoal', 'despesas_administrativas', 'despesas_financeiras', 'despesas_tributarias', 'outras_receitas']

export interface LancamentoGuardado extends Lancamento {
  valor: number
  /** Códigos das contas movimentadas, para consultar o razão de uma conta */
  contas: string[]
  origem: 'manual' | 'extrato'
  extratoId?: string
  criadoPor: string
  criadoEm: Timestamp
}

export interface MovimentoDoExtrato {
  contaBanco: string
  fitid: string
  tipo: string
  data: string
  valor: number
  memo: string
  documento?: string
  situacao: 'pendente' | 'conciliada' | 'ignorada'
  contaSugerida?: string
  conta?: string
  lancamentoId?: string
  importadoEm: Timestamp
}

async function lerContas(empresaId: string): Promise<Conta[]> {
  return (await contasRef(empresaId).get()).docs.map((d) => d.data() as Conta)
}

async function exigirPeriodoAberto(empresaId: string, data: string): Promise<void> {
  const fechadoAte = (await configRef(empresaId).get()).data()?.fechadoAte as string | undefined
  if (fechadoAte && data <= fechadoAte) throw new ErroContabil(`O período até ${fechadoAte.split('-').reverse().join('/')} está encerrado. Reabra o período para alterar lançamentos dessa data.`)
}

// ---------- plano de contas ----------

/** Cria o plano padrão na primeira vez. Depois disso não mexe em nada. */
export async function prepararContabilidade(empresaId: string): Promise<{ criadas: number }> {
  if (!(await contasRef(empresaId).limit(1).get()).empty) return { criadas: 0 }
  const lote = db.batch()
  for (const c of PLANO_PADRAO) lote.set(contasRef(empresaId).doc(c.codigo), c)
  await lote.commit()
  return { criadas: PLANO_PADRAO.length }
}

export interface PedidoDeConta {
  codigo: string
  nome: string
  dre?: string | null
  disponivel?: boolean
}

/** Conta analítica nova, sempre debaixo de um grupo (sintético) que já existe. */
export async function criarConta(empresaId: string, p: PedidoDeConta): Promise<Conta> {
  const codigo = (p.codigo ?? '').trim()
  const nome = (p.nome ?? '').trim().slice(0, 80)
  if (!/^[1-4](\.\d{1,2}){2,4}$/.test(codigo)) throw new ErroContabil('Código inválido. Use o formato do plano, por exemplo 4.2.2.11.')
  if (nome.length < 3) throw new ErroContabil('Informe o nome da conta.')
  const pai = ancestrais(codigo)[0]
  const [existente, contaPai] = await Promise.all([contasRef(empresaId).doc(codigo).get(), contasRef(empresaId).doc(pai).get()])
  if (existente.exists) throw new ErroContabil(`Já existe a conta ${codigo}.`)
  if (!contaPai.exists) throw new ErroContabil(`O grupo ${pai} não existe no plano de contas.`)
  if ((contaPai.data() as Conta).analitica) throw new ErroContabil(`${pai} recebe lançamentos, então não pode ter contas abaixo dela. Crie a conta nova ao lado dela.`)

  const grupo = grupoDoCodigo(codigo)
  const deResultado = grupo === 'receita' || grupo === 'custo' || grupo === 'despesa'
  let linha: LinhaDre | undefined
  if (deResultado) {
    if (!LINHAS_DRE.includes(p.dre as LinhaDre)) throw new ErroContabil('Conta de resultado precisa dizer em que linha da DRE entra.')
    linha = p.dre as LinhaDre
  }
  const conta: Conta = {
    codigo,
    nome,
    grupo,
    // dedução da receita fica dentro do grupo 3, mas tem natureza devedora
    natureza: linha === 'deducoes' ? 'devedora' : naturezaPadrao(grupo),
    analitica: true,
    ...(linha ? { dre: linha } : {}),
    ...(p.disponivel && codigo.startsWith('1.1.1.') ? { disponivel: true } : {}),
  }
  await contasRef(empresaId).doc(codigo).set(conta)
  return conta
}

// ---------- lançamentos ----------

async function gravarLancamento(empresaId: string, uid: string, l: Lancamento, origem: 'manual' | 'extrato', extratoId?: string): Promise<string> {
  const contas = new Map((await lerContas(empresaId)).map((c) => [c.codigo, c]))
  if (!contas.size) throw new ErroContabil('Prepare primeiro o plano de contas desta empresa.')
  const valor = validarLancamento(l, contas)
  await exigirPeriodoAberto(empresaId, l.data)
  const ref = lancamentosRef(empresaId).doc()
  await ref.set({
    data: l.data,
    historico: l.historico.trim().slice(0, 200),
    partidas: l.partidas.map((p) => (p.debito ? { conta: p.conta, debito: p.debito } : { conta: p.conta, credito: p.credito })),
    valor,
    contas: [...new Set(l.partidas.map((p) => p.conta))],
    origem,
    ...(extratoId ? { extratoId } : {}),
    criadoPor: uid,
    criadoEm: FieldValue.serverTimestamp(),
  })
  return ref.id
}

export const lancar = (empresaId: string, uid: string, l: Lancamento) => gravarLancamento(empresaId, uid, l, 'manual')

export async function excluirLancamento(empresaId: string, lancamentoId: string): Promise<void> {
  const ref = lancamentosRef(empresaId).doc(lancamentoId)
  const l = (await ref.get()).data() as LancamentoGuardado | undefined
  if (!l) throw new ErroContabil('Lançamento não encontrado nesta empresa.')
  if (l.origem === 'extrato') throw new ErroContabil('Este lançamento veio do extrato: desfaça a conciliação da movimentação em vez de excluir.')
  await exigirPeriodoAberto(empresaId, l.data)
  await ref.delete()
}

// ---------- extrato ----------

export interface ResultadoImportacao {
  novas: number
  repetidas: number
  sugeridas: number
  de?: string
  ate?: string
  saldoFinal?: number
  banco?: string
  conta?: string
}

export async function importarExtrato(empresaId: string, p: { conteudoBase64: string; contaBanco: string }): Promise<ResultadoImportacao> {
  if (typeof p.conteudoBase64 !== 'string' || !p.conteudoBase64) throw new ErroContabil('Envie o arquivo OFX.')
  if (p.conteudoBase64.length > Math.ceil((MAX_OFX * 4) / 3) + 4) throw new ErroContabil('Arquivo grande demais: o limite é 5 MB. Exporte um período menor.')
  if (!p.contaBanco) throw new ErroContabil('Escolha a conta de banco ou caixa a que este extrato pertence.')
  const banco = (await contasRef(empresaId).doc(p.contaBanco).get()).data() as Conta | undefined
  if (!banco?.analitica || !banco.disponivel) throw new ErroContabil('Escolha a conta de banco ou caixa a que este extrato pertence.')

  const extrato = lerOfx(decodificarOfx(Buffer.from(p.conteudoBase64, 'base64')))
  if (!extrato.transacoes.length) throw new ErroContabil('O arquivo não traz nenhuma movimentação.')
  const regras = (await regrasRef(empresaId).get()).docs.map((d) => d.data() as RegraDeConciliacao)

  // id estável: mesmo banco, conta e FITID caem no mesmo documento. Sem FITID, a posição entre
  // movimentações idênticas do mesmo dia desempata.
  const vistos = new Map<string, number>()
  const itens = extrato.transacoes.map((t) => {
    const base = t.fitid ? `${extrato.banco}|${extrato.conta}|${t.fitid}` : `${extrato.banco}|${extrato.conta}|${t.data}|${t.valor}|${t.memo}`
    const n = vistos.get(base) ?? 0
    vistos.set(base, n + 1)
    return { id: createHash('sha256').update(`${p.contaBanco}|${base}|${n}`).digest('hex').slice(0, 32), t }
  })

  let novas = 0
  let sugeridas = 0
  for (let i = 0; i < itens.length; i += 300) {
    const fatia = itens.slice(i, i + 300)
    const existentes = await db.getAll(...fatia.map((x) => extratoRef(empresaId).doc(x.id)))
    const lote = db.batch()
    fatia.forEach((x, k) => {
      if (existentes[k].exists) return
      const contaSugerida = sugerirConta(x.t.memo, regras)
      if (contaSugerida) sugeridas++
      novas++
      lote.set(extratoRef(empresaId).doc(x.id), { contaBanco: p.contaBanco, ...x.t, situacao: 'pendente', ...(contaSugerida ? { contaSugerida } : {}), importadoEm: FieldValue.serverTimestamp() })
    })
    await lote.commit()
  }
  return { novas, repetidas: itens.length - novas, sugeridas, de: extrato.de, ate: extrato.ate, saldoFinal: extrato.saldoFinal, banco: extrato.banco, conta: extrato.conta }
}

export async function conciliar(empresaId: string, uid: string, p: { extratoId: string; conta: string; historico?: string; lembrar?: boolean }): Promise<{ lancamentoId: string }> {
  const ref = extratoRef(empresaId).doc(p.extratoId)
  const m = (await ref.get()).data() as MovimentoDoExtrato | undefined
  if (!m) throw new ErroContabil('Movimentação não encontrada nesta empresa.')
  if (m.situacao === 'conciliada') throw new ErroContabil('Esta movimentação já foi conciliada.')
  if (p.conta === m.contaBanco) throw new ErroContabil('A contrapartida não pode ser a própria conta do banco.')
  const lancamentoId = await gravarLancamento(empresaId, uid, lancamentoDoExtrato(m, m.contaBanco, p.conta, p.historico), 'extrato', p.extratoId)
  await ref.set({ situacao: 'conciliada', conta: p.conta, lancamentoId, contaSugerida: FieldValue.delete(), conciliadaPor: uid, conciliadaEm: FieldValue.serverTimestamp() }, { merge: true })
  if (p.lembrar) {
    const termo = normalizarMemo(m.memo).slice(0, 80)
    if (termo.length >= 4) await regrasRef(empresaId).doc(createHash('sha256').update(termo).digest('hex').slice(0, 24)).set({ termo, conta: p.conta, atualizadaEm: FieldValue.serverTimestamp() })
  }
  return { lancamentoId }
}

/** Volta a movimentação para "pendente", apagando o lançamento que ela gerou. */
export async function desfazerConciliacao(empresaId: string, extratoId: string): Promise<void> {
  const ref = extratoRef(empresaId).doc(extratoId)
  const m = (await ref.get()).data() as MovimentoDoExtrato | undefined
  if (!m) throw new ErroContabil('Movimentação não encontrada nesta empresa.')
  await exigirPeriodoAberto(empresaId, m.data)
  const lote = db.batch()
  if (m.lancamentoId) lote.delete(lancamentosRef(empresaId).doc(m.lancamentoId))
  lote.set(ref, { situacao: 'pendente', conta: FieldValue.delete(), lancamentoId: FieldValue.delete(), conciliadaPor: FieldValue.delete(), conciliadaEm: FieldValue.delete() }, { merge: true })
  await lote.commit()
}

/** Transferência entre contas próprias já lançada do outro lado, estorno... o que não vira lançamento. */
export async function ignorarMovimento(empresaId: string, extratoId: string, ignorar: boolean): Promise<void> {
  const ref = extratoRef(empresaId).doc(extratoId)
  const m = (await ref.get()).data() as MovimentoDoExtrato | undefined
  if (!m) throw new ErroContabil('Movimentação não encontrada nesta empresa.')
  if (m.situacao === 'conciliada') throw new ErroContabil('Desfaça a conciliação antes de ignorar esta movimentação.')
  await ref.set({ situacao: ignorar ? 'ignorada' : 'pendente' }, { merge: true })
}

// ---------- demonstrações ----------

export interface Demonstracoes {
  balancete: Balancete
  dre: Dre
  balanco: BalancoPatrimonial
  lancamentos: number
  fechadoAte?: string
}

export async function demonstracoes(empresaId: string, de: string, ate: string): Promise<Demonstracoes> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) throw new ErroContabil('Período inválido.')
  const [contas, snap, config] = await Promise.all([lerContas(empresaId), lancamentosRef(empresaId).where('data', '<=', ate).select('data', 'historico', 'partidas').get(), configRef(empresaId).get()])
  const lancamentos = snap.docs.map((d) => d.data() as Lancamento)
  return { balancete: balancete(contas, lancamentos, de, ate), dre: dre(contas, lancamentos, de, ate), balanco: balancoPatrimonial(contas, lancamentos, ate), lancamentos: lancamentos.filter((l) => l.data >= de).length, fechadoAte: config.data()?.fechadoAte as string | undefined }
}

/** Razão de uma conta no período. A data é filtrada em memória: `array-contains` + faixa pediria índice composto. */
export async function razao(empresaId: string, codigo: string, de: string, ate: string): Promise<RazaoDaConta & { nome: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) throw new ErroContabil('Período inválido.')
  if (!codigo) throw new ErroContabil('Informe a conta.')
  const conta = (await contasRef(empresaId).doc(codigo).get()).data() as Conta | undefined
  if (!conta) throw new ErroContabil('Conta não encontrada no plano desta empresa.')
  if (!conta.analitica) throw new ErroContabil('O razão é de conta analítica. Escolha uma das contas abaixo deste grupo.')
  const snap = await lancamentosRef(empresaId).where('contas', 'array-contains', codigo).select('data', 'historico', 'partidas').get()
  return { ...razaoDaConta(conta, snap.docs.map((d) => d.data() as Lancamento), de, ate), nome: conta.nome }
}

/** Encerra (ou reabre, com `null`) o período: lançamentos até a data ficam travados. */
export async function fecharPeriodo(empresaId: string, uid: string, ate: string | null): Promise<void> {
  if (ate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(ate) || Number.isNaN(Date.parse(ate)))) throw new ErroContabil('Data de encerramento inválida.')
  if (ate) {
    // filtro da data em memória: igualdade + faixa em campos diferentes pediria índice composto, e pendentes são poucos
    const pendentes = await extratoRef(empresaId).where('situacao', '==', 'pendente').select('data').get()
    if (pendentes.docs.some((d) => (d.data().data as string) <= ate)) throw new ErroContabil('Ainda há movimentações do extrato sem conciliar neste período. Concilie ou ignore antes de encerrar.')
  }
  await configRef(empresaId).set({ fechadoAte: ate ?? FieldValue.delete(), fechadoPor: uid, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true })
}
