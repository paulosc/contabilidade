/**
 * Minuta do contrato de prestação de serviços contábeis.
 *
 * A Resolução CFC 1.590/2020 obriga o contrato por escrito (art. 1º) e lista o conteúdo mínimo no
 * art. 2º, alíneas "a" a "m". Cada cláusula abaixo diz qual alínea atende — assim dá para conferir
 * que nada ficou de fora. O texto é ponto de partida: o escritório revisa antes de assinar.
 */
import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { valorPorExtenso } from '../fiscal/guias'

const ASSETS = join(__dirname, '..', '..', 'assets')

export class ErroContrato extends Error {}

export const SERVICOS = {
  contabil: 'Escrituração contábil, balancetes e demonstrações contábeis de encerramento do exercício',
  fiscal: 'Escrituração fiscal, apuração dos tributos e emissão das guias de recolhimento',
  acessorias: 'Elaboração e transmissão das obrigações acessórias federais, estaduais e municipais',
  pessoal: 'Departamento pessoal: folha de pagamento, pró-labore, admissões, férias, rescisões, eSocial, DCTFWeb e FGTS',
  societario: 'Alterações contratuais e atualizações cadastrais perante Junta Comercial, Receita Federal, Estado e Município',
  irpf: 'Declaração de Imposto de Renda Pessoa Física dos sócios',
} as const
export type Servico = keyof typeof SERVICOS

/** Por natureza, alteração societária e IRPF dos sócios são eventuais; o resto é permanente. */
const EVENTUAIS: Servico[] = ['societario', 'irpf']

export const INDICES = { ipca: 'IPCA (IBGE)', inpc: 'INPC (IBGE)', igpm: 'IGP-M (FGV)' } as const

export interface Parte {
  nome: string
  documento: string
  endereco?: string
  representante?: string
  documentoRepresentante?: string
}

export interface DadosContrato {
  contratada: Parte & { crc?: string }
  contratante: Parte
  servicos: Servico[]
  outrosServicos?: string
  /** O que fica a cargo do cliente, além do padrão (alínea "c") */
  obrigacoesDoContratante?: string
  /** Dia do mês seguinte até o qual o cliente entrega a documentação */
  diaEntregaDocumentos: number
  /** 'AAAA-MM-DD' */
  inicio: string
  /** Em meses; sem valor = prazo indeterminado */
  duracaoMeses?: number
  honorarioMensal: number
  diaVencimento: number
  /** Honorário adicional em dezembro, pelo encerramento do exercício e 13º da folha */
  decimoTerceiroHonorario: boolean
  indiceReajuste: keyof typeof INDICES
  avisoPrevioDias: number
  foro: string
  /** 'AAAA-MM-DD' */
  data: string
  cidadeAssinatura: string
}

const dataPorExtenso = (iso: string) => new Date(`${iso}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
const moeda = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${valorPorExtenso(v)})`

export function validarContrato(d: DadosContrato): void {
  const falta = (c: boolean, m: string) => {
    if (c) throw new ErroContrato(m)
  }
  falta(!d.contratada?.nome?.trim() || !d.contratada.documento?.trim(), 'Informe o nome e o CPF/CNPJ do escritório.')
  falta(!d.contratante?.nome?.trim() || !d.contratante.documento?.trim(), 'Informe o nome e o CNPJ do cliente.')
  falta(!d.servicos?.length && !d.outrosServicos?.trim(), 'Escolha ao menos um serviço.')
  falta(d.servicos?.some((s) => !(s in SERVICOS)), 'Serviço inválido.')
  falta(!/^\d{4}-\d{2}-\d{2}$/.test(d.inicio ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(d.data ?? ''), 'Datas inválidas.')
  falta(!(d.honorarioMensal > 0), 'Informe o valor dos honorários.')
  falta(!(d.diaVencimento >= 1 && d.diaVencimento <= 31) || !(d.diaEntregaDocumentos >= 1 && d.diaEntregaDocumentos <= 31), 'Dia do mês inválido.')
  falta(!(d.avisoPrevioDias >= 1 && d.avisoPrevioDias <= 180), 'O aviso prévio deve ficar entre 1 e 180 dias.')
  falta(!(d.indiceReajuste in INDICES), 'Índice de reajuste inválido.')
  falta(!d.foro?.trim() || !d.cidadeAssinatura?.trim(), 'Informe o foro e a cidade da assinatura.')
  falta(d.duracaoMeses !== undefined && !(d.duracaoMeses >= 1 && d.duracaoMeses <= 120), 'Duração inválida.')
}

export interface Clausula {
  titulo: string
  /** Alínea(s) do art. 2º da Resolução CFC 1.590/2020 que a cláusula atende */
  alineas: string
  paragrafos: string[]
}

const qualificar = (p: Parte & { crc?: string }) =>
  [
    `${p.nome.trim()}, inscrita no CPF/CNPJ sob o nº ${p.documento.trim()}`,
    p.crc ? `, registro no CRC nº ${p.crc.trim()}` : '',
    p.endereco?.trim() ? `, com endereço em ${p.endereco.trim()}` : '',
    p.representante?.trim() ? `, neste ato representada por ${p.representante.trim()}${p.documentoRepresentante?.trim() ? `, CPF nº ${p.documentoRepresentante.trim()}` : ''}` : '',
  ].join('')

/** O texto do contrato, cláusula a cláusula — separado do PDF para poder ser conferido em teste. */
export function clausulasDoContrato(d: DadosContrato): { preambulo: string; clausulas: Clausula[] } {
  validarContrato(d)
  const permanentes = d.servicos.filter((s) => !EVENTUAIS.includes(s))
  const eventuais = d.servicos.filter((s) => EVENTUAIS.includes(s))
  const lista = (itens: string[]) => itens.map((t, i) => `${String.fromCharCode(97 + i)}) ${t};`)

  const preambulo =
    `Pelo presente instrumento particular, de um lado, como CONTRATADA, ${qualificar(d.contratada)}; e, de outro lado, como CONTRATANTE, ${qualificar(d.contratante)}, ` +
    'têm entre si justo e contratado o que segue, nos termos da Resolução CFC nº 1.590, de 19 de março de 2020.'

  const clausulas: Clausula[] = [
    {
      titulo: 'DO OBJETO E DOS SERVIÇOS',
      alineas: 'a, b',
      paragrafos: [
        'A CONTRATADA prestará à CONTRATANTE os serviços profissionais abaixo, de forma permanente, mês a mês:',
        ...lista([...permanentes.map((s) => SERVICOS[s]), ...(d.outrosServicos?.trim() ? [d.outrosServicos.trim()] : [])]),
        ...(eventuais.length ? ['Serão prestados de forma eventual, quando solicitados pela CONTRATANTE:', ...lista(eventuais.map((s) => SERVICOS[s]))] : []),
        'Parágrafo único. Serviços não relacionados nesta cláusula — entre eles abertura e baixa de empresa, parcelamentos, defesas e recursos administrativos, atendimento a fiscalizações, certidões, DECORE e retificações causadas por informação incorreta da CONTRATANTE — são eventuais e dependem de orçamento aceito por escrito.',
      ],
    },
    {
      titulo: 'DOS SERVIÇOS E OBRIGAÇÕES A CARGO DA CONTRATANTE',
      alineas: 'c',
      paragrafos: [
        'Ficam a cargo da CONTRATANTE, que por eles responde integralmente:',
        ...lista([
          'a emissão das notas fiscais de suas operações e o controle financeiro, de caixa, de contas a pagar e a receber e de estoques',
          `a entrega à CONTRATADA, até o dia ${d.diaEntregaDocumentos} do mês seguinte, de toda a documentação do mês: extratos bancários de todas as contas, notas e comprovantes de despesas, contratos, e as ocorrências de pessoal (admissões, faltas, horas extras, férias, afastamentos e desligamentos)`,
          'o pagamento, nos vencimentos, dos tributos, encargos e demais guias apuradas pela CONTRATADA',
          'a comunicação prévia, por escrito, de admissões, desligamentos, alterações societárias, mudança de endereço ou de atividade',
          'a guarda dos documentos originais pelos prazos legais',
          ...(d.obrigacoesDoContratante?.trim() ? [d.obrigacoesDoContratante.trim()] : []),
        ]),
        'Parágrafo único. A CONTRATADA não responde por multas, juros ou autuações decorrentes de documento ou informação não entregue, entregue fora do prazo desta cláusula, incompleto ou inverídico.',
      ],
    },
    {
      titulo: 'DA DURAÇÃO',
      alineas: 'd',
      paragrafos: [
        d.duracaoMeses
          ? `Este contrato vigora por ${d.duracaoMeses} ${d.duracaoMeses === 1 ? 'mês' : 'meses'}, a contar de ${dataPorExtenso(d.inicio)}, renovando-se automaticamente por iguais períodos se nenhuma das partes se manifestar em contrário com a antecedência da cláusula de rescisão.`
          : `Este contrato vigora por prazo indeterminado, a contar de ${dataPorExtenso(d.inicio)}.`,
        'Parágrafo único. A responsabilidade técnica da CONTRATADA alcança apenas as competências a partir do início da vigência; períodos anteriores dependem de contratação específica.',
      ],
    },
    {
      titulo: 'DOS HONORÁRIOS E DO PRAZO DE PAGAMENTO',
      alineas: 'e, f',
      paragrafos: [
        `Pelos serviços permanentes da cláusula primeira, a CONTRATANTE pagará honorários mensais de ${moeda(d.honorarioMensal)}, com vencimento no dia ${d.diaVencimento} de cada mês.`,
        ...(d.decimoTerceiroHonorario
          ? ['Parágrafo primeiro. Em dezembro de cada ano será devido um honorário adicional, de valor igual ao mensal, pelo encerramento do exercício e pelas rotinas anuais de pessoal, proporcional aos meses de vigência no ano.']
          : []),
        `Parágrafo ${d.decimoTerceiroHonorario ? 'segundo' : 'primeiro'}. Os serviços eventuais são cobrados à parte, pelo valor do orçamento aceito, com vencimento nele indicado.`,
        `Parágrafo ${d.decimoTerceiroHonorario ? 'terceiro' : 'segundo'}. O atraso no pagamento sujeita a CONTRATANTE a multa de 2% (dois por cento), juros de 1% (um por cento) ao mês e atualização monetária pelo índice da cláusula de reajuste. Atraso superior a 60 (sessenta) dias autoriza a suspensão dos serviços, mediante aviso por escrito, sem prejuízo da cobrança.`,
      ],
    },
    {
      titulo: 'DO REAJUSTE',
      alineas: 'g',
      paragrafos: [
        `Os honorários serão reajustados a cada 12 (doze) meses, contados do início da vigência, pela variação acumulada do ${INDICES[d.indiceReajuste]} no período ou, na falta dele, pelo índice que o substituir.`,
        'Parágrafo único. Aumento relevante do volume de trabalho — de faturamento, de número de empregados, de estabelecimentos ou mudança de regime tributário — autoriza a revisão dos honorários, por aditivo.',
      ],
    },
    {
      titulo: 'DAS RESPONSABILIDADES DAS PARTES',
      alineas: 'h',
      paragrafos: [
        'A CONTRATADA obriga-se a executar os serviços com zelo e técnica, nos prazos legais, observando as Normas Brasileiras de Contabilidade e o Código de Ética Profissional do Contador; a guardar sigilo sobre os dados e negócios da CONTRATANTE; e a responder pelos erros a que der causa, inclusive pelas multas decorrentes de atraso seu.',
        'A CONTRATANTE obriga-se a cumprir a cláusula segunda, a fornecer informações verdadeiras e completas e a pagar os honorários nos vencimentos, respondendo pela veracidade e pela idoneidade dos documentos que entregar.',
        'Parágrafo único. As partes tratarão os dados pessoais envolvidos na execução deste contrato conforme a Lei nº 13.709/2018 (LGPD), figurando a CONTRATANTE como controladora e a CONTRATADA como operadora, que os utilizará apenas para cumprir as obrigações aqui assumidas e as impostas por lei.',
      ],
    },
    {
      titulo: 'DO ADITAMENTO',
      alineas: 'i',
      paragrafos: ['Qualquer alteração deste contrato — inclusão ou exclusão de serviços, revisão de honorários ou de prazos — só vale se feita por aditivo escrito e assinado pelas partes.'],
    },
    {
      titulo: 'DA CARTA DE RESPONSABILIDADE DA ADMINISTRAÇÃO',
      alineas: 'j',
      paragrafos: [
        'A CONTRATANTE fornecerá à CONTRATADA, anualmente, para fins de encerramento do exercício, a Carta de Responsabilidade da Administração de que trata a ITG 1000, assinada por seus administradores.',
        'Parágrafo único. Na recusa, a CONTRATADA avaliará a justificativa e os riscos para a continuidade dos serviços e adotará as salvaguardas que entender necessárias, nos termos do art. 3º, parágrafo único, da Resolução CFC nº 1.590/2020.',
      ],
    },
    {
      titulo: 'DA PREVENÇÃO À LAVAGEM DE DINHEIRO',
      alineas: 'k',
      paragrafos: [
        'A CONTRATANTE declara ciência de que a CONTRATADA está sujeita à Lei nº 9.613/1998 e à regulamentação do Conselho Federal de Contabilidade, que a obrigam a manter cadastro e registro das operações de seus clientes e a comunicar ao Conselho de Controle de Atividades Financeiras (COAF), sem dar ciência ao cliente, as operações e propostas de operação que possam constituir indício dos crimes previstos naquela lei.',
      ],
    },
    {
      titulo: 'DA RESCISÃO',
      alineas: 'l',
      paragrafos: [
        `Qualquer das partes pode rescindir este contrato, sem ônus, mediante aviso prévio por escrito de ${d.avisoPrevioDias} (${valorPorExtenso(d.avisoPrevioDias).replace(/ rea(l|is)$/, '')}) dias, durante os quais os serviços e os honorários continuam devidos.`,
        'Parágrafo primeiro. O encerramento será formalizado por distrato, que fixará a cessação das responsabilidades, a forma e o prazo de devolução de livros, documentos e arquivos, inclusive eletrônicos, e a obrigação da CONTRATANTE de recebê-los, por si ou por representante autorizado por escrito.',
        'Parágrafo segundo. Salvo disposição diversa no distrato, cabe à CONTRATADA cumprir as obrigações acessórias das competências decorridas na vigência do contrato, ainda que vençam depois, e elaborar as demonstrações contábeis do período sob sua responsabilidade, desde que quitados os honorários correspondentes e entregue a documentação necessária.',
      ],
    },
    {
      titulo: 'DO FORO',
      alineas: 'm',
      paragrafos: [`Fica eleito o foro da comarca de ${d.foro.trim()} para dirimir as questões oriundas deste contrato, com renúncia a qualquer outro.`],
    },
  ]
  return { preambulo, clausulas }
}

const ORDINAIS = ['PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA', 'DÉCIMA', 'DÉCIMA PRIMEIRA', 'DÉCIMA SEGUNDA']

export async function gerarContratoPdf(d: DadosContrato): Promise<Buffer> {
  const { preambulo, clausulas } = clausulasDoContrato(d)
  const margem = 72
  const doc = new PDFDocument({ size: 'A4', margins: { top: margem, bottom: margem, left: margem, right: margem }, bufferPages: true, info: { Title: 'Contrato de prestação de serviços contábeis', Author: d.contratada.nome } })
  const partes: Buffer[] = []
  doc.on('data', (c: Buffer) => partes.push(c))
  const fim = new Promise<void>((ok) => doc.on('end', () => ok()))
  doc.registerFont('Sans', join(ASSETS, 'LiberationSans-Regular.ttf'))
  doc.registerFont('SansBold', join(ASSETS, 'LiberationSans-Bold.ttf'))
  const largura = doc.page.width - margem * 2

  doc.font('SansBold').fontSize(13).text('CONTRATO DE PRESTAÇÃO DE SERVIÇOS CONTÁBEIS', { align: 'center' })
  doc.moveDown(1.2)
  doc.font('Sans').fontSize(10.5).text(preambulo, { align: 'justify', lineGap: 2 })

  clausulas.forEach((c, i) => {
    doc.moveDown(0.9)
    if (doc.y > doc.page.height - margem - 70) doc.addPage()
    doc.font('SansBold').fontSize(10.5).text(`CLÁUSULA ${ORDINAIS[i]} — ${c.titulo}`, { align: 'left' })
    doc.moveDown(0.3)
    doc.font('Sans').fontSize(10.5)
    for (const p of c.paragrafos) {
      const item = /^[a-z]\) /.test(p)
      doc.text(p, item ? margem + 14 : margem, doc.y, { align: 'justify', lineGap: 2, width: item ? largura - 14 : largura })
      doc.moveDown(0.35)
    }
  })

  doc.moveDown(0.9)
  if (doc.y > doc.page.height - margem - 230) doc.addPage()
  doc.font('Sans').fontSize(10.5).text('E, por estarem justas e contratadas, as partes assinam este instrumento em 2 (duas) vias de igual teor, na presença de duas testemunhas.', margem, doc.y, { align: 'justify', lineGap: 2, width: largura })
  doc.moveDown(1)
  doc.text(`${d.cidadeAssinatura.trim()}, ${dataPorExtenso(d.data)}.`, { align: 'right' })

  const assinatura = (rotulo: string, nome: string, x: number, y: number, w: number) => {
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.6).strokeColor('#000').stroke()
    doc.font('SansBold').fontSize(9).text(rotulo, x, y + 4, { width: w, align: 'center' })
    doc.font('Sans').fontSize(9).text(nome, x, y + 16, { width: w, align: 'center' })
  }
  const w = (largura - 30) / 2
  let y = doc.y + 55
  assinatura('CONTRATADA', d.contratada.nome, margem, y, w)
  assinatura('CONTRATANTE', d.contratante.nome, margem + w + 30, y, w)
  y += 75
  assinatura('TESTEMUNHA 1', 'Nome e CPF:', margem, y, w)
  assinatura('TESTEMUNHA 2', 'Nome e CPF:', margem + w + 30, y, w)

  // rodapé com numeração, depois de saber quantas páginas deu
  const total = doc.bufferedPageRange().count
  for (let p = 0; p < total; p++) {
    doc.switchToPage(p)
    // o rodapé fica abaixo da margem; sem zerá-la o pdfkit abriria uma página nova para ele
    doc.page.margins.bottom = 0
    doc.font('Sans').fontSize(8).fillColor('#555').text(`Página ${p + 1} de ${total}`, margem, doc.page.height - 45, { width: largura, align: 'center', lineBreak: false })
    doc.fillColor('#000')
  }
  doc.end()
  await fim
  return Buffer.concat(partes)
}
