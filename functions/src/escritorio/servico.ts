/**
 * Visão de escritório: junta o que já existe no tenant (NFS-e, folha, guias, certificado) com as
 * regras puras de `simples.ts` e `calendario.ts`.
 *
 *   /empresas/{id}/configuracoes/perfilFiscal   regime, anexo, folha, receitas digitadas (admin edita)
 *   /empresas/{id}/obrigacoes/{competencia}     marcações do checklist (só o backend grava)
 */
import { FieldValue, type Timestamp } from 'firebase-admin/firestore'
import { db } from '../lib/admin'
import { configFiscalRef, guiasRef, notasServicoRef, raizRef, type ConfiguracaoFiscal, type Guia, type NotaServico } from '../fiscal/modelo'
import { obrigacoesQueVencemEm, situacaoDaObrigacao, type Obrigacao, type PerfilFiscal, type SituacaoObrigacao } from './calendario'
import { ErroSimples, apurarSimples, somarMeses, type Apuracao } from './simples'
import type { Anexo } from './simplesTabelas'

export class ErroEscritorio extends Error {}

/** /empresas/{id}/configuracoes/perfilFiscal */
export interface PerfilFiscalGuardado extends Partial<PerfilFiscal> {
  anexo?: Anexo
  sujeitoAoFatorR?: boolean
  /** 'AAAA-MM' */
  inicioAtividade?: string
  /** Receita bruta digitada por mês: substitui a soma das NFS-e (histórico anterior ao sistema, vendas com NF-e) */
  receitasManuais?: Record<string, number>
  /** Folha com encargos digitada por mês: substitui a folha calculada aqui */
  folhasManuais?: Record<string, number>
}

export const perfilFiscalRef = (empresaId: string) => raizRef(empresaId).collection('configuracoes').doc('perfilFiscal')
export const obrigacoesRef = (empresaId: string) => raizRef(empresaId).collection('obrigacoes')

const hojeEmBrasilia = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

export async function lerPerfil(empresaId: string): Promise<PerfilFiscalGuardado | undefined> {
  return (await perfilFiscalRef(empresaId).get()).data() as PerfilFiscalGuardado | undefined
}

const perfilCompleto = (p: PerfilFiscalGuardado | undefined): PerfilFiscal | undefined =>
  p?.regime ? { regime: p.regime, temEmpregados: Boolean(p.temEmpregados), temProLabore: Boolean(p.temProLabore), temReinf: Boolean(p.temReinf) } : undefined

// ---------- receita e folha por mês ----------

interface MesDaApuracao {
  mes: string
  notas: number
  receitaNotas: number
  receitaManual: number | null
  receita: number
  folhaSistema: number
  folhaAberta: boolean
  folhaManual: number | null
  folha: number
}

const centavos = (v: number) => Math.round(v * 100) / 100

/** Receita bruta por competência: NFS-e em que a empresa é a prestadora, válidas e em produção. */
async function receitaDasNotas(empresaId: string, de: string, ate: string): Promise<Record<string, { valor: number; notas: number }>> {
  const snap = await notasServicoRef(empresaId).where('competencia', '>=', de).where('competencia', '<=', ate).select('competencia', 'papel', 'status', 'ambiente', 'valorServico', 'substituidaPor').get()
  const porMes: Record<string, { valor: number; notas: number }> = {}
  for (const d of snap.docs) {
    const n = d.data() as Pick<NotaServico, 'competencia' | 'papel' | 'status' | 'ambiente' | 'valorServico' | 'substituidaPor'>
    if (n.papel !== 'prestador' || n.status !== 'gerada' || n.ambiente !== 'producao' || n.substituidaPor || !n.competencia) continue
    const m = (porMes[n.competencia] ??= { valor: 0, notas: 0 })
    m.valor = centavos(m.valor + (n.valorServico ?? 0))
    m.notas++
  }
  return porMes
}

/** Folha com encargos por competência, do que foi calculado aqui: proventos + FGTS (LC 123, art. 18, § 24). */
async function folhaDoSistema(empresaId: string, de: string, ate: string): Promise<Record<string, { valor: number; aberta: boolean }>> {
  const snap = await raizRef(empresaId).collection('folhas').where('competencia', '>=', de).where('competencia', '<=', ate).get()
  const porMes: Record<string, { valor: number; aberta: boolean }> = {}
  for (const d of snap.docs) {
    const f = d.data() as { competencia: string; status?: string; totais?: { proventos?: number; fgts?: number } }
    porMes[f.competencia] = { valor: centavos((f.totais?.proventos ?? 0) + (f.totais?.fgts ?? 0)), aberta: f.status !== 'fechada' }
  }
  return porMes
}

export interface ApuracaoDoPeriodo {
  perfil: PerfilFiscalGuardado
  meses: MesDaApuracao[]
  apuracao?: Apuracao
  /** Por que não deu para apurar (fora do Simples, acima do limite...) */
  motivo?: string
  /** DAS oficial desta competência, se já está entre as guias */
  dasOficial?: { guiaId: string; valor?: number; vencimento?: string; status: 'pendente' | 'paga' }
}

export async function apuracaoDoPeriodo(empresaId: string, periodo: string): Promise<ApuracaoDoPeriodo> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) throw new ErroEscritorio('Período inválido.')
  const perfil = (await lerPerfil(empresaId)) ?? {}
  // do início do ano (para a receita acumulada no ano) ou de 12 meses atrás, o que for mais antigo
  const de = [somarMeses(periodo, -12), `${periodo.slice(0, 4)}-01`].sort()[0]
  const [notas, folhas, guiasDas] = await Promise.all([
    receitaDasNotas(empresaId, de, periodo),
    folhaDoSistema(empresaId, de, periodo),
    guiasRef(empresaId).where('tipo', '==', 'das').where('periodo', '==', periodo).get(),
  ])

  const meses: MesDaApuracao[] = []
  for (let m = de; m <= periodo; m = somarMeses(m, 1)) {
    const receitaManual = perfil.receitasManuais?.[m] ?? null
    const folhaManual = perfil.folhasManuais?.[m] ?? null
    meses.push({
      mes: m,
      notas: notas[m]?.notas ?? 0,
      receitaNotas: notas[m]?.valor ?? 0,
      receitaManual,
      receita: receitaManual ?? notas[m]?.valor ?? 0,
      folhaSistema: folhas[m]?.valor ?? 0,
      folhaAberta: folhas[m]?.aberta ?? false,
      folhaManual,
      folha: folhaManual ?? folhas[m]?.valor ?? 0,
    })
  }

  // a guia mais recente da competência (cada emissão da Receita gera outro documento para o mesmo débito)
  const das = guiasDas.docs
    .map((d) => ({ id: d.id, ...(d.data() as Guia) }))
    .sort((a, b) => (b.criadoEm?.toMillis?.() ?? 0) - (a.criadoEm?.toMillis?.() ?? 0))
  const paga = das.find((g) => g.status === 'paga')
  const escolhida = paga ?? das[0]
  const dasOficial = escolhida ? { guiaId: escolhida.id, valor: escolhida.valor, vencimento: escolhida.vencimento, status: escolhida.status } : undefined

  if (perfil.regime !== 'simples') {
    return { perfil, meses, dasOficial, motivo: perfil.regime ? 'A empresa não está cadastrada como Simples Nacional.' : 'Cadastre primeiro o perfil fiscal da empresa (regime e anexo).' }
  }
  if (!perfil.anexo) return { perfil, meses, dasOficial, motivo: 'Informe o anexo do Simples no perfil fiscal.' }

  try {
    const apuracao = apurarSimples({
      periodo,
      anexo: perfil.anexo,
      sujeitoAoFatorR: perfil.sujeitoAoFatorR,
      inicioAtividade: perfil.inicioAtividade,
      receitas: Object.fromEntries(meses.map((m) => [m.mes, m.receita])),
      folhas: Object.fromEntries(meses.map((m) => [m.mes, m.folha])),
    })
    return { perfil, meses, apuracao, dasOficial }
  } catch (e) {
    if (e instanceof ErroSimples) return { perfil, meses, dasOficial, motivo: e.message }
    throw e
  }
}

// ---------- checklist de obrigações ----------

export interface Marcacao {
  marcacao: 'feita' | 'dispensada'
  por: string
  porNome?: string
  em: Timestamp
  observacao?: string
}

export interface ObrigacaoDaEmpresa extends Obrigacao {
  situacao: SituacaoObrigacao
  marcadaPor?: string
  marcadaEm?: string
  observacao?: string
  /** O que o próprio sistema já sabe sobre ela (guia emitida, folha fechada...) */
  evidencia?: string
}

async function marcacoesDe(empresaId: string, competencias: string[]): Promise<Record<string, Record<string, Marcacao>>> {
  const unicas = [...new Set(competencias)]
  const docs = await Promise.all(unicas.map((c) => obrigacoesRef(empresaId).doc(c).get()))
  return Object.fromEntries(docs.map((d, i) => [unicas[i], ((d.data()?.itens ?? {}) as Record<string, Marcacao>)]))
}

/** O que o sistema já tem registrado e que comprova (ou adianta) a obrigação. */
async function evidencias(empresaId: string, obrigacoes: Obrigacao[]): Promise<Record<string, string>> {
  const mensal = obrigacoes.find((o) => /^\d{4}-\d{2}$/.test(o.competencia))?.competencia
  if (!mensal) return {}
  const [guias, folha] = await Promise.all([guiasRef(empresaId).where('periodo', '==', mensal).get(), raizRef(empresaId).collection('folhas').doc(mensal).get()])
  const r: Record<string, string> = {}
  const daGuia = (tipo: Guia['tipo'], codigos: string[]) => {
    const lista = guias.docs.map((d) => d.data() as Guia).filter((g) => g.tipo === tipo)
    if (!lista.length) return
    const paga = lista.some((g) => g.status === 'paga')
    for (const c of codigos) r[`${mensal}|${c}`] = paga ? 'Guia marcada como paga' : 'Guia emitida, aguardando pagamento'
  }
  daGuia('das', ['das', 'das_mei', 'pgdas'])
  daGuia('darf', ['darf_previdenciario'])
  if (guias.size) r[`${mensal}|envio_guias`] = `${guias.size} ${guias.size === 1 ? 'guia' : 'guias'} da competência no sistema`
  if (folha.exists) r[`${mensal}|folha`] = (folha.data() as { status?: string }).status === 'fechada' ? 'Folha fechada' : 'Folha calculada, ainda aberta'
  return r
}

export async function calendarioDaEmpresa(empresaId: string, mes: string): Promise<{ perfil?: PerfilFiscal; hoje: string; obrigacoes: ObrigacaoDaEmpresa[] }> {
  const perfil = perfilCompleto(await lerPerfil(empresaId))
  const hoje = hojeEmBrasilia()
  if (!perfil) return { hoje, obrigacoes: [] }
  const lista = obrigacoesQueVencemEm(perfil, mes)
  const [marcas, provas] = await Promise.all([marcacoesDe(empresaId, lista.map((o) => o.competencia)), evidencias(empresaId, lista)])
  return {
    perfil,
    hoje,
    obrigacoes: lista.map((o) => {
      const m = marcas[o.competencia]?.[o.codigo]
      return {
        ...o,
        situacao: situacaoDaObrigacao(o.vencimento, m?.marcacao, hoje),
        marcadaPor: m?.porNome,
        marcadaEm: m?.em?.toDate?.().toISOString(),
        observacao: m?.observacao,
        evidencia: provas[`${o.competencia}|${o.codigo}`],
      }
    }),
  }
}

export async function marcarObrigacao(
  empresaId: string,
  quem: { uid: string; nome?: string },
  pedido: { competencia: string; codigo: string; marcacao: 'feita' | 'dispensada' | null; observacao?: string },
): Promise<void> {
  if (!/^\d{4}(-(\d{2}|T[1-4]))?$/.test(pedido.competencia)) throw new ErroEscritorio('Competência inválida.')
  if (!/^[a-z0-9_]{2,40}$/.test(pedido.codigo)) throw new ErroEscritorio('Obrigação inválida.')
  const ref = obrigacoesRef(empresaId).doc(pedido.competencia)
  if (pedido.marcacao === null) {
    await ref.set({ itens: { [pedido.codigo]: FieldValue.delete() }, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true })
    return
  }
  const observacao = pedido.observacao?.trim().slice(0, 300)
  await ref.set(
    {
      competencia: pedido.competencia,
      itens: { [pedido.codigo]: { marcacao: pedido.marcacao, por: quem.uid, ...(quem.nome ? { porNome: quem.nome } : {}), em: FieldValue.serverTimestamp(), ...(observacao ? { observacao } : {}) } },
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

// ---------- carteira de clientes ----------

export interface ResumoDaEmpresa {
  empresaId: string
  nome: string
  cnpj?: string
  papel: string
  regime?: string
  guias: { pendentes: number; vencidas: number; vencendo: number; valorAberto: number; proximoVencimento?: string }
  certificado?: { validoAte: string; dias: number }
  obrigacoes?: { atrasadas: number; proximas: number; abertasNoMes: number; proxima?: { nome: string; vencimento: string } }
  pendencias: string[]
}

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000)

async function resumoDaEmpresa(empresaId: string, papel: string, hoje: string): Promise<ResumoDaEmpresa> {
  const mesAtual = hoje.slice(0, 7)
  const [empresa, config, guiasPendentes, perfilGuardado, caixaPostal, situacaoFiscal] = await Promise.all([
    raizRef(empresaId).get(),
    configFiscalRef(empresaId).get(),
    guiasRef(empresaId).where('status', '==', 'pendente').get(),
    lerPerfil(empresaId),
    raizRef(empresaId).collection('receita').doc('caixaPostal').get(),
    raizRef(empresaId).collection('receita').doc('situacaoFiscal').get(),
  ])
  const dados = (empresa.data() ?? {}) as { nome?: string; cnpj?: string }
  const pendencias: string[] = []

  const guias = { pendentes: 0, vencidas: 0, vencendo: 0, valorAberto: 0, proximoVencimento: undefined as string | undefined }
  for (const d of guiasPendentes.docs) {
    const g = d.data() as Guia
    guias.pendentes++
    guias.valorAberto = centavos(guias.valorAberto + (g.valor ?? 0))
    if (!g.vencimento) continue
    if (g.vencimento < hoje) guias.vencidas++
    else {
      if (diasEntre(hoje, g.vencimento) <= 7) guias.vencendo++
      if (!guias.proximoVencimento || g.vencimento < guias.proximoVencimento) guias.proximoVencimento = g.vencimento
    }
  }
  if (guias.vencidas) pendencias.push(`${guias.vencidas} ${guias.vencidas === 1 ? 'guia vencida' : 'guias vencidas'}`)
  if (guias.vencendo) pendencias.push(`${guias.vencendo} ${guias.vencendo === 1 ? 'guia vence' : 'guias vencem'} em até 7 dias`)

  const validoAte = (config.data() as ConfiguracaoFiscal | undefined)?.certificado?.validoAte?.toDate?.()
  let certificado: ResumoDaEmpresa['certificado']
  if (validoAte) {
    const ate = validoAte.toISOString().slice(0, 10)
    certificado = { validoAte: ate, dias: diasEntre(hoje, ate) }
    if (certificado.dias < 0) pendencias.push('Certificado digital vencido')
    else if (certificado.dias <= 30) pendencias.push(`Certificado vence em ${certificado.dias} ${certificado.dias === 1 ? 'dia' : 'dias'}`)
  } else {
    pendencias.push('Sem certificado digital')
  }

  // retrato guardado da última consulta à Receita: a carteira não consulta (nem gasta) nada
  const naoLidas = (caixaPostal.data()?.naoLidas as number | undefined) ?? 0
  if (naoLidas > 0) pendencias.push(`${naoLidas} ${naoLidas === 1 ? 'mensagem não lida' : 'mensagens não lidas'} no e-CAC`)
  if (situacaoFiscal.exists && situacaoFiscal.data()?.semPendencias === false) pendencias.push('Situação fiscal com pendência a conferir')

  const perfil = perfilCompleto(perfilGuardado)
  let obrigacoes: ResumoDaEmpresa['obrigacoes']
  if (!perfil) {
    pendencias.push('Perfil fiscal não cadastrado')
  } else {
    // o mês corrente e o anterior: é onde mora o que está atrasado de verdade
    const lista = [...obrigacoesQueVencemEm(perfil, somarMeses(mesAtual, -1)), ...obrigacoesQueVencemEm(perfil, mesAtual)]
    const marcas = await marcacoesDe(empresaId, lista.map((o) => o.competencia))
    const abertas = lista
      .map((o) => ({ ...o, situacao: situacaoDaObrigacao(o.vencimento, marcas[o.competencia]?.[o.codigo]?.marcacao, hoje) }))
      .filter((o) => o.situacao !== 'feita' && o.situacao !== 'dispensada')
    const atrasadas = abertas.filter((o) => o.situacao === 'atrasada')
    const proximas = abertas.filter((o) => o.situacao === 'vence_hoje' || o.situacao === 'proxima')
    const proxima = abertas.filter((o) => o.vencimento >= hoje)[0]
    obrigacoes = {
      atrasadas: atrasadas.length,
      proximas: proximas.length,
      abertasNoMes: abertas.filter((o) => o.vencimento.startsWith(mesAtual)).length,
      proxima: proxima ? { nome: proxima.nome, vencimento: proxima.vencimento } : undefined,
    }
    if (atrasadas.length) pendencias.push(`${atrasadas.length} ${atrasadas.length === 1 ? 'obrigação atrasada' : 'obrigações atrasadas'}`)
  }

  return { empresaId, nome: dados.nome ?? 'Empresa', cnpj: dados.cnpj, papel, regime: perfilGuardado?.regime, guias, certificado, obrigacoes, pendencias }
}

const MAX_EMPRESAS_NA_CARTEIRA = 200

/**
 * Carteira do usuário. O espelho /usuarios/{uid}/empresas só diz quais empresas olhar: o vínculo
 * é conferido de novo em /empresas/{id}/membros/{uid} antes de ler qualquer dado de cada uma.
 */
export async function carteiraDoUsuario(uid: string): Promise<{ hoje: string; empresas: ResumoDaEmpresa[]; semAcesso: number }> {
  const hoje = hojeEmBrasilia()
  const espelho = await db.collection('usuarios').doc(uid).collection('empresas').limit(MAX_EMPRESAS_NA_CARTEIRA).get()
  const vinculos = await Promise.all(
    espelho.docs.map(async (d) => {
      const membro = await raizRef(d.id).collection('membros').doc(uid).get()
      return membro.exists ? { empresaId: d.id, papel: (membro.data()?.papel as string) ?? '' } : null
    }),
  )
  const validos = vinculos.filter((v): v is { empresaId: string; papel: string } => v !== null)
  const empresas = await Promise.all(validos.map((v) => resumoDaEmpresa(v.empresaId, v.papel, hoje)))
  // quem tem mais pendência aparece primeiro
  empresas.sort((a, b) => b.pendencias.length - a.pendencias.length || a.nome.localeCompare(b.nome, 'pt-BR'))
  return { hoje, empresas, semAcesso: vinculos.length - validos.length }
}
