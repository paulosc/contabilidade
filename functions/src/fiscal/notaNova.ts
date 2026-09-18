/**
 * Emissão de NFS-e "do zero", sem nota-modelo.
 *
 * O que vem da empresa (e não da tela): o prestador é sempre o titular do certificado (regra
 * E0718), o município emissor sai do cadastro, e a situação no Simples, da última nota emitida
 * ou, sem nenhuma, do perfil fiscal. O que muda de nota para nota — tomador, serviço, valores —
 * vem da tela, que ainda recebe sugestões tiradas das notas anteriores.
 *
 * As combinações de regime × totais de tributos × alíquota seguem o Anexo I do leiaute v1.01
 * (regras de rejeição citadas em cada teste de `regrasDoRegime`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { storage } from '../lib/admin'
import { ErroDps, lerDpsDeNfse, type DadosDps, type RegimeTributario } from './dps'
import { configFiscalRef, notasServicoRef, raizRef, type ConfiguracaoFiscal, type NotaServico } from './modelo'

const ASSETS = join(__dirname, '..', '..', 'assets')
let porNome: Map<string, string> | undefined

const semAcento = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Código IBGE (7 dígitos) a partir do nome do município e da UF, pela tabela oficial do IBGE. */
export function codigoIbgeDoMunicipio(nome?: string, uf?: string): string | undefined {
  if (!nome || !uf) return undefined
  if (!porNome) {
    const tabela = JSON.parse(readFileSync(join(ASSETS, 'municipios-ibge.json'), 'utf8')) as Record<string, [string, string]>
    porNome = new Map(Object.entries(tabela).map(([codigo, [n, u]]) => [`${semAcento(n)}|${u.toUpperCase()}`, codigo]))
  }
  return porNome.get(`${semAcento(nome)}|${uf.toUpperCase()}`)
}

/**
 * Situação no Simples sem nota anterior: o que o perfil fiscal diz. ME/EPP apura tudo pelo
 * Simples (regApTribSN = 1) até ultrapassar sublimite — quem passou escolhe na tela.
 */
export function regimeDoPerfil(regime?: string): RegimeTributario {
  if (regime === 'mei') return { opSimpNac: '2', regEspTrib: '0' }
  if (regime === 'simples') return { opSimpNac: '3', regApTribSN: '1', regEspTrib: '0' }
  return { opSimpNac: '1', regEspTrib: '0' }
}

export class ErroRegime extends ErroDps {}

/**
 * Combinações do Anexo I que o SEFIN rejeita — conferidas antes de mandar:
 *   E0166  ME/EPP tem de informar regApTribSN;  E0162  não optante e MEI não podem;
 *   E0712  ME/EPP não pode usar indTotTrib;     E0710  MEI não pode usar pTotTribSN;
 *   E0713  não optante não pode usar indTotTrib nem pTotTribSN;
 *   E0625  ME/EPP com ISSQN pelo Simples, sem retenção: não informa alíquota (município ativo).
 */
export function regrasDoRegime(d: DadosDps): void {
  const r = d.prestador.regime
  const t = d.valores.totTrib
  const m = d.valores.tribMun
  if (r.opSimpNac === '3' && !r.regApTribSN) throw new ErroRegime('Optante ME/EPP precisa informar em que regime o ISSQN e os tributos federais são apurados (E0166).')
  if (r.opSimpNac !== '3' && r.regApTribSN) throw new ErroRegime('Só optante ME/EPP informa o regime de apuração do Simples (E0162).')
  if (r.opSimpNac === '3' && t.indTotTrib) throw new ErroRegime('Optante ME/EPP não pode marcar "não informar tributos" (E0712): informe o percentual do Simples.')
  if (r.opSimpNac === '2' && t.pTotTribSN) throw new ErroRegime('MEI não informa o percentual do Simples Nacional (E0710).')
  if (r.opSimpNac === '1' && (t.indTotTrib || t.pTotTribSN)) throw new ErroRegime('Não optante do Simples informa os tributos em valor ou percentual por esfera (E0713).')
  if (r.opSimpNac === '3' && r.regApTribSN === '1' && m.tpRetISSQN === '1' && m.pAliq) {
    throw new ErroRegime('Com o ISSQN apurado pelo Simples e sem retenção, a alíquota não é informada (E0625).')
  }
  if (t.pTotTribSN !== undefined && !(Number(t.pTotTribSN) >= 0 && Number(t.pTotTribSN) <= 100)) throw new ErroRegime('Percentual do Simples deve ficar entre 0 e 100%.')
}

export interface BaseNotaNova {
  prestador: DadosDps['prestador']
  codigoMunicipioEmissao: string
  /** De onde veio a situação no Simples: da última nota emitida ou do perfil fiscal */
  origemRegime: 'ultima_nota' | 'perfil_fiscal'
  /** Da última nota, quando houver: percentual do Simples e alíquota usados nela */
  ultimaTributacao?: { pTotTribSN?: string; tpRetISSQN?: string; pAliq?: string }
  servicosAnteriores: Array<{ cTribNac: string; cTribMun?: string; cNBS?: string; descricao: string; vezes: number }>
  tomadoresAnteriores: Array<{ documento: string; nome: string; vezes: number }>
}

/** Tudo o que a tela precisa para montar uma nota sem modelo. */
export async function baseNotaNova(empresaId: string): Promise<BaseNotaNova> {
  const [empresaSnap, configSnap, perfilSnap, notasSnap] = await Promise.all([
    raizRef(empresaId).get(),
    configFiscalRef(empresaId).get(),
    raizRef(empresaId).collection('configuracoes').doc('perfilFiscal').get(),
    // o papel é filtrado em memória: igualdade + ordenação em campos diferentes pediria índice composto
    notasServicoRef(empresaId).orderBy('dataEmissao', 'desc').limit(200).get(),
  ])
  const empresa = (empresaSnap.data() ?? {}) as { cnpj?: string; uf?: string; endereco?: { cidade?: string; uf?: string } }
  const config = configSnap.data() as ConfiguracaoFiscal | undefined
  const documento = (config?.certificado?.documento ?? empresa.cnpj ?? '').replace(/\D/g, '')
  if (!config?.certificado) throw new ErroDps('Cadastre o certificado digital da empresa em Configurações antes de emitir.')

  const notas = notasSnap.docs.map((d) => d.data() as NotaServico).filter((n) => n.papel === 'prestador' && n.origem !== 'municipal' && n.status !== 'cancelada')

  // a última nota nacional válida é a fonte mais confiável da situação no Simples e do IM
  let modelo: DadosDps | undefined
  const ultima = notas.find((n) => n.storagePath && n.ambiente === 'producao') ?? notas.find((n) => n.storagePath)
  if (ultima?.storagePath) {
    try {
      const [xml] = await storage.bucket().file(ultima.storagePath).download()
      modelo = lerDpsDeNfse(xml.toString('utf8')).dados
    } catch {
      // sem o XML, cai no perfil fiscal
    }
  }

  const perfil = perfilSnap.data() as { regime?: string } | undefined
  const codigoMunicipioEmissao = modelo?.codigoMunicipioEmissao ?? codigoIbgeDoMunicipio(empresa.endereco?.cidade, empresa.endereco?.uf ?? empresa.uf) ?? ''
  if (!codigoMunicipioEmissao) throw new ErroDps('Não achei o município da empresa. Atualize o cadastro pelo cartão CNPJ em Configurações (ele traz a cidade).')

  const prestador: DadosDps['prestador'] = {
    ...(documento.length === 11 ? { cpf: documento } : { cnpj: documento }),
    ...(modelo?.prestador.inscricaoMunicipal ? { inscricaoMunicipal: modelo.prestador.inscricaoMunicipal } : {}),
    regime: modelo?.prestador.regime ?? regimeDoPerfil(perfil?.regime),
  }

  const servicos = new Map<string, BaseNotaNova['servicosAnteriores'][number]>()
  const tomadores = new Map<string, BaseNotaNova['tomadoresAnteriores'][number]>()
  for (const n of notas) {
    if (n.codigoTributacaoNacional) {
      const chave = n.codigoTributacaoNacional
      const s = servicos.get(chave) ?? { cTribNac: chave, ...(n.codigoTributacaoMunicipal ? { cTribMun: n.codigoTributacaoMunicipal } : {}), descricao: (n.descricaoServico ?? '').slice(0, 300), vezes: 0 }
      s.vezes++
      servicos.set(chave, s)
    }
    if (n.cnpjTomador && n.razaoSocialTomador) {
      const t = tomadores.get(n.cnpjTomador) ?? { documento: n.cnpjTomador, nome: n.razaoSocialTomador, vezes: 0 }
      t.vezes++
      tomadores.set(n.cnpjTomador, t)
    }
  }
  if (modelo?.servico.cNBS) {
    const s = servicos.get(modelo.servico.cTribNac)
    if (s) s.cNBS = modelo.servico.cNBS
  }

  return {
    prestador,
    codigoMunicipioEmissao,
    origemRegime: modelo ? 'ultima_nota' : 'perfil_fiscal',
    ...(modelo
      ? {
          ultimaTributacao: JSON.parse(
            JSON.stringify({ pTotTribSN: modelo.valores.totTrib.pTotTribSN, tpRetISSQN: modelo.valores.tribMun.tpRetISSQN, pAliq: modelo.valores.tribMun.pAliq }),
          ) as BaseNotaNova['ultimaTributacao'],
        }
      : {}),
    servicosAnteriores: [...servicos.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 10),
    tomadoresAnteriores: [...tomadores.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 20),
  }
}
