/**
 * Guias a pagar de uma empresa: importação do PDF oficial (DAS, DARF, recibo), download, baixa
 * de pagamento e geração do recibo de honorários do próprio escritório.
 *
 * O PDF fica no Storage (fechado para o cliente, como os XMLs) e o que foi lido dele vai para
 * /empresas/{id}/guias/{id}. O id é o número do documento: reenviar a mesma guia não duplica.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createHash, randomBytes } from 'node:crypto'
import { extractText, getDocumentProxy } from 'unpdf'
import { db, storage } from '../lib/admin'
import { idDaGuia, lerGuia, type GuiaLida } from './guias'
import { caminhoGuia, configFiscalRef, configHonorariosRef, guiasRef, type ConfiguracaoFiscal, type ConfiguracaoHonorarios, type Guia } from './modelo'
import { ErroPix, gerarPixCopiaECola, normalizarChavePix } from './pix'
import { gerarReciboHonorarios } from './reciboHonorarios'

export class ErroGuia extends Error {}

const TAMANHO_MAXIMO = 7 * 1024 * 1024

const raizCnpj = (v?: string) => (v ?? '').replace(/\D/g, '').slice(0, 8)

function limpar<T extends object>(objeto: T): T {
  const podar = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.filter((v) => v !== undefined).map(podar)
    if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
      const saida: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(valor)) if (v !== undefined) saida[k] = podar(v)
      return saida
    }
    return valor
  }
  return podar(objeto) as T
}

/** 'AAAA-MM-DD' ao meio-dia de Brasília, para o dia não virar com o fuso. */
const timestampDoDia = (iso: string): Timestamp => Timestamp.fromDate(new Date(`${iso}T12:00:00-03:00`))

async function cnpjDaEmpresa(empresaId: string): Promise<string | undefined> {
  const [config, empresa] = await Promise.all([configFiscalRef(empresaId).get(), db.collection('empresas').doc(empresaId).get()])
  return ((config.data() as ConfiguracaoFiscal | undefined)?.cnpj || (empresa.data()?.cnpj as string | undefined))?.replace(/\D/g, '')
}

export async function textoDoPdf(pdf: Buffer): Promise<string> {
  const documento = await getDocumentProxy(new Uint8Array(pdf))
  const { text } = await extractText(documento, { mergePages: true })
  return text
}

export interface ResultadoImportacaoGuia {
  id: string
  nova: boolean
  guia: GuiaLida
}

/** Importa o PDF de uma guia: lê, confere se é desta empresa, guarda o arquivo e os dados. */
export async function importarGuia(
  empresaId: string,
  uid: string,
  nomeArquivo: string,
  pdf: Buffer,
  origem: 'upload' | 'serpro' = 'upload',
): Promise<ResultadoImportacaoGuia> {
  if (pdf.length > TAMANHO_MAXIMO) throw new ErroGuia('Arquivo grande demais (máximo 7 MB).')
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroGuia('O arquivo não é um PDF.')

  let texto: string
  try {
    texto = await textoDoPdf(pdf)
  } catch {
    throw new ErroGuia('Não foi possível ler o PDF. Se ele for uma imagem digitalizada, gere de novo o arquivo original no sistema da Receita.')
  }
  const guia = lerGuia(texto)

  // Um escritório atende várias empresas: guia com o CNPJ de outra não entra aqui por engano.
  const daEmpresa = await cnpjDaEmpresa(empresaId)
  if (guia.documentoContribuinte && guia.documentoContribuinte.length === 14 && daEmpresa && raizCnpj(guia.documentoContribuinte) !== raizCnpj(daEmpresa)) {
    throw new ErroGuia(`Esta guia é do CNPJ ${guia.documentoContribuinte}, que não é o desta empresa. Troque a empresa no topo e envie de novo.`)
  }

  const hashPdf = createHash('sha256').update(pdf).digest('hex')
  const id = idDaGuia(guia, hashPdf)
  const ref = guiasRef(empresaId).doc(id)
  const atual = (await ref.get()).data() as Guia | undefined

  const storagePath = caminhoGuia(empresaId, id)
  if (atual?.hashPdf !== hashPdf) {
    await storage.bucket().file(storagePath).save(pdf, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=0' } })
  }

  const agora = FieldValue.serverTimestamp()
  await ref.set(
    limpar({
      tipo: guia.tipo,
      numeroDocumento: guia.numeroDocumento,
      documentoContribuinte: guia.documentoContribuinte,
      contribuinte: guia.contribuinte,
      periodo: guia.periodo,
      vencimento: guia.vencimento,
      vencimentoEm: guia.vencimento ? timestampDoDia(guia.vencimento) : undefined,
      emissao: guia.emissao,
      valor: guia.valor,
      linhaDigitavel: guia.linhaDigitavel,
      codigoBarras: guia.codigoBarras,
      linhaDigitavelValida: guia.linhaDigitavelValida,
      composicao: guia.composicao,
      descricao: guia.descricao,
      emitente: guia.emitente,
      observacoes: guia.observacoes,
      avisos: guia.avisos,
      // a baixa de pagamento feita antes não se perde num reenvio
      status: atual?.status ?? ('pendente' as const),
      origem,
      nomeArquivo: nomeArquivo.slice(0, 200),
      storagePath,
      hashPdf,
      criadoPor: atual?.criadoPor ?? uid,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: agora,
    }),
    { merge: true },
  )
  return { id, nova: !atual, guia }
}

export async function pdfDaGuia(empresaId: string, guiaId: string): Promise<{ pdf: Buffer; nomeArquivo: string }> {
  const guia = (await guiasRef(empresaId).doc(guiaId).get()).data() as Guia | undefined
  if (!guia) throw new ErroGuia('Guia não encontrada nesta empresa.')
  // só o caminho gravado no documento, e sempre dentro da pasta desta empresa
  if (!guia.storagePath || !guia.storagePath.startsWith(`empresas/${empresaId}/guias/`)) throw new ErroGuia('O arquivo desta guia não está disponível.')
  const [pdf] = await storage.bucket().file(guia.storagePath).download()
  return { pdf, nomeArquivo: guia.nomeArquivo ?? `${guiaId}.pdf` }
}

export async function marcarPagamento(empresaId: string, uid: string, guiaId: string, paga: boolean, dataPagamento?: string): Promise<void> {
  const ref = guiasRef(empresaId).doc(guiaId)
  if (!(await ref.get()).exists) throw new ErroGuia('Guia não encontrada nesta empresa.')
  if (dataPagamento && !/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) throw new ErroGuia('Data de pagamento inválida.')
  await ref.set(
    paga
      ? { status: 'paga', pagaEm: dataPagamento ? timestampDoDia(dataPagamento) : FieldValue.serverTimestamp(), pagaPor: uid, atualizadoEm: FieldValue.serverTimestamp() }
      : { status: 'pendente', pagaEm: FieldValue.delete(), pagaPor: FieldValue.delete(), atualizadoEm: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

export async function excluirGuia(empresaId: string, guiaId: string): Promise<void> {
  const ref = guiasRef(empresaId).doc(guiaId)
  const guia = (await ref.get()).data() as Guia | undefined
  if (!guia) throw new ErroGuia('Guia não encontrada nesta empresa.')
  if (guia.storagePath?.startsWith(`empresas/${empresaId}/guias/`)) {
    await storage.bucket().file(guia.storagePath).delete({ ignoreNotFound: true })
  }
  await ref.delete()
}

export interface PedidoRecibo {
  /** 'AAAA-MM' */
  competencia: string
  valor: number
  /** 'AAAA-MM-DD' */
  vencimento: string
  descricao?: string
  /** false = recibo sem PIX mesmo com chave cadastrada */
  comPix?: boolean
}

/** Gera o recibo de honorários do mês e o coloca entre as guias a pagar da empresa. */
export async function gerarRecibo(empresaId: string, uid: string, pedido: PedidoRecibo): Promise<{ id: string; numero: string; comPix: boolean }> {
  if (!/^\d{4}-\d{2}$/.test(pedido.competencia)) throw new ErroGuia('Competência inválida.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.vencimento)) throw new ErroGuia('Vencimento inválido.')
  if (!(pedido.valor > 0)) throw new ErroGuia('O valor precisa ser maior que zero.')

  const configRef = configHonorariosRef(empresaId)
  const empresa = (await db.collection('empresas').doc(empresaId).get()).data() as { nome?: string; cnpj?: string; uf?: string } | undefined

  // numeração do recibo reservada em transação
  const { numero, config } = await db.runTransaction(async (tx) => {
    const c = (await tx.get(configRef)).data() as ConfiguracaoHonorarios | undefined
    if (!c?.emitente?.nome?.trim()) throw new ErroGuia('Cadastre primeiro os dados do escritório (nome e, se tiver, CRC) em "Honorários".')
    const proximo = c.proximoNumero ?? 1
    tx.set(configRef, { proximoNumero: proximo + 1, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true })
    return { numero: String(proximo).padStart(10, '0'), config: c }
  })

  const [ano, mes] = pedido.competencia.split('-')
  const descricao = pedido.descricao?.trim() || `Honorários contábeis - ${mes}/${ano}`
  const emissao = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const cnpj = empresa?.cnpj?.replace(/\D/g, '')

  // PIX: QR estático com o valor do recibo; o identificador aparece no extrato de quem recebe
  let pix: { copiaECola: string; chave: string; recebedor: string } | undefined
  if (pedido.comPix !== false && config.pix?.chave?.trim()) {
    try {
      const chave = normalizarChavePix(config.pix.tipo, config.pix.chave)
      const recebedor = config.pix.nome?.trim() || config.emitente.nome
      pix = { chave, recebedor, copiaECola: gerarPixCopiaECola({ chave, nome: recebedor, cidade: config.pix.cidade ?? '', valor: pedido.valor, identificador: `HON${numero}` }) }
    } catch (e) {
      if (e instanceof ErroPix) throw new ErroGuia(`${e.message} Corrija em "Editar dados do escritório".`)
      throw e
    }
  }

  const pdf = await gerarReciboHonorarios({
    emitente: config.emitente,
    cliente: {
      nome: empresa?.nome ?? 'Cliente',
      documento: cnpj?.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : undefined,
      uf: empresa?.uf,
    },
    numero,
    emissao,
    vencimento: pedido.vencimento,
    descricao,
    valor: pedido.valor,
    mensagem: config.mensagem,
    pix,
  })

  const id = `hon-${numero}`
  const storagePath = caminhoGuia(empresaId, id)
  await storage.bucket().file(storagePath).save(pdf, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=0' } })
  const agora = FieldValue.serverTimestamp()
  await guiasRef(empresaId)
    .doc(id)
    .set(
      limpar({
        tipo: 'honorarios' as const,
        numeroDocumento: numero,
        periodo: pedido.competencia,
        vencimento: pedido.vencimento,
        vencimentoEm: timestampDoDia(pedido.vencimento),
        emissao,
        valor: pedido.valor,
        pixCopiaECola: pix?.copiaECola,
        composicao: [],
        descricao,
        emitente: config.emitente.nome,
        avisos: [],
        status: 'pendente' as const,
        origem: 'gerada' as const,
        nomeArquivo: `recibo-honorarios-${numero}.pdf`,
        storagePath,
        hashPdf: createHash('sha256').update(pdf).digest('hex'),
        criadoPor: uid,
        criadoEm: agora,
        atualizadoEm: agora,
      }),
    )
  return { id, numero, comPix: Boolean(pix) }
}

// ---------- link de compartilhamento ----------

/**
 * Link para mandar a guia a quem vai pagar (WhatsApp Web não aceita arquivo vindo de outro site).
 *
 * Não é URL do Storage — ele continua fechado. É um token aleatório de 32 bytes guardado em
 * /compartilhamentos/{token} (negado a todo cliente), que vale 7 dias e só dá acesso àquela guia.
 * Quem abre o link recebe o PDF por uma function, que confere a validade a cada acesso.
 */
const VALIDADE_DO_LINK_MS = 7 * 24 * 60 * 60 * 1000
const compartilhamentosRef = () => db.collection('compartilhamentos')

export async function criarLinkDaGuia(empresaId: string, uid: string, guiaId: string): Promise<{ token: string; expiraEm: Date }> {
  const guia = (await guiasRef(empresaId).doc(guiaId).get()).data() as Guia | undefined
  if (!guia) throw new ErroGuia('Guia não encontrada nesta empresa.')
  if (!guia.storagePath?.startsWith(`empresas/${empresaId}/guias/`)) throw new ErroGuia('O arquivo desta guia não está disponível.')
  const token = randomBytes(32).toString('base64url')
  const expiraEm = new Date(Date.now() + VALIDADE_DO_LINK_MS)
  await compartilhamentosRef().doc(token).set({
    empresaId,
    guiaId,
    criadoPor: uid,
    criadoEm: FieldValue.serverTimestamp(),
    expiraEm: Timestamp.fromDate(expiraEm),
    acessos: 0,
  })
  await guiasRef(empresaId).doc(guiaId).set({ compartilhamento: { enviadoEm: FieldValue.serverTimestamp(), enviadoPor: uid, expiraEm: Timestamp.fromDate(expiraEm) } }, { merge: true })
  return { token, expiraEm }
}

export type GuiaCompartilhada = { situacao: 'ok'; pdf: Buffer; nomeArquivo: string } | { situacao: 'invalido' | 'expirado' }

export async function abrirLinkDaGuia(token: string, contarVisualizacao = true): Promise<GuiaCompartilhada> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return { situacao: 'invalido' }
  const ref = compartilhamentosRef().doc(token)
  const c = (await ref.get()).data() as { empresaId: string; guiaId: string; expiraEm: Timestamp } | undefined
  if (!c) return { situacao: 'invalido' }
  if (c.expiraEm.toMillis() < Date.now()) return { situacao: 'expirado' }
  try {
    const r = await pdfDaGuia(c.empresaId, c.guiaId)
    if (contarVisualizacao) {
      await ref.set({ acessos: FieldValue.increment(1), ultimoAcessoEm: FieldValue.serverTimestamp() }, { merge: true })
      // confirmação de leitura: fica na própria guia, para a equipe ver quem já abriu
      const guiaRef = guiasRef(c.empresaId).doc(c.guiaId)
      const jaVista = Boolean(((await guiaRef.get()).data() as Guia | undefined)?.compartilhamento?.primeiraVisualizacaoEm)
      await guiaRef.set(
        { compartilhamento: { visualizacoes: FieldValue.increment(1), ultimaVisualizacaoEm: FieldValue.serverTimestamp(), ...(jaVista ? {} : { primeiraVisualizacaoEm: FieldValue.serverTimestamp() }) } },
        { merge: true },
      )
    }
    return { situacao: 'ok', ...r }
  } catch {
    // guia excluída depois de compartilhada
    return { situacao: 'invalido' }
  }
}
