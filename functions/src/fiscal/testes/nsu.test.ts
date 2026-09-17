/**
 * Controle de NSU e isolamento entre empresas.
 *
 * As regras cobertas aqui são as da NT 2014.002, item 3.11.4 ("Recomendações Para Evitar o Uso
 * Indevido"): consultar sempre a partir do ultNSU devolvido, parar quando ultNSU == maxNSU e
 * esperar 1 hora depois de um 137 ou de um 656.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { RETORNO } from '../../providers/fiscal/DistribuicaoDFeProvider'
import { ESPERA_SEM_DOCUMENTOS_MS, avaliarResposta, mesmaRaizCnpj } from '../sincronizacao'
import { caminhoXml, resolverCaminhoXml } from '../modelo'
import { CHAVE_NFE } from './apoio'

const UMA_HORA = 60 * 60 * 1000

describe('controle de NSU', () => {
  it('primeira consulta parte do zero e avança para o ultNSU devolvido', () => {
    const passo = avaliarResposta(
      { cStat: RETORNO.DOCUMENTO_LOCALIZADO, ultNSU: '000000000000050', maxNSU: '000000000000230' },
      '000000000000000',
    )
    assert.equal(passo.acao, 'continuar')
    assert.equal(passo.nsu, '000000000000050')
    assert.equal(passo.temDocumentos, true)
  })

  it('consulta incremental usa sempre o ultNSU da resposta anterior', () => {
    let nsu = '000000000000050'
    for (const [ult, max] of [
      ['000000000000100', '000000000000230'],
      ['000000000000150', '000000000000230'],
      ['000000000000200', '000000000000230'],
    ]) {
      const passo = avaliarResposta({ cStat: RETORNO.DOCUMENTO_LOCALIZADO, ultNSU: ult, maxNSU: max }, nsu)
      assert.equal(passo.acao, 'continuar')
      nsu = passo.nsu
    }
    assert.equal(nsu, '000000000000200')
  })

  it('para quando ultNSU alcança o maxNSU e espera 1 hora', () => {
    const passo = avaliarResposta(
      { cStat: RETORNO.DOCUMENTO_LOCALIZADO, ultNSU: '000000000000230', maxNSU: '000000000000230' },
      '000000000000200',
    )
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.situacao, 'aguardando')
    assert.equal(passo.esperaMs, UMA_HORA)
    assert.equal(passo.temDocumentos, true, 'o último lote ainda precisa ser gravado')
  })

  it('137 encerra a varredura e agenda a próxima só depois de 1 hora', () => {
    const passo = avaliarResposta({ cStat: RETORNO.NENHUM_DOCUMENTO, ultNSU: '000000000000230', maxNSU: '000000000000230' }, '000000000000230')
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.situacao, 'aguardando')
    assert.equal(passo.esperaMs, ESPERA_SEM_DOCUMENTOS_MS)
    assert.equal(passo.temDocumentos, false)
  })

  it('656 bloqueia por 1 hora e aproveita o ultNSU devolvido na rejeição', () => {
    const passo = avaliarResposta({ cStat: RETORNO.CONSUMO_INDEVIDO, ultNSU: '000000000000077' }, '000000000000000')
    assert.equal(passo.situacao, 'bloqueado')
    assert.equal(passo.nsu, '000000000000077')
    assert.equal(passo.esperaMs, UMA_HORA)
  })

  it('656 sem ultNSU útil preserva o NSU que já tínhamos', () => {
    const passo = avaliarResposta({ cStat: RETORNO.CONSUMO_INDEVIDO, ultNSU: '000000000000000' }, '000000000000120')
    assert.equal(passo.nsu, '000000000000120')
  })

  it('589 reposiciona o controle no maxNSU informado pela SEFAZ', () => {
    const passo = avaliarResposta({ cStat: RETORNO.NSU_SUPERIOR_AO_MAXIMO, ultNSU: '000000000000000', maxNSU: '000000000000042' }, '000000000009999')
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.nsu, '000000000000042')
    assert.equal(passo.situacao, 'aguardando')
  })

  it('serviço paralisado não mexe no NSU e tenta de novo antes da hora cheia', () => {
    for (const cStat of [RETORNO.PARALISADO_CURTO, RETORNO.PARALISADO_SEM_PREVISAO]) {
      const passo = avaliarResposta({ cStat }, '000000000000120')
      assert.equal(passo.nsu, '000000000000120', 'NSU não avança em indisponibilidade')
      assert.equal(passo.situacao, 'erro')
      assert.ok(passo.esperaMs < UMA_HORA)
    }
  })

  it('rejeição desconhecida para sem perder o NSU (retomada depois do erro)', () => {
    const passo = avaliarResposta({ cStat: RETORNO.CNPJ_DIFERE_CERTIFICADO }, '000000000000120')
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.nsu, '000000000000120')
    assert.equal(passo.situacao, 'erro')
  })

  it('retomada após erro continua do último NSU gravado, não do zero', () => {
    const gravado = avaliarResposta({ cStat: RETORNO.DOCUMENTO_LOCALIZADO, ultNSU: '000000000000150', maxNSU: '000000000000400' }, '000000000000100').nsu
    const aposFalha = avaliarResposta({ cStat: '999' }, gravado)
    assert.equal(aposFalha.nsu, '000000000000150')
    const proximaExecucao = avaliarResposta({ cStat: RETORNO.DOCUMENTO_LOCALIZADO, ultNSU: '000000000000200', maxNSU: '000000000000400' }, aposFalha.nsu)
    assert.equal(proximaExecucao.nsu, '000000000000200')
  })
})

describe('isolamento entre empresas (multi-tenancy)', () => {
  it('o caminho do XML sempre carrega o id da empresa', () => {
    const a = caminhoXml('empA', CHAVE_NFE, 'nfe')
    const b = caminhoXml('empB', CHAVE_NFE, 'nfe')
    assert.ok(a.startsWith('empresas/empA/fiscal/'))
    assert.ok(b.startsWith('empresas/empB/fiscal/'))
    assert.notEqual(a, b, 'a mesma chave em tenants diferentes não pode cair no mesmo arquivo')
  })

  it('o ano do caminho vem da própria chave de acesso', () => {
    assert.ok(caminhoXml('empA', CHAVE_NFE, 'nfe').includes('/2026/'))
  })

  it('devolve o XML da nota quando nenhum caminho é pedido', () => {
    const nota = { storagePath: `empresas/empA/fiscal/2026/${CHAVE_NFE}-nfe.xml` }
    assert.equal(resolverCaminhoXml('empA', nota), nota.storagePath)
  })

  it('aceita o caminho de um evento da própria nota', () => {
    const evento = `empresas/empA/fiscal/2026/${CHAVE_NFE}-evento-110111-1.xml`
    const nota = { storagePath: `empresas/empA/fiscal/2026/${CHAVE_NFE}-nfe.xml`, eventos: [{ storagePath: evento }] }
    assert.equal(resolverCaminhoXml('empA', nota, evento), evento)
  })

  it('NEGA o caminho de outra empresa, mesmo gravado na nota', () => {
    const daOutra = `empresas/empB/fiscal/2026/${CHAVE_NFE}-nfe.xml`
    const nota = { storagePath: daOutra }
    assert.equal(resolverCaminhoXml('empA', nota, daOutra), null)
    assert.equal(resolverCaminhoXml('empA', nota), null, 'nem como caminho padrão')
  })

  it('NEGA caminho arbitrário enviado pelo cliente', () => {
    const nota = { storagePath: `empresas/empA/fiscal/2026/${CHAVE_NFE}-nfe.xml` }
    assert.equal(resolverCaminhoXml('empA', nota, 'empresas/empB/contratos/1/contrato.pdf'), null)
    assert.equal(resolverCaminhoXml('empA', nota, '../../empresas/empB/fiscal/2026/x.xml'), null)
    assert.equal(resolverCaminhoXml('empA', nota, 'empresas/empA/fiscal/2026/outro.xml'), null)
  })

  it('nota sem XML guardado não devolve caminho nenhum', () => {
    assert.equal(resolverCaminhoXml('empA', {}), null)
    assert.equal(resolverCaminhoXml('empA', { eventos: [{}] }), null)
  })
})

describe('raiz do CNPJ (regra H04 da NT, rejeição 593)', () => {
  it('aceita outro estabelecimento da mesma empresa', () => {
    assert.equal(mesmaRaizCnpj('12345678000199', '12345678000180'), true)
    assert.equal(mesmaRaizCnpj('12.345.678/0001-99', '12345678000199'), true)
  })

  it('recusa CNPJ de outra empresa', () => {
    assert.equal(mesmaRaizCnpj('98765432000188', '12345678000199'), false)
  })

  it('recusa valor vazio ou curto demais', () => {
    assert.equal(mesmaRaizCnpj('', '12345678000199'), false)
    assert.equal(mesmaRaizCnpj('1234', '12345678000199'), false)
  })
})
