/**
 * Plano de contas padrão para micro e pequena empresa (estrutura da ITG 1000: ativo, passivo e
 * patrimônio líquido, receitas, custos e despesas). É ponto de partida — o escritório acrescenta
 * contas analíticas conforme o cliente.
 *
 * Código com pontos define a hierarquia: "1.1.1.02" é filha de "1.1.1". Só conta analítica recebe
 * lançamento; a sintética é a soma das filhas.
 */

export type Natureza = 'devedora' | 'credora'
export type Grupo = 'ativo' | 'passivo' | 'pl' | 'receita' | 'custo' | 'despesa'

/** Em que linha da DRE a conta de resultado entra */
export type LinhaDre = 'receita_bruta' | 'deducoes' | 'custos' | 'despesas_pessoal' | 'despesas_administrativas' | 'despesas_financeiras' | 'despesas_tributarias' | 'outras_receitas'

export interface Conta {
  codigo: string
  nome: string
  grupo: Grupo
  natureza: Natureza
  analitica: boolean
  dre?: LinhaDre
  /** Conta de banco/caixa: pode receber extrato */
  disponivel?: boolean
}

type Linha = [codigo: string, nome: string, extras?: Partial<Pick<Conta, 'natureza' | 'dre' | 'disponivel'>>]

const GRUPO_POR_RAIZ: Record<string, Grupo> = { '1': 'ativo', '2': 'passivo', '3': 'receita', '4': 'despesa' }
const NATUREZA_DO_GRUPO: Record<Grupo, Natureza> = { ativo: 'devedora', passivo: 'credora', pl: 'credora', receita: 'credora', custo: 'devedora', despesa: 'devedora' }

const LINHAS: Linha[] = [
  ['1', 'ATIVO'],
  ['1.1', 'Ativo circulante'],
  ['1.1.1', 'Disponível'],
  ['1.1.1.01', 'Caixa', { disponivel: true }],
  ['1.1.1.02', 'Banco conta movimento', { disponivel: true }],
  ['1.1.1.03', 'Aplicações financeiras', { disponivel: true }],
  ['1.1.2', 'Créditos'],
  ['1.1.2.01', 'Clientes a receber'],
  ['1.1.2.02', 'Adiantamentos a fornecedores'],
  ['1.1.2.03', 'Tributos a recuperar'],
  ['1.2', 'Ativo não circulante'],
  ['1.2.1', 'Imobilizado'],
  ['1.2.1.01', 'Móveis e utensílios'],
  ['1.2.1.02', 'Computadores e periféricos'],
  ['1.2.1.03', 'Veículos'],
  ['1.2.1.09', '(-) Depreciação acumulada', { natureza: 'credora' }],

  ['2', 'PASSIVO E PATRIMÔNIO LÍQUIDO'],
  ['2.1', 'Passivo circulante'],
  ['2.1.1', 'Fornecedores'],
  ['2.1.1.01', 'Fornecedores a pagar'],
  ['2.1.2', 'Obrigações tributárias'],
  ['2.1.2.01', 'Simples Nacional a recolher'],
  ['2.1.2.02', 'ISS a recolher'],
  ['2.1.2.03', 'IRRF a recolher'],
  ['2.1.3', 'Obrigações trabalhistas e previdenciárias'],
  ['2.1.3.01', 'Salários a pagar'],
  ['2.1.3.02', 'Pró-labore a pagar'],
  ['2.1.3.03', 'INSS a recolher'],
  ['2.1.3.04', 'FGTS a recolher'],
  ['2.1.4', 'Outras obrigações'],
  ['2.1.4.01', 'Empréstimos e financiamentos'],
  ['2.1.4.02', 'Lucros a distribuir'],
  ['2.3', 'Patrimônio líquido'],
  ['2.3.1', 'Capital'],
  ['2.3.1.01', 'Capital social'],
  ['2.3.2', 'Lucros e prejuízos'],
  ['2.3.2.01', 'Lucros acumulados'],
  ['2.3.2.02', '(-) Prejuízos acumulados', { natureza: 'devedora' }],
  ['2.3.2.03', '(-) Lucros distribuídos', { natureza: 'devedora' }],

  ['3', 'RECEITAS'],
  ['3.1', 'Receita operacional'],
  ['3.1.1', 'Receita bruta'],
  ['3.1.1.01', 'Receita de prestação de serviços', { dre: 'receita_bruta' }],
  ['3.1.1.02', 'Receita de venda de mercadorias', { dre: 'receita_bruta' }],
  ['3.1.2', '(-) Deduções da receita'],
  ['3.1.2.01', '(-) Simples Nacional sobre a receita', { natureza: 'devedora', dre: 'deducoes' }],
  ['3.1.2.02', '(-) ISS sobre serviços', { natureza: 'devedora', dre: 'deducoes' }],
  ['3.1.2.03', '(-) Devoluções e cancelamentos', { natureza: 'devedora', dre: 'deducoes' }],
  ['3.2', 'Outras receitas'],
  ['3.2.1', 'Receitas financeiras e diversas'],
  ['3.2.1.01', 'Receitas financeiras', { dre: 'outras_receitas' }],
  ['3.2.1.02', 'Outras receitas', { dre: 'outras_receitas' }],

  ['4', 'CUSTOS E DESPESAS'],
  ['4.1', 'Custos'],
  ['4.1.1', 'Custos das vendas e dos serviços'],
  ['4.1.1.01', 'Custo dos serviços prestados', { dre: 'custos' }],
  ['4.1.1.02', 'Custo das mercadorias vendidas', { dre: 'custos' }],
  ['4.2', 'Despesas operacionais'],
  ['4.2.1', 'Despesas com pessoal'],
  ['4.2.1.01', 'Salários e ordenados', { dre: 'despesas_pessoal' }],
  ['4.2.1.02', 'Pró-labore', { dre: 'despesas_pessoal' }],
  ['4.2.1.03', 'Encargos sociais (INSS e FGTS)', { dre: 'despesas_pessoal' }],
  ['4.2.1.04', 'Benefícios a empregados', { dre: 'despesas_pessoal' }],
  ['4.2.2', 'Despesas administrativas'],
  ['4.2.2.01', 'Aluguel e condomínio', { dre: 'despesas_administrativas' }],
  ['4.2.2.02', 'Energia, água, telefone e internet', { dre: 'despesas_administrativas' }],
  ['4.2.2.03', 'Honorários contábeis', { dre: 'despesas_administrativas' }],
  ['4.2.2.04', 'Serviços de terceiros', { dre: 'despesas_administrativas' }],
  ['4.2.2.05', 'Material de escritório e consumo', { dre: 'despesas_administrativas' }],
  ['4.2.2.06', 'Software e assinaturas', { dre: 'despesas_administrativas' }],
  ['4.2.2.07', 'Propaganda e marketing', { dre: 'despesas_administrativas' }],
  ['4.2.2.08', 'Viagens e deslocamentos', { dre: 'despesas_administrativas' }],
  ['4.2.2.09', 'Depreciação', { dre: 'despesas_administrativas' }],
  ['4.2.2.10', 'Outras despesas administrativas', { dre: 'despesas_administrativas' }],
  ['4.2.3', 'Despesas financeiras'],
  ['4.2.3.01', 'Tarifas bancárias', { dre: 'despesas_financeiras' }],
  ['4.2.3.02', 'Juros e multas', { dre: 'despesas_financeiras' }],
  ['4.2.4', 'Despesas tributárias'],
  ['4.2.4.01', 'Impostos e taxas diversas', { dre: 'despesas_tributarias' }],
]

export function grupoDoCodigo(codigo: string): Grupo {
  if (codigo === '2.3' || codigo.startsWith('2.3.')) return 'pl'
  if (codigo === '4.1' || codigo.startsWith('4.1.')) return 'custo'
  const g = GRUPO_POR_RAIZ[codigo[0]]
  if (!g) throw new Error(`Código de conta fora do plano: ${codigo}`)
  return g
}

export const naturezaPadrao = (grupo: Grupo): Natureza => NATUREZA_DO_GRUPO[grupo]

export const PLANO_PADRAO: Conta[] = LINHAS.map(([codigo, nome, extras]) => {
  const grupo = grupoDoCodigo(codigo)
  const analitica = !LINHAS.some(([outro]) => outro.startsWith(`${codigo}.`))
  return { codigo, nome, grupo, natureza: extras?.natureza ?? NATUREZA_DO_GRUPO[grupo], analitica, ...(extras?.dre ? { dre: extras.dre } : {}), ...(extras?.disponivel ? { disponivel: true } : {}) }
})

/** Ancestrais de um código, do mais próximo à raiz: "1.1.1.02" → ["1.1.1", "1.1", "1"] */
export function ancestrais(codigo: string): string[] {
  const partes = codigo.split('.')
  return partes.slice(0, -1).map((_, i) => partes.slice(0, partes.length - 1 - i).join('.'))
}
