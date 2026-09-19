/**
 * Emissão, substituição e cancelamento de NFS-e pelo SEFIN Nacional.
 *
 * Fluxo da emissão: numerar (transação) → montar o DPS → assinar → conferir no SEFIN se esse
 * DPS já virou nota (GET /dps/{id}, contra reenvio) → POST /nfse → guardar a NFS-e devolvida
 * na mesma coleção da sincronização, para a lista ser uma só.
 *
 * Numeração própria: série na faixa de "aplicativo próprio" (00001–49999, Anexo I) e número
 * sequencial por empresa, guardados em configuracoes/fiscal.emissao. O Emissor Web usa a série
 * 70000, então as duas numerações nunca se cruzam.
 *
 * Produção só com confirmação explícita: nota emitida é documento com efeito fiscal.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { storage } from '../lib/admin'
import { SefinNacionalClient, resumirErros, type MensagemSefin } from '../providers/fiscal/sefinNacional'
import { assinarXml, materialDoPfx, verificarAssinatura, type MaterialAssinatura } from './assinatura'
import { decifrar } from './certificado'
import { agoraBrasilia, lerDpsDeNfse, montarDps, montarPedidoCancelamento, type AmbienteNfse, type DadosDps, type MotivoCancelamento } from './dps'
import { regrasDoRegime } from './notaNova'
import { configFiscalRef, notasServicoRef, privadoFiscalRef, type ConfiguracaoFiscal, type NotaServico, type PrivadoFiscal } from './modelo'
import { gravarDocumento, type Contadores } from './sincronizacaoNfse'

export class ErroEmissao extends Error {
  constructor(
    mensagem: string,
    readonly mensagens: MensagemSefin[] = [],
  ) {
    super(mensagem)
  }
}

/** Série padrão de aplicativo próprio. O Anexo I reserva 00001–49999 para isso. */
export const SERIE_PADRAO = '1'
const SERIE_MAXIMA_APLICATIVO = 49999

export interface NumeracaoEmissao {
  serie: string
  proximoNumero: number
}

interface CredenciaisEmissao {
  material: MaterialAssinatura
  cliente: SefinNacionalClient
  /** CNPJ/CPF do certificado, só dígitos */
  documento: string
  config: ConfiguracaoFiscal
}

async function credenciais(empresaId: string, chaveMestra: string, ambiente: AmbienteNfse): Promise<CredenciaisEmissao> {
  const [confSnap, privSnap] = await Promise.all([configFiscalRef(empresaId).get(), privadoFiscalRef(empresaId).get()])
  const config = confSnap.data() as ConfiguracaoFiscal | undefined
  const privado = privSnap.data() as PrivadoFiscal | undefined
  if (!config || !privado?.certificado) throw new ErroEmissao('Integração fiscal sem certificado cadastrado.')
  const cert = privado.certificado
  if (cert.validoAte.toDate().getTime() < Date.now()) {
    throw new ErroEmissao(`Certificado digital vencido em ${cert.validoAte.toDate().toLocaleDateString('pt-BR')}.`)
  }
  const pfxBase64 = decifrar(cert.arquivoCifrado, chaveMestra)
  const senha = decifrar(cert.senhaCifrada, chaveMestra)
  return {
    material: materialDoPfx(pfxBase64, senha),
    cliente: new SefinNacionalClient({ pfxBase64, senha, ambiente }),
    documento: cert.documento.replace(/\D/g, ''),
    config,
  }
}

/** Explicação para a tela quando o município não tem convênio no ambiente escolhido. */
export function mensagemSemConvenio(codigoMunicipio: string, ambiente: AmbienteNfse): string {
  return ambiente === 'homologacao'
    ? `O município emissor (IBGE ${codigoMunicipio}) não aderiu ao ambiente de TESTE (produção restrita) do Sistema Nacional — muitos municípios aderem só à produção. Não dá para testar a emissão por lá; a alternativa é emitir em produção uma nota de valor baixo e cancelá-la em seguida, ou pedir à prefeitura a adesão à produção restrita.`
    : `O município emissor (IBGE ${codigoMunicipio}) não tem convênio ativo com o Sistema Nacional NFS-e em produção. A emissão tem de ser pelo sistema próprio da prefeitura; confirme com ela.`
}

/** Reserva o próximo número da série numa transação: dois cliques não geram o mesmo DPS. */
export async function reservarNumero(empresaId: string): Promise<NumeracaoEmissao> {
  const ref = configFiscalRef(empresaId)
  return ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const atual = (snap.data() as ConfiguracaoFiscal | undefined)?.emissao
    const serie = atual?.serie ?? SERIE_PADRAO
    if (Number(serie) < 1 || Number(serie) > SERIE_MAXIMA_APLICATIVO) {
      throw new ErroEmissao(`Série ${serie} fora da faixa de aplicativo próprio (1 a ${SERIE_MAXIMA_APLICATIVO}).`)
    }
    const numero = atual?.proximoNumero ?? 1
    tx.set(ref, { emissao: { serie, proximoNumero: numero + 1 }, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true })
    return { serie, proximoNumero: numero }
  })
}

/**
 * Modelo para "gerar uma nota igual": o DPS original da nota escolhida, já sem o que muda
 * (numeração, data) e com a lista do que ela tinha e a emissão não reproduz.
 */
export async function modeloDeNota(empresaId: string, chaveAcesso: string): Promise<{ dados: DadosDps; gruposIgnorados: string[] }> {
  const snap = await notasServicoRef(empresaId).doc(chaveAcesso).get()
  const nota = snap.data() as NotaServico | undefined
  if (!nota) throw new ErroEmissao('Nota não encontrada nesta empresa.')
  if (nota.origem === 'municipal') throw new ErroEmissao('Nota do sistema municipal antigo não serve de modelo: o DPS nacional não existe nela.')
  if (nota.papel !== 'prestador') throw new ErroEmissao('Só notas emitidas pela empresa servem de modelo (nesta ela é tomadora).')
  if (!nota.storagePath) throw new ErroEmissao('O XML desta nota não está guardado.')
  const [xml] = await storage.bucket().file(nota.storagePath).download()
  const { dados, gruposIgnorados } = lerDpsDeNfse(xml.toString('utf8'))
  dados.serie = ''
  dados.numero = ''
  dados.dhEmi = ''
  return { dados, gruposIgnorados }
}

export interface ResultadoEmissao {
  chaveAcesso: string
  numero?: string
  idDps: string
  serie: string
  numeroDps: string
  ambiente: AmbienteNfse
  alertas: MensagemSefin[]
}

/**
 * Emite uma NFS-e. `dados` vem da tela já revisado; numeração, data/hora e ambiente são
 * definidos aqui. Se `dados.substituicao` estiver presente, é uma substituição: o SEFIN gera
 * a nota nova e registra o cancelamento por substituição na antiga.
 */
export async function emitirNfse(
  empresaId: string,
  chaveMestra: string,
  dados: DadosDps,
  ambiente: AmbienteNfse,
  uid: string,
): Promise<ResultadoEmissao> {
  // combinações que o SEFIN rejeitaria: melhor um erro claro antes de gastar número de DPS
  regrasDoRegime(dados)
  const cred = await credenciais(empresaId, chaveMestra, ambiente)
  try {
    const docPrestador = (dados.prestador.cnpj ?? dados.prestador.cpf ?? '').replace(/\D/g, '')
    if (docPrestador !== cred.documento) {
      throw new ErroEmissao('O prestador do DPS precisa ser o titular do certificado digital desta empresa (regra E0718).')
    }

    // Consulta de convênio só para diagnóstico: o formato real da resposta ainda não foi visto e
    // um 404 pode ser "rota inexistente" e não "município sem convênio". Quem decide é o SEFIN
    // (E0037/E0038), cuja resposta é traduzida mais abaixo. Nunca bloqueia a emissão.
    const convenio = await cred.cliente.consultarConvenio(dados.codigoMunicipioEmissao)
    logger.info('nfse: convênio do município (diagnóstico)', {
      empresaId,
      ambiente,
      municipio: dados.codigoMunicipioEmissao,
      situacao: convenio.situacao,
      status: convenio.status,
      fonte: convenio.fonte,
      detalhe: convenio.detalhe?.slice(0, 500),
    })

    const numeracao = await reservarNumero(empresaId)
    const completo: DadosDps = {
      ...dados,
      ambiente,
      serie: numeracao.serie,
      numero: String(numeracao.proximoNumero),
      dhEmi: agoraBrasilia(),
    }
    const { xml, id } = montarDps(completo)
    const assinado = assinarXml(xml, id, cred.material)
    if (!verificarAssinatura(assinado, cred.material.certificadoPem)) {
      throw new ErroEmissao('A assinatura do DPS não conferiu localmente; nada foi enviado.')
    }

    // O número foi reservado, então este id nunca foi usado — a não ser que uma tentativa
    // anterior tenha caído depois do envio. Conferir antes evita nota em dobro.
    const existente = await cred.cliente.consultarDps(id)
    if (existente.status === 200 && existente.chaveAcesso) {
      throw new ErroEmissao(`Este DPS (${id}) já gerou a NFS-e ${existente.chaveAcesso}. Sincronize as notas.`)
    }

    const inicio = Date.now()
    const resposta = await cred.cliente.emitir(assinado)
    logger.info('nfse: emissão', {
      empresaId,
      operacao: 'emitirNfse',
      ambiente,
      idDps: id,
      status: resposta.status,
      chaveAcesso: resposta.chaveAcesso,
      erros: resposta.erros.map((e) => e.codigo),
      duracaoMs: Date.now() - inicio,
      uid,
    })
    if (resposta.status !== 201 && resposta.status !== 200) {
      if (resposta.erros.some((e) => e.codigo === 'E0037' || e.codigo === 'E0038')) {
        throw new ErroEmissao(`${mensagemSemConvenio(dados.codigoMunicipioEmissao, ambiente)} (${resumirErros(resposta.erros)})`, resposta.erros)
      }
      throw new ErroEmissao(`O SEFIN não gerou a nota: ${resumirErros(resposta.erros)}`, resposta.erros)
    }
    if (!resposta.chaveAcesso || !resposta.nfseXml) {
      throw new ErroEmissao('O SEFIN respondeu sucesso, mas sem a NFS-e. Sincronize as notas para conferir.', resposta.erros)
    }

    const contadores: Contadores = { novas: 0, atualizadas: 0, eventos: 0, erros: 0, processados: 0 }
    await gravarDocumento(empresaId, cred.documento, ambiente, { xml: resposta.nfseXml }, contadores)
    await notasServicoRef(empresaId)
      .doc(resposta.chaveAcesso)
      .set({ origem: 'adn', emitidaPor: uid, emitidaEm: FieldValue.serverTimestamp(), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true })

    if (dados.substituicao) {
      // O SEFIN registra o cancelamento por substituição na nota antiga; refletimos já na
      // lista, e a sincronização traz o evento oficial em seguida.
      await notasServicoRef(empresaId)
        .doc(dados.substituicao.chaveSubstituida.replace(/\D/g, ''))
        .set(
          { status: 'cancelada', situacao: 'Substituída', substituidaPor: resposta.chaveAcesso, atualizadoEm: FieldValue.serverTimestamp() },
          { merge: true },
        )
    }

    const numero = /<nNFSe>(\d+)<\/nNFSe>/.exec(resposta.nfseXml)?.[1]
    return {
      chaveAcesso: resposta.chaveAcesso,
      numero,
      idDps: id,
      serie: numeracao.serie,
      numeroDps: String(numeracao.proximoNumero),
      ambiente,
      alertas: resposta.alertas,
    }
  } finally {
    cred.cliente.encerrar()
  }
}

export interface ResultadoCancelamento {
  chaveAcesso: string
  ambiente: AmbienteNfse
  dataHoraProcessamento?: string
}

/** Registra o evento de cancelamento (e101101) e marca a nota como cancelada. */
export async function cancelarNfse(
  empresaId: string,
  chaveMestra: string,
  chaveAcesso: string,
  motivo: MotivoCancelamento,
  descricao: string,
  uid: string,
): Promise<ResultadoCancelamento> {
  const chave = chaveAcesso.replace(/\D/g, '')
  const ref = notasServicoRef(empresaId).doc(chave)
  const nota = (await ref.get()).data() as NotaServico | undefined
  if (!nota) throw new ErroEmissao('Nota não encontrada nesta empresa.')
  if (nota.origem === 'municipal') throw new ErroEmissao('Nota do sistema municipal antigo: o cancelamento é pelo portal da prefeitura.')
  if (nota.papel !== 'prestador') throw new ErroEmissao('Só o prestador cancela a própria nota.')
  if (nota.status === 'cancelada') throw new ErroEmissao('Esta nota já está cancelada.')
  const ambiente: AmbienteNfse = nota.ambiente === 'homologacao' ? 'homologacao' : 'producao'

  const cred = await credenciais(empresaId, chaveMestra, ambiente)
  try {
    const autor = cred.documento.length === 11 ? { cpf: cred.documento } : { cnpj: cred.documento }
    const { xml, id } = montarPedidoCancelamento({ ambiente, dhEvento: agoraBrasilia(), autor, chave, motivo, descricao })
    const assinado = assinarXml(xml, id, cred.material)
    if (!verificarAssinatura(assinado, cred.material.certificadoPem)) {
      throw new ErroEmissao('A assinatura do pedido não conferiu localmente; nada foi enviado.')
    }

    const inicio = Date.now()
    const resposta = await cred.cliente.registrarEvento(chave, assinado)
    logger.info('nfse: cancelamento', {
      empresaId,
      operacao: 'cancelarNfse',
      ambiente,
      chaveAcesso: chave,
      status: resposta.status,
      erros: resposta.erros.map((e) => e.codigo),
      duracaoMs: Date.now() - inicio,
      uid,
    })
    if (resposta.status !== 201 && resposta.status !== 200) {
      throw new ErroEmissao(`O SEFIN não registrou o cancelamento: ${resumirErros(resposta.erros)}`, resposta.erros)
    }

    if (resposta.eventoXml) {
      const contadores: Contadores = { novas: 0, atualizadas: 0, eventos: 0, erros: 0, processados: 0 }
      await gravarDocumento(empresaId, cred.documento, ambiente, { xml: resposta.eventoXml }, contadores)
    }
    await ref.set(
      {
        status: 'cancelada',
        situacao: 'Cancelada',
        cancelamento: { motivo, descricao, em: FieldValue.serverTimestamp(), por: uid, processadoEm: resposta.dataHoraProcessamento ?? null },
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return { chaveAcesso: chave, ambiente, dataHoraProcessamento: resposta.dataHoraProcessamento }
  } finally {
    cred.cliente.encerrar()
  }
}

/** Para a tela: a numeração atual, sem reservar nada. */
export async function numeracaoAtual(empresaId: string): Promise<NumeracaoEmissao> {
  const snap = await configFiscalRef(empresaId).get()
  const e = (snap.data() as ConfiguracaoFiscal | undefined)?.emissao
  return { serie: e?.serie ?? SERIE_PADRAO, proximoNumero: e?.proximoNumero ?? 1 }
}
