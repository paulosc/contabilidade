/**
 * Holerite (recibo de pagamento de salário) em PDF.
 *
 * É documento do empregador — não existe modelo oficial. O que ele precisa trazer, para cumprir
 * o art. 464 da CLT e servir de prova, é a identificação das partes, a competência, cada verba
 * com seu valor, as bases de cálculo e o líquido. Sai em duas vias na mesma página (empregador
 * e trabalhador), com linha de assinatura; quando o pagamento é por depósito, o comprovante
 * bancário tem força de recibo (CLT, art. 464, parágrafo único).
 */
import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import type { ResultadoCalculo } from './calculo'

const ASSETS = join(__dirname, '..', '..', 'assets')
const cm = (v: number) => v * (72 / 2.54)

export interface DadosHolerite {
  empresa: { nome: string; cnpj?: string }
  funcionario: { nome: string; cpf: string; cargo: string; dataAdmissao: string; matricula?: string; tipo: string }
  competencia: string
  resultado: ResultadoCalculo
}

const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBr = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1')
const competenciaBr = (c: string) => c.replace(/^(\d{4})-(\d{2})$/, '$2/$1')
const cpfBr = (c: string) => c.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
const cnpjBr = (c?: string) => (c ?? '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

const TIPOS: Record<string, string> = { empregado: 'Empregado', aprendiz: 'Aprendiz', prolabore: 'Sócio / pró-labore' }

function desenharVia(doc: PDFKit.PDFDocument, d: DadosHolerite, y0: number, via: string): void {
  const x0 = cm(1)
  const largura = doc.page.width - cm(2)
  const r = d.resultado
  let y = y0
  const caixa = (x: number, yy: number, w: number, h: number, fundo = false) => {
    if (fundo) doc.rect(x, yy, w, h).fill('#F2F2F2')
    doc.lineWidth(0.6).strokeColor('#000').rect(x, yy, w, h).stroke().fillColor('#000')
  }
  const rotulo = (texto: string, x: number, yy: number, w: number) => doc.font('SansBold').fontSize(6).text(texto, x + 3, yy + 2, { width: w - 6, lineBreak: false })
  const valor = (texto: string, x: number, yy: number, w: number, alinhar: 'left' | 'right' = 'left') =>
    doc.font('Sans').fontSize(8.5).text(texto, x + 3, yy + 10, { width: w - 6, height: 10, ellipsis: true, align: alinhar })

  // cabeçalho
  const hCab = cm(1.1)
  caixa(x0, y, largura, hCab, true)
  doc.font('SansBold').fontSize(10).text(d.empresa.nome.toUpperCase(), x0 + 4, y + 4, { width: largura * 0.62, lineBreak: false, ellipsis: true })
  doc.font('Sans').fontSize(8).text(d.empresa.cnpj ? `CNPJ ${cnpjBr(d.empresa.cnpj)}` : '', x0 + 4, y + 18, { lineBreak: false })
  doc.font('SansBold').fontSize(10).text('RECIBO DE PAGAMENTO DE SALÁRIO', x0, y + 4, { width: largura - 4, align: 'right', lineBreak: false })
  doc.font('Sans').fontSize(8).text(`Competência ${competenciaBr(d.competencia)}  ·  ${TIPOS[d.funcionario.tipo] ?? d.funcionario.tipo}  ·  ${via}`, x0, y + 18, { width: largura - 4, align: 'right', lineBreak: false })
  y += hCab

  // trabalhador
  const hId = cm(0.85)
  const colunas = [0.4, 0.2, 0.22, 0.18].map((p) => p * largura)
  const campos: Array<[string, string]> = [
    ['Nome', `${d.funcionario.matricula ? `${d.funcionario.matricula} · ` : ''}${d.funcionario.nome}`],
    ['CPF', cpfBr(d.funcionario.cpf)],
    ['Cargo', d.funcionario.cargo],
    ['Admissão', dataBr(d.funcionario.dataAdmissao)],
  ]
  let x = x0
  campos.forEach(([rot, val], i) => {
    caixa(x, y, colunas[i], hId)
    rotulo(rot, x, y, colunas[i])
    valor(val, x, y, colunas[i])
    x += colunas[i]
  })
  y += hId

  // verbas
  const larguras = [0.1, 0.44, 0.12, 0.17, 0.17].map((p) => p * largura)
  const titulos = ['Cód.', 'Descrição', 'Referência', 'Proventos', 'Descontos']
  const hTit = cm(0.45)
  x = x0
  titulos.forEach((t, i) => {
    caixa(x, y, larguras[i], hTit, true)
    doc.font('SansBold').fontSize(7).text(t, x + 3, y + 3, { width: larguras[i] - 6, align: i >= 3 ? 'right' : 'left', lineBreak: false })
    x += larguras[i]
  })
  y += hTit
  const hCorpo = cm(4.6)
  x = x0
  larguras.forEach((w) => {
    caixa(x, y, w, hCorpo)
    x += w
  })
  const linhas = r.linhas.filter((l) => l.tipo !== 'informativa').slice(0, 15)
  linhas.forEach((l, i) => {
    const yy = y + 4 + i * 8.4
    let xx = x0
    const celula = (texto: string, w: number, alinhar: 'left' | 'right' = 'left') => {
      doc.font('Sans').fontSize(7.5).text(texto, xx + 3, yy, { width: w - 6, align: alinhar, lineBreak: false, ellipsis: true })
      xx += w
    }
    celula(l.codigo, larguras[0])
    celula(l.descricao, larguras[1])
    celula(l.referencia ?? '', larguras[2], 'right')
    celula(l.tipo === 'provento' ? moeda(l.valor) : '', larguras[3], 'right')
    celula(l.tipo === 'desconto' ? moeda(l.valor) : '', larguras[4], 'right')
  })
  y += hCorpo

  // totais
  const hTot = cm(0.85)
  const wEsq = larguras[0] + larguras[1] + larguras[2]
  caixa(x0, y, wEsq, hTot)
  doc.font('Sans').fontSize(7).text(
    `IRRF: ${r.irrf.metodo === 'simplificado' ? 'desconto simplificado' : 'deduções legais'}${r.irrf.reducao > 0 ? ` · redução Lei 15.270/2025: ${moeda(r.irrf.reducao)}` : ''}`,
    x0 + 3,
    y + 4,
    { width: wEsq - 6, lineBreak: false, ellipsis: true },
  )
  doc.text(`Tabelas: ${r.tabelas.inss}`, x0 + 3, y + 14, { width: wEsq - 6, lineBreak: false, ellipsis: true })
  caixa(x0 + wEsq, y, larguras[3], hTot, true)
  rotulo('Total de proventos', x0 + wEsq, y, larguras[3])
  valor(moeda(r.totalProventos), x0 + wEsq, y, larguras[3], 'right')
  caixa(x0 + wEsq + larguras[3], y, larguras[4], hTot, true)
  rotulo('Total de descontos', x0 + wEsq + larguras[3], y, larguras[4])
  valor(moeda(r.totalDescontos), x0 + wEsq + larguras[3], y, larguras[4], 'right')
  y += hTot

  // bases e líquido
  const hBase = cm(0.85)
  const bases: Array<[string, string]> = [
    ['Salário base', moeda(r.linhas.find((l) => l.tipo === 'provento')?.valor ?? 0)],
    ['Base INSS', moeda(r.baseInss)],
    ['Base FGTS', moeda(r.baseFgts)],
    ['FGTS do mês', moeda(r.fgts)],
    ['Base IRRF', moeda(r.irrf.base)],
  ]
  const wBase = (largura - larguras[3] - larguras[4]) / bases.length
  x = x0
  bases.forEach(([rot, val]) => {
    caixa(x, y, wBase, hBase)
    rotulo(rot, x, y, wBase)
    valor(val, x, y, wBase, 'right')
    x += wBase
  })
  const wLiq = larguras[3] + larguras[4]
  caixa(x, y, wLiq, hBase, true)
  rotulo('LÍQUIDO A RECEBER', x, y, wLiq)
  doc.font('SansBold').fontSize(11).text(moeda(r.liquido), x + 3, y + 9, { width: wLiq - 6, align: 'right', lineBreak: false })
  y += hBase

  // assinatura
  doc.font('Sans').fontSize(7).text('Declaro ter recebido a importância líquida discriminada neste recibo.', x0, y + 8, { lineBreak: false })
  const yAss = y + 30
  doc.lineWidth(0.5).moveTo(x0, yAss).lineTo(x0 + cm(4), yAss).stroke()
  doc.text('Data', x0, yAss + 2, { lineBreak: false })
  doc.moveTo(x0 + cm(5), yAss).lineTo(x0 + largura, yAss).stroke()
  doc.text(`Assinatura — ${d.funcionario.nome}`, x0 + cm(5), yAss + 2, { width: largura - cm(5), lineBreak: false, ellipsis: true })
}

export async function gerarHoleritePdf(d: DadosHolerite): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Holerite ${competenciaBr(d.competencia)} — ${d.funcionario.nome}`, Author: d.empresa.nome } })
  const partes: Buffer[] = []
  doc.on('data', (c: Buffer) => partes.push(c))
  const fim = new Promise<void>((ok) => doc.on('end', () => ok()))
  doc.registerFont('Sans', join(ASSETS, 'LiberationSans-Regular.ttf'))
  doc.registerFont('SansBold', join(ASSETS, 'LiberationSans-Bold.ttf'))

  desenharVia(doc, d, cm(1), '1ª via — empregador')
  const meio = doc.page.height / 2
  doc.lineWidth(0.4).dash(3, { space: 3 }).moveTo(cm(0.5), meio).lineTo(doc.page.width - cm(0.5), meio).stroke().undash()
  desenharVia(doc, d, meio + cm(0.6), '2ª via — trabalhador')

  doc.end()
  await fim
  return Buffer.concat(partes)
}
