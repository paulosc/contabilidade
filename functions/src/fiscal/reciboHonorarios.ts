/**
 * Recibo de honorários contábeis — documento do próprio escritório, então este o sistema gera.
 *
 * Diferente de DAS e DARF (que só a Receita emite), o recibo não tem código de barras nem número
 * oficial: é um comprovante de cobrança entre o escritório e o cliente. Um boleto bancário de
 * verdade exigiria convênio com banco ou PSP; isto aqui é o recibo, como o que os escritórios já
 * entregam hoje.
 */
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { join } from 'node:path'
import { valorPorExtenso } from './guias'

const ASSETS = join(__dirname, '..', '..', 'assets')
const cm = (v: number) => v * (72 / 2.54)

export interface EmitenteHonorarios {
  nome: string
  /** CPF ou CNPJ, como deve aparecer impresso */
  documento?: string
  crc?: string
  telefone?: string
}

export interface DadosRecibo {
  emitente: EmitenteHonorarios
  cliente: { nome: string; documento?: string; endereco?: string; bairro?: string; cidade?: string; uf?: string }
  numero: string
  /** 'AAAA-MM-DD' */
  emissao: string
  vencimento: string
  descricao: string
  valor: number
  mensagem?: string
  /** Com PIX: QR Code e copia e cola no pé do recibo */
  pix?: { copiaECola: string; chave: string; recebedor: string }
}

const dataBr = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1')
const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function gerarReciboHonorarios(d: DadosRecibo): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Recibo de honorários ${d.numero}`, Author: d.emitente.nome } })
  const partes: Buffer[] = []
  doc.on('data', (c: Buffer) => partes.push(c))
  const fim = new Promise<void>((ok) => doc.on('end', () => ok()))
  doc.registerFont('Sans', join(ASSETS, 'LiberationSans-Regular.ttf'))
  doc.registerFont('SansBold', join(ASSETS, 'LiberationSans-Bold.ttf'))

  const x0 = cm(1)
  const largura = doc.page.width - cm(2)
  let y = cm(1)
  const caixa = (x: number, yy: number, w: number, h: number) => doc.lineWidth(0.7).strokeColor('#000').rect(x, yy, w, h).stroke()

  // ---- emitente ----
  const hEmitente = cm(1.7)
  caixa(x0, y, largura, hEmitente)
  doc.font('SansBold').fontSize(15).fillColor('#000').text(d.emitente.nome.toUpperCase(), x0 + 6, y + 5, { width: largura - 12, lineBreak: false, ellipsis: true })
  doc.font('Sans').fontSize(9)
  const linhaDocs = [d.emitente.documento ? `CPF/CNPJ: ${d.emitente.documento}` : '', d.emitente.crc ? `CRC: ${d.emitente.crc}` : ''].filter(Boolean).join('        ')
  doc.text(linhaDocs, x0 + 6, y + 24, { width: largura - 12, lineBreak: false })
  if (d.emitente.telefone) doc.text(`Telefone: ${d.emitente.telefone}`, x0 + 6, y + 35, { width: largura - 12, lineBreak: false })
  y += hEmitente

  // ---- título ----
  const hTitulo = cm(0.75)
  caixa(x0, y, largura, hTitulo)
  doc.font('SansBold').fontSize(13).text('RECIBO DE HONORÁRIOS', x0, y + 4, { width: largura, align: 'center', lineBreak: false })
  y += hTitulo + 4

  // ---- cliente e identificação ----
  const hCliente = cm(1.7)
  const wId = cm(5.6)
  const wCliente = largura - wId - 6
  caixa(x0, y, wCliente, hCliente)
  caixa(x0 + wCliente + 6, y, wId, hCliente)
  doc.font('Sans').fontSize(8.5)
  const linhaCliente = (rotulo: string, valor: string, yy: number) => {
    doc.text(rotulo, x0 + 4, yy, { width: cm(1.7), lineBreak: false })
    doc.text(`: ${valor}`, x0 + 4 + cm(1.7), yy, { width: wCliente - cm(1.9), lineBreak: false, ellipsis: true })
  }
  linhaCliente('Cliente', `${d.cliente.nome}${d.cliente.documento ? `  ·  ${d.cliente.documento}` : ''}`, y + 5)
  linhaCliente('Endereço', d.cliente.endereco ?? '-', y + 18)
  linhaCliente('Bairro', [d.cliente.bairro ?? '-', d.cliente.cidade ? `Cidade: ${d.cliente.cidade}` : '', d.cliente.uf ? `UF: ${d.cliente.uf}` : ''].filter(Boolean).join('      '), y + 31)
  const xId = x0 + wCliente + 6
  const linhaId = (rotulo: string, valor: string, yy: number) => {
    doc.text(rotulo, xId + 6, yy, { width: cm(2.2), lineBreak: false })
    doc.text(':', xId + 6 + cm(2.2), yy, { lineBreak: false })
    doc.text(valor, xId + 6 + cm(2.4), yy, { width: wId - cm(2.4) - 12, align: 'right', lineBreak: false })
  }
  linhaId('Nº', d.numero, y + 5)
  linhaId('Emissão', dataBr(d.emissao), y + 18)
  linhaId('Vencimento', dataBr(d.vencimento), y + 31)
  y += hCliente + 4

  // ---- itens ----
  const hCab = cm(0.5)
  const hItens = cm(4.6)
  const wQtd = cm(2)
  const wValor = cm(3.4)
  const wDesc = largura - wQtd - wValor
  caixa(x0, y, wQtd, hCab)
  caixa(x0 + wQtd, y, wDesc, hCab)
  caixa(x0 + wQtd + wDesc, y, wValor, hCab)
  doc.fontSize(8)
  doc.text('Quantidade', x0, y + 3, { width: wQtd, align: 'center', lineBreak: false })
  doc.text('Descrição', x0 + wQtd, y + 3, { width: wDesc, align: 'center', lineBreak: false })
  doc.text('Valor', x0 + wQtd + wDesc, y + 3, { width: wValor, align: 'center', lineBreak: false })
  y += hCab
  caixa(x0, y, wQtd, hItens)
  caixa(x0 + wQtd, y, wDesc, hItens)
  caixa(x0 + wQtd + wDesc, y, wValor, hItens)
  doc.fontSize(9)
  doc.text('1', x0, y + 4, { width: wQtd, align: 'center', lineBreak: false })
  doc.text(d.descricao, x0 + wQtd + 4, y + 4, { width: wDesc - 8, height: hItens - 8, ellipsis: true })
  doc.text(moeda(d.valor), x0 + wQtd + wDesc, y + 4, { width: wValor - 4, align: 'right', lineBreak: false })
  y += hItens + 4

  // ---- mensagem e totais ----
  const hTotais = cm(2.4)
  const wTotais = cm(7.4)
  const wMsg = largura - wTotais
  caixa(x0, y, wMsg, hTotais)
  doc.fontSize(8).text('Mensagem:', x0 + 4, y + 4, { lineBreak: false })
  doc.font('SansBold').fontSize(9).text(d.mensagem ?? 'Pagamento até a data de vencimento.', x0 + 8, y + 20, { width: wMsg - 16, height: hTotais - 26, ellipsis: true })
  const hLinha = hTotais / 2
  const total = (rotulo: string, valor: string, yy: number, negrito = false) => {
    caixa(x0 + wMsg, yy, wTotais - wValor, hLinha)
    caixa(x0 + wMsg + wTotais - wValor, yy, wValor, hLinha)
    doc.font(negrito ? 'SansBold' : 'Sans').fontSize(negrito ? 12 : 9.5)
    doc.text(rotulo, x0 + wMsg, yy + hLinha / 2 - (negrito ? 7 : 5), { width: wTotais - wValor - 6, align: 'right', lineBreak: false })
    doc.text(valor, x0 + wMsg + wTotais - wValor, yy + hLinha / 2 - (negrito ? 7 : 5), { width: wValor - 4, align: 'right', lineBreak: false })
  }
  total('Sub-Total', moeda(d.valor), y)
  total('Total', moeda(d.valor), y + hLinha, true)
  y += hTotais

  // ---- por extenso ----
  const hExtenso = cm(1)
  caixa(x0, y, largura, hExtenso)
  doc.font('Sans').fontSize(8).text('Valor total por extenso:', x0 + 4, y + 3, { lineBreak: false })
  doc.fontSize(9).text(`( ${maiuscula(valorPorExtenso(d.valor))} )`, x0 + 4, y + 14, { width: largura - 8, lineBreak: false, ellipsis: true })
  y += hExtenso + 4

  // ---- PIX ----
  if (d.pix) {
    const hPix = cm(4.2)
    const lado = cm(3.6)
    caixa(x0, y, largura, hPix)
    const qr = await QRCode.toBuffer(d.pix.copiaECola, { errorCorrectionLevel: 'M', margin: 0, scale: 8 })
    doc.image(qr, x0 + cm(0.3), y + cm(0.3), { width: lado, height: lado })
    const xTexto = x0 + lado + cm(0.8)
    const wTexto = largura - lado - cm(1.1)
    doc.font('SansBold').fontSize(12).text('Pague com PIX', xTexto, y + 8, { width: wTexto, lineBreak: false })
    doc.font('Sans').fontSize(8.5).text('Aponte a câmera do aplicativo do banco para o QR Code, ou use o PIX copia e cola abaixo.', xTexto, y + 24, { width: wTexto, lineBreak: false, ellipsis: true })
    doc.fontSize(9)
    doc.text(`Valor: R$ ${moeda(d.valor)}        Chave: ${d.pix.chave}`, xTexto, y + 39, { width: wTexto, lineBreak: false, ellipsis: true })
    doc.text(`Recebedor: ${d.pix.recebedor}`, xTexto, y + 51, { width: wTexto, lineBreak: false, ellipsis: true })
    doc.fontSize(8).text('PIX copia e cola:', xTexto, y + 67, { lineBreak: false })
    doc.fontSize(7).text(d.pix.copiaECola, xTexto, y + 78, { width: wTexto, height: hPix - 84, ellipsis: true })
    doc.fontSize(7).fillColor('#444').text('Confira o nome do recebedor no aplicativo do banco antes de confirmar o pagamento.', x0, y + hPix + 3, { width: largura, align: 'center', lineBreak: false })
    doc.fillColor('#000')
  }

  doc.end()
  await fim
  return Buffer.concat(partes)
}
