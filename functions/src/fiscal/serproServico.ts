/**
 * Geração oficial de guias pela Receita Federal, via Integra Contador (Serpro).
 *
 * O que fica guardado:
 *   /empresas/{id}/privado/serpro         consumer key e secret CIFRADAS (nunca voltam ao cliente)
 *   /empresas/{id}/configuracoes/fiscal   resumo público: { serpro: { configurado, contratante } }
 *
 * Nesta versão o contratante do Serpro é a própria empresa: o certificado A1 dela autentica e
 * ela é contratante, autora e contribuinte — o caso em que a procuração eletrônica é dispensada.
 * O PDF devolvido passa pelo mesmo leitor das guias enviadas à mão e entra em "Guias a pagar".
 */
import { FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import {
  ErroSerpro,
  SERPRO_CNPJ_TRIAL,
  SerproIntegraContador,
  type DeclaracaoPgdasd,
} from '../providers/fiscal/serproIntegraContador'
import { cifrar, decifrar } from './certificado'
import { lerGuia } from './guias'
import { importarGuia, textoDoPdf, type ResultadoImportacaoGuia } from './guiasServico'
import { configFiscalRef, privadoFiscalRef, privadoSerproRef, type ConfiguracaoFiscal, type PrivadoFiscal, type PrivadoSerpro } from './modelo'

export { ErroSerpro }

const soDigitos = (v?: string) => (v ?? '').replace(/\D/g, '')

export async function salvarCredenciais(empresaId: string, chaveMestra: string, consumerKey: string, consumerSecret: string): Promise<void> {
  const key = consumerKey.trim()
  const secret = consumerSecret.trim()
  if (key.length < 8 || secret.length < 8) throw new ErroSerpro('Informe a consumer key e a consumer secret do contrato com o Serpro.')
  const privado = (await privadoFiscalRef(empresaId).get()).data() as PrivadoFiscal | undefined
  if (!privado?.certificado) throw new ErroSerpro('Cadastre primeiro o certificado digital A1: o Serpro autentica com o mesmo e-CNPJ da contratação.')

  await privadoSerproRef(empresaId).set({
    consumerKeyCifrada: cifrar(key, chaveMestra),
    consumerSecretCifrada: cifrar(secret, chaveMestra),
    atualizadoEm: FieldValue.serverTimestamp(),
  })
  await configFiscalRef(empresaId).set(
    { serpro: { configurado: true, contratante: soDigitos(privado.certificado.documento), atualizadoEm: FieldValue.serverTimestamp() }, atualizadoEm: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

export async function removerCredenciais(empresaId: string): Promise<void> {
  await privadoSerproRef(empresaId).delete()
  await configFiscalRef(empresaId).set({ serpro: FieldValue.delete(), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true })
}

interface Sessao {
  cliente: SerproIntegraContador
  /** CNPJ do contribuinte = titular do certificado */
  contribuinte: string
}

async function abrirSessao(empresaId: string, chaveMestra: string): Promise<Sessao> {
  const [confSnap, privSnap, serproSnap] = await Promise.all([configFiscalRef(empresaId).get(), privadoFiscalRef(empresaId).get(), privadoSerproRef(empresaId).get()])
  const config = confSnap.data() as ConfiguracaoFiscal | undefined
  const privado = privSnap.data() as PrivadoFiscal | undefined
  const serpro = serproSnap.data() as PrivadoSerpro | undefined
  if (!privado?.certificado) throw new ErroSerpro('Certificado digital não cadastrado.')
  if (!serpro) throw new ErroSerpro('As credenciais do Serpro (Integra Contador) ainda não foram cadastradas.')
  const cert = privado.certificado
  if (cert.validoAte.toDate().getTime() < Date.now()) throw new ErroSerpro(`Certificado digital vencido em ${cert.validoAte.toDate().toLocaleDateString('pt-BR')}.`)

  const titular = soDigitos(cert.documento)
  const contribuinte = soDigitos(config?.cnpj) || titular
  if (contribuinte.slice(0, 8) !== titular.slice(0, 8)) {
    throw new ErroSerpro('O CNPJ da empresa não tem a mesma raiz do certificado. Emitir por outro CNPJ exige procuração eletrônica no e-CAC, o que esta versão ainda não cobre.')
  }
  return {
    contribuinte,
    cliente: new SerproIntegraContador({
      ambiente: 'producao',
      consumerKey: decifrar(serpro.consumerKeyCifrada, chaveMestra),
      consumerSecret: decifrar(serpro.consumerSecretCifrada, chaveMestra),
      pfxBase64: decifrar(cert.arquivoCifrado, chaveMestra),
      senha: decifrar(cert.senhaCifrada, chaveMestra),
      contratante: titular,
      autor: titular,
    }),
  }
}

const nomePeriodo = (periodo: string) => periodo.replace('-', '')

/** Gera o DAS do período (declaração já transmitida) e o coloca entre as guias a pagar. */
export async function gerarDas(empresaId: string, chaveMestra: string, uid: string, periodo: string, dataConsolidacao?: string): Promise<ResultadoImportacaoGuia & { observacoes: string[] }> {
  const s = await abrirSessao(empresaId, chaveMestra)
  try {
    const inicio = Date.now()
    const das = await s.cliente.gerarDas(s.contribuinte, periodo, dataConsolidacao)
    logger.info('serpro: DAS gerado', { empresaId, operacao: 'gerarDas', periodo, numeroDocumento: das.numeroDocumento, duracaoMs: Date.now() - inicio, uid })
    const r = await importarGuia(empresaId, uid, `PGDASD-DAS-${s.contribuinte.slice(0, 8)}${nomePeriodo(periodo)}.pdf`, das.pdf, 'serpro')
    return { ...r, observacoes: das.observacoes }
  } finally {
    s.cliente.encerrar()
  }
}

/** Gera o DARF da DCTFWeb do período e o coloca entre as guias a pagar. */
export async function gerarDarf(empresaId: string, chaveMestra: string, uid: string, periodo: string, numeroRecibo?: number): Promise<ResultadoImportacaoGuia> {
  const s = await abrirSessao(empresaId, chaveMestra)
  try {
    const inicio = Date.now()
    const pdf = await s.cliente.gerarDarfDctfweb(s.contribuinte, periodo, numeroRecibo)
    logger.info('serpro: DARF gerado', { empresaId, operacao: 'gerarDarf', periodo, comRecibo: Boolean(numeroRecibo), duracaoMs: Date.now() - inicio, uid })
    return await importarGuia(empresaId, uid, `DCTFWEB-DARF-${s.contribuinte.slice(0, 8)}${nomePeriodo(periodo)}.pdf`, pdf, 'serpro')
  } finally {
    s.cliente.encerrar()
  }
}

/** Recibo e declaração do PGDAS-D do período: mostra se o contador já transmitiu. */
export async function declaracaoDoPeriodo(empresaId: string, chaveMestra: string, periodo: string): Promise<DeclaracaoPgdasd> {
  const s = await abrirSessao(empresaId, chaveMestra)
  try {
    return await s.cliente.ultimaDeclaracao(s.contribuinte, periodo)
  } finally {
    s.cliente.encerrar()
  }
}

export interface ResultadoTeste {
  /** Ambiente de demonstração do Serpro: prova o caminho API → PDF → leitor, sem contrato */
  demonstracao: { ok: boolean; detalhe: string }
  /** Autenticação de produção com as credenciais cadastradas (não consome serviço tarifado) */
  producao?: { ok: boolean; detalhe: string }
}

export async function testar(empresaId: string, chaveMestra: string): Promise<ResultadoTeste> {
  const resultado: ResultadoTeste = { demonstracao: { ok: false, detalhe: '' } }

  const trial = new SerproIntegraContador({ ambiente: 'trial', contratante: SERPRO_CNPJ_TRIAL, autor: SERPRO_CNPJ_TRIAL })
  try {
    const das = await trial.gerarDas(SERPRO_CNPJ_TRIAL, '2018-01')
    const lida = lerGuia(await textoDoPdf(das.pdf))
    const confere = lida.tipo === 'das' && lida.linhaDigitavelValida === true && Math.abs((lida.valor ?? 0) - (das.total ?? -1)) < 0.005
    resultado.demonstracao = {
      ok: confere,
      detalhe: confere
        ? `O Serpro gerou um DAS de demonstração (nº ${lida.numeroDocumento}, R$ ${(lida.valor ?? 0).toFixed(2).replace('.', ',')}) e o sistema leu o PDF com a linha digitável conferindo.`
        : 'O Serpro respondeu, mas o PDF de demonstração não foi lido como esperado.',
    }
  } catch (e) {
    resultado.demonstracao = { ok: false, detalhe: (e as Error).message }
  } finally {
    trial.encerrar()
  }

  if ((await privadoSerproRef(empresaId).get()).exists) {
    try {
      const s = await abrirSessao(empresaId, chaveMestra)
      try {
        await s.cliente.autenticar(true)
        resultado.producao = { ok: true, detalhe: 'Autenticação em produção aceita: credenciais e certificado conferem com o contrato.' }
      } finally {
        s.cliente.encerrar()
      }
    } catch (e) {
      resultado.producao = { ok: false, detalhe: (e as Error).message }
    }
  }
  return resultado
}
