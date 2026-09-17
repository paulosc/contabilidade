/**
 * Importação das NFS-e do sistema municipal (padrão ABRASF 2.02).
 *
 * Serve para as notas anteriores à migração do município para o Emissor Nacional: elas existem
 * só no sistema da prefeitura e o Ambiente de Dados Nacional não as conhece. A busca é por CNPJ
 * e período, pelo web service oficial do município — nada de scraping.
 *
 * As notas entram na MESMA coleção das NFS-e nacionais (`notasServico`), para a listagem ser
 * uma só. O que as distingue é o campo `origem`:
 *   'adn'       veio do Ambiente de Dados Nacional (padrão nacional, chave de 50 dígitos)
 *   'municipal' veio do web service da prefeitura (numeração municipal, sem chave nacional)
 *
 * Como a nota municipal não tem chave de acesso nacional, o id do documento é montado a partir
 * do que identifica a nota de forma estável — município, CNPJ do prestador e número da nota —
 * mantendo a mesma garantia de idempotência: reimportar não duplica.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { logger } from 'firebase-functions'
import { storage } from '../lib/admin'
import { AbrasfNfissProvider } from '../providers/fiscal/abrasfNfiss'
import { hostDoMunicipio, mesesEntre, type AbrasfProvider, type NotaAbrasf } from '../providers/fiscal/AbrasfProvider'
import { decifrar } from './certificado'
import { configFiscalRef, notasServicoRef, privadoFiscalRef, type ConfiguracaoFiscal, type PrivadoFiscal } from './modelo'

/** Id estável de uma nota municipal, já que ela não tem chave de acesso nacional. */
export function idNotaMunicipal(codigoMunicipio: string, cnpjPrestador: string, numero: string): string {
  const mun = (codigoMunicipio || '0000000').replace(/\D/g, '').padStart(7, '0')
  const cnpj = (cnpjPrestador || '').replace(/\D/g, '')
  const num = (numero || '').replace(/\D/g, '')
  return `mun-${mun}-${cnpj}-${num}`
}

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

export interface ResultadoImportacao {
  empresaId: string
  de: string
  ate: string
  consultas: number
  encontradas: number
  novas: number
  atualizadas: number
  erros: number
  mensagens: string[]
  /** Até onde a varredura realmente chegou — o teto de consultas pode interrompê-la antes do fim */
  cobertoAte: string
  /** A varredura parou por limite, e não por ter terminado o período */
  interrompida: boolean
  duracaoMs: number
}

async function guardarXml(empresaId: string, id: string, xml: string): Promise<string> {
  const caminho = `empresas/${empresaId}/nfse-municipal/${id}.xml`
  await storage
    .bucket()
    .file(caminho)
    .save(Buffer.from(xml, 'utf8'), { contentType: 'application/xml; charset=utf-8', resumable: false })
  return caminho
}

async function gravar(
  empresaId: string,
  documentoEmpresa: string,
  nota: NotaAbrasf,
  contadores: { novas: number; atualizadas: number },
): Promise<void> {
  const id = idNotaMunicipal(nota.codigoMunicipio ?? '', nota.cnpjPrestador ?? documentoEmpresa, nota.numero)
  const ref = notasServicoRef(empresaId).doc(id)
  const atual = (await ref.get()).data() as { criadoEm?: Timestamp; importadoEm?: Timestamp; hashXml?: string; storagePath?: string } | undefined
  const agora = FieldValue.serverTimestamp()

  const hash = createHash('sha256').update(nota.xml, 'utf8').digest('hex')
  const storagePath = atual?.hashXml === hash && atual.storagePath ? atual.storagePath : await guardarXml(empresaId, id, nota.xml)

  const meu = documentoEmpresa.replace(/\D/g, '')
  const papel =
    nota.cnpjPrestador?.replace(/\D/g, '') === meu ? 'prestador' : nota.cnpjTomador?.replace(/\D/g, '') === meu ? 'tomador' : 'outro'

  await ref.set(
    limpar({
      // sem chave nacional: a identificação municipal é o número da nota
      chaveAcesso: id,
      origem: 'municipal' as const,
      numero: nota.numero,
      codigoVerificacao: nota.codigoVerificacao,
      serieDps: nota.serieRps,
      numeroDps: nota.numeroRps,
      dataEmissao: nota.dataEmissao ? Timestamp.fromDate(nota.dataEmissao) : undefined,
      competencia: nota.competencia,
      situacao: nota.cancelada ? 'Cancelada' : 'NFS-e municipal',
      municipioEmissao: undefined,
      codigoMunicipio: nota.codigoMunicipio,
      cnpjPrestador: nota.cnpjPrestador,
      razaoSocialPrestador: nota.razaoSocialPrestador,
      inscricaoMunicipalPrestador: nota.inscricaoMunicipalPrestador,
      cnpjTomador: nota.cnpjTomador,
      razaoSocialTomador: nota.razaoSocialTomador,
      descricaoServico: nota.discriminacao,
      codigoTributacaoNacional: nota.itemListaServico,
      codigoTributacaoMunicipal: nota.codigoTributacaoMunicipio,
      valorServico: nota.valorServicos,
      baseCalculo: nota.baseCalculo,
      aliquota: nota.aliquota,
      valorIss: nota.valorIss,
      valorLiquido: nota.valorLiquido,
      papel,
      status: nota.cancelada ? ('cancelada' as const) : ('gerada' as const),
      storagePath,
      hashXml: hash,
      ambiente: 'producao' as const,
      importadoEm: atual?.importadoEm ?? agora,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: agora,
    }),
    { merge: true },
  )

  if (atual) contadores.atualizadas++
  else contadores.novas++
}

export interface OpcoesImportacao {
  de: Date
  ate: Date
  /** Buscar também as notas recebidas (tomadas), além das emitidas */
  incluirTomadas?: boolean
  /** Teto de consultas na execução, para não estourar o tempo da function */
  maxConsultas?: number
}

/**
 * Importa as NFS-e municipais de um período.
 * Varre mês a mês e pagina dentro de cada mês, do jeito que o ABRASF espera.
 */
export async function importarDoMunicipio(
  empresaId: string,
  chaveMestra: string,
  opcoes: OpcoesImportacao,
): Promise<ResultadoImportacao> {
  const inicio = Date.now()
  const [confSnap, privSnap] = await Promise.all([configFiscalRef(empresaId).get(), privadoFiscalRef(empresaId).get()])
  const config = confSnap.data() as ConfiguracaoFiscal | undefined
  const privado = privSnap.data() as PrivadoFiscal | undefined
  if (!config || !privado?.certificado) throw new Error('Integração fiscal sem certificado cadastrado.')
  if (!config.municipioWebservice) {
    throw new Error('Informe o município do web service em Configurações antes de importar.')
  }

  const cert = privado.certificado
  if (cert.validoAte.toDate().getTime() < Date.now()) {
    throw new Error(`Certificado digital vencido em ${cert.validoAte.toDate().toLocaleDateString('pt-BR')}.`)
  }

  const documento = (config.cnpj || cert.documento).replace(/\D/g, '')
  const provider: AbrasfProvider = new AbrasfNfissProvider({
    // o município é sempre consultado em produção: é lá que estão as notas antigas
    host: hostDoMunicipio(config.municipioWebservice, 'producao'),
    documento,
    inscricaoMunicipal: config.inscricaoMunicipal,
    pfxBase64: decifrar(cert.arquivoCifrado, chaveMestra),
    senha: decifrar(cert.senhaCifrada, chaveMestra),
    ambiente: 'producao',
  })

  const contadores = { novas: 0, atualizadas: 0 }
  const mensagens: string[] = []
  let consultas = 0
  let encontradas = 0
  let erros = 0
  const maxConsultas = Math.max(1, opcoes.maxConsultas ?? 120)
  // até onde a varredura chegou de fato; o teto de consultas pode interrompê-la no meio
  let cobertoAte = opcoes.de
  let interrompida = false

  logger.info('municipal: importação iniciada', {
    empresaId,
    operacao: 'importarMunicipal',
    municipio: config.municipioWebservice,
    de: opcoes.de.toISOString().slice(0, 10),
    ate: opcoes.ate.toISOString().slice(0, 10),
  })

  try {
    for (const faixa of mesesEntre(opcoes.de, opcoes.ate)) {
      cobertoAte = faixa.ate
      for (const tipo of opcoes.incluirTomadas ? (['prestadas', 'tomadas'] as const) : (['prestadas'] as const)) {
        let pagina = 1
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (consultas >= maxConsultas) {
            interrompida = true
            return finalizar()
          }
          consultas++
          let r
          try {
            r = tipo === 'prestadas'
              ? await provider.consultarPrestadas(faixa.de, faixa.ate, pagina)
              : await provider.consultarTomadas(faixa.de, faixa.ate, pagina)
          } catch (e) {
            erros++
            const msg = `${faixa.de.toLocaleDateString('pt-BR')}: ${(e as Error).message}`
            if (!mensagens.includes(msg)) mensagens.push(msg)
            break
          }

          for (const m of r.mensagens) if (!mensagens.includes(m)) mensagens.push(m)
          encontradas += r.notas.length

          for (const nota of r.notas) {
            try {
              await gravar(empresaId, documento, nota, contadores)
            } catch (e) {
              erros++
              logger.error('municipal: falha ao gravar nota', { empresaId, numero: nota.numero, erro: (e as Error).message })
            }
          }

          if (!r.temMaisPaginas) break
          pagina++
        }
      }
    }
  } finally {
    provider.encerrar()
  }

  return finalizar()

  function finalizar(): ResultadoImportacao {
    const duracaoMs = Date.now() - inicio
    const ateISO = cobertoAte.toISOString().slice(0, 10)
    if (interrompida) {
      mensagens.push(
        `A varredura foi até ${cobertoAte.toLocaleDateString('pt-BR')} e parou no limite de consultas desta execução. ` +
          'Importe de novo começando nessa data para continuar.',
      )
    }
    void configFiscalRef(empresaId)
      .set(
        {
          importacaoMunicipal: {
            ultimaEm: FieldValue.serverTimestamp(),
            periodoDe: opcoes.de.toISOString().slice(0, 10),
            // o que interessa para retomar é até onde a varredura foi, não o que foi pedido
            periodoAte: ateISO,
            notasImportadas: contadores.novas,
            interrompida,
          },
          atualizadoEm: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch(() => undefined)

    logger.info('municipal: importação concluída', {
      empresaId,
      operacao: 'importarMunicipal',
      duracaoMs,
      consultas,
      encontradas,
      novas: contadores.novas,
      atualizadas: contadores.atualizadas,
      erros,
    })

    return {
      empresaId,
      de: opcoes.de.toISOString().slice(0, 10),
      ate: opcoes.ate.toISOString().slice(0, 10),
      consultas,
      encontradas,
      novas: contadores.novas,
      atualizadas: contadores.atualizadas,
      erros,
      mensagens,
      cobertoAte: ateISO,
      interrompida,
      duracaoMs,
    }
  }
}
