/**
 * Operações da folha: rubricas padrão, cálculo e gravação do holerite, fechamento do mês.
 *
 * O servidor é quem calcula. A tela manda só os lançamentos (rubrica + valor); incidências vêm do
 * cadastro da rubrica e o resultado sai do motor em calculo.ts. Folha fechada não é recalculada:
 * para mexer, reabre-se — e isso fica na auditoria.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { db, storage } from '../lib/admin'
import { calcularHolerite, type Lancamento } from './calculo'
import { gerarHoleritePdf } from './holeritePdf'
import { RUBRICAS_PADRAO, caminhoHolerite, folhasRef, funcionariosRef, holeritesRef, rubricasRef, type Folha, type Funcionario, type Holerite, type Rubrica } from './modelo'
import { ErroTabela } from './tabelas'

export class ErroFolha extends Error {}
export { ErroTabela }

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/

/** Cria as rubricas padrão que ainda não existem. Nunca sobrescreve o que o contador ajustou. */
export async function garantirRubricas(empresaId: string): Promise<number> {
  const existentes = new Set((await rubricasRef(empresaId).get()).docs.map((d) => d.id))
  const faltando = RUBRICAS_PADRAO.filter((r) => !existentes.has(r.codigo))
  if (!faltando.length) return 0
  const lote = db.batch()
  for (const r of faltando) lote.set(rubricasRef(empresaId).doc(r.codigo), { ...r, criadoEm: FieldValue.serverTimestamp() })
  await lote.commit()
  return faltando.length
}

export interface LancamentoPedido {
  codigo: string
  valor: number
  referencia?: string
}

function limpar<T extends object>(objeto: T): T {
  const podar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(podar)
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const s: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) if (x !== undefined) s[k] = podar(x)
      return s
    }
    return v
  }
  return podar(objeto) as T
}

async function exigirFolhaAberta(empresaId: string, competencia: string): Promise<void> {
  if (!COMPETENCIA.test(competencia)) throw new ErroFolha('Competência inválida: use AAAA-MM.')
  const folha = (await folhasRef(empresaId).doc(competencia).get()).data() as Folha | undefined
  if (folha?.status === 'fechada') throw new ErroFolha(`A folha de ${competencia} está fechada. Reabra para alterar.`)
}

/** O trabalhador estava na empresa nesta competência? */
function trabalhouNaCompetencia(f: Funcionario, competencia: string): boolean {
  const inicio = `${competencia}-01`
  const fim = `${competencia}-31`
  return f.dataAdmissao <= fim && (!f.dataDesligamento || f.dataDesligamento >= inicio)
}

/**
 * Calcula e grava o holerite de um trabalhador. Sem lançamentos informados, usa o que já estava
 * gravado; sem nada gravado, parte do salário base (ou do pró-labore) do cadastro.
 */
export async function calcularHoleriteDoFuncionario(
  empresaId: string,
  uid: string,
  competencia: string,
  funcionarioId: string,
  pedidos?: LancamentoPedido[],
): Promise<Holerite> {
  await exigirFolhaAberta(empresaId, competencia)
  const f = (await funcionariosRef(empresaId).doc(funcionarioId).get()).data() as Funcionario | undefined
  if (!f) throw new ErroFolha('Funcionário não encontrado nesta empresa.')
  if (!trabalhouNaCompetencia(f, competencia)) throw new ErroFolha(`${f.nome} não tinha vínculo ativo em ${competencia}.`)

  await garantirRubricas(empresaId)
  const rubricas = new Map((await rubricasRef(empresaId).get()).docs.map((d) => [d.id, d.data() as Rubrica]))
  const ref = holeritesRef(empresaId, competencia).doc(funcionarioId)
  const anterior = (await ref.get()).data() as Holerite | undefined

  let base: LancamentoPedido[]
  if (pedidos) base = pedidos
  else if (anterior) base = anterior.lancamentos.map((l) => ({ codigo: l.codigo, valor: l.valor, referencia: l.referencia }))
  else base = [{ codigo: f.tipo === 'prolabore' ? '3508' : '1000', valor: f.salarioBase, referencia: '30 dias' }]

  const lancamentos: Lancamento[] = base
    .filter((p) => Number.isFinite(p.valor) && p.valor > 0)
    .map((p) => {
      const r = rubricas.get(p.codigo)
      if (!r) throw new ErroFolha(`Rubrica ${p.codigo} não está cadastrada.`)
      return limpar({
        codigo: r.codigo,
        descricao: r.descricao,
        tipo: r.tipo,
        valor: Math.round(p.valor * 100) / 100,
        referencia: p.referencia?.slice(0, 20),
        incideInss: r.incideInss,
        incideIrrf: r.incideIrrf,
        // pró-labore nunca tem FGTS, qualquer que seja a rubrica
        incideFgts: f.tipo === 'prolabore' ? false : r.incideFgts,
      })
    })
  if (!lancamentos.some((l) => l.tipo === 'provento')) throw new ErroFolha('Informe ao menos um provento.')

  const pensao = lancamentos.filter((l) => l.codigo === '9213').reduce((s, l) => s + l.valor, 0)
  const resultado = calcularHolerite({ competencia, tipo: f.tipo, lancamentos, dependentesIrrf: f.dependentesIrrf ?? 0, pensaoAlimenticia: pensao || f.pensaoAlimenticia })

  const holerite: Holerite = limpar({
    funcionarioId,
    competencia,
    funcionario: { nome: f.nome, cpf: f.cpf, cargo: f.cargo, tipo: f.tipo, dataAdmissao: f.dataAdmissao, matricula: f.matricula, dependentesIrrf: f.dependentesIrrf ?? 0, salarioBase: f.salarioBase },
    lancamentos,
    resultado,
    calculadoPor: uid,
  })
  await ref.set({ ...holerite, calculadoEm: FieldValue.serverTimestamp() })
  await atualizarTotais(empresaId, competencia)
  return holerite
}

/** Calcula a folha inteira: todos os trabalhadores ativos na competência. */
export async function calcularFolha(empresaId: string, uid: string, competencia: string): Promise<{ calculados: number; erros: string[] }> {
  await exigirFolhaAberta(empresaId, competencia)
  const funcionarios = (await funcionariosRef(empresaId).get()).docs.filter((d) => {
    const f = d.data() as Funcionario
    return f.ativo !== false && trabalhouNaCompetencia(f, competencia)
  })
  const erros: string[] = []
  let calculados = 0
  for (const d of funcionarios) {
    try {
      await calcularHoleriteDoFuncionario(empresaId, uid, competencia, d.id)
      calculados++
    } catch (e) {
      erros.push(`${(d.data() as Funcionario).nome}: ${(e as Error).message}`)
    }
  }
  return { calculados, erros }
}

export async function removerHolerite(empresaId: string, competencia: string, funcionarioId: string): Promise<void> {
  await exigirFolhaAberta(empresaId, competencia)
  await holeritesRef(empresaId, competencia).doc(funcionarioId).delete()
  await atualizarTotais(empresaId, competencia)
}

async function atualizarTotais(empresaId: string, competencia: string): Promise<void> {
  const holerites = (await holeritesRef(empresaId, competencia).get()).docs.map((d) => d.data() as Holerite)
  const soma = (f: (h: Holerite) => number) => Math.round(holerites.reduce((s, h) => s + f(h) * 100, 0)) / 100
  await folhasRef(empresaId)
    .doc(competencia)
    .set(
      {
        competencia,
        totais: {
          funcionarios: holerites.length,
          proventos: soma((h) => h.resultado.totalProventos),
          descontos: soma((h) => h.resultado.totalDescontos),
          liquido: soma((h) => h.resultado.liquido),
          inss: soma((h) => h.resultado.inss),
          irrf: soma((h) => h.resultado.irrf.valor),
          fgts: soma((h) => h.resultado.fgts),
        },
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  const ref = folhasRef(empresaId).doc(competencia)
  if (!((await ref.get()).data() as Folha | undefined)?.status) await ref.set({ status: 'aberta' }, { merge: true })
}

export async function fecharFolha(empresaId: string, uid: string, competencia: string): Promise<void> {
  await exigirFolhaAberta(empresaId, competencia)
  const holerites = await holeritesRef(empresaId, competencia).get()
  if (holerites.empty) throw new ErroFolha('Não há holerites calculados nesta competência.')
  await folhasRef(empresaId).doc(competencia).set({ status: 'fechada', fechadaEm: FieldValue.serverTimestamp(), fechadaPor: uid }, { merge: true })
}

export async function reabrirFolha(empresaId: string, competencia: string): Promise<void> {
  if (!COMPETENCIA.test(competencia)) throw new ErroFolha('Competência inválida.')
  await folhasRef(empresaId).doc(competencia).set({ status: 'aberta', fechadaEm: FieldValue.delete(), fechadaPor: FieldValue.delete() }, { merge: true })
}

/** PDF do holerite, gerado do que está gravado — o mesmo número que foi calculado. */
export async function pdfDoHolerite(empresaId: string, competencia: string, funcionarioId: string): Promise<{ pdf: Buffer; nomeArquivo: string }> {
  const h = (await holeritesRef(empresaId, competencia).doc(funcionarioId).get()).data() as Holerite | undefined
  if (!h) throw new ErroFolha('Holerite não encontrado. Calcule a folha primeiro.')
  const empresa = (await db.collection('empresas').doc(empresaId).get()).data() as { nome?: string; cnpj?: string } | undefined
  const pdf = await gerarHoleritePdf({
    empresa: { nome: empresa?.nome ?? 'Empresa', cnpj: empresa?.cnpj },
    funcionario: { nome: h.funcionario.nome, cpf: h.funcionario.cpf, cargo: h.funcionario.cargo, dataAdmissao: h.funcionario.dataAdmissao, matricula: h.funcionario.matricula, tipo: h.funcionario.tipo },
    competencia,
    resultado: h.resultado,
  })
  const caminho = caminhoHolerite(empresaId, competencia, funcionarioId)
  await storage.bucket().file(caminho).save(pdf, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=0' } })
  const primeiroNome = h.funcionario.nome.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')
  return { pdf, nomeArquivo: `holerite-${competencia}-${primeiroNome || funcionarioId}.pdf` }
}
