/**
 * Integra Contador (Serpro): leitura das respostas.
 *
 * Os formatos abaixo são os que o ambiente Trial oficial devolveu em 18/09/2026
 * (PGDASD/GERARDAS12, PGDASD/CONSULTIMADECREC14, DCTFWEB/GERARGUIAANDAMENTO313 e o HTTP 429).
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  ErroSerpro,
  explicarFalha,
  interpretarResposta,
  lerDarfGerado,
  lerDasGerado,
  lerUltimaDeclaracao,
  periodoSerpro,
} from '../../providers/fiscal/serproIntegraContador'

const PDF = Buffer.from('%PDF-1.4 conteudo').toString('base64')

const respostaDas = JSON.stringify({
  contratante: { numero: '00000000000100', tipo: 2 },
  pedidoDados: { idSistema: 'PGDASD', idServico: 'GERARDAS12', versaoSistema: '1.0', dados: '{ "periodoApuracao": "201801" }' },
  status: 200,
  dados: JSON.stringify([
    {
      pdf: PDF,
      cnpjCompleto: '00000000000100',
      detalhamentoDas: {
        periodoApuracao: '201801',
        numeroDocumento: '07202221401801678',
        dataVencimento: '20180220',
        dataLimiteAcolhimento: '20220831',
        valores: { principal: 40.0, multa: 8.0, juros: 10.15, total: 58.15 },
        observacao1: 'Esta empresa NÃO É OPTANTE pelo Simples Nacional.',
        observacao2: '',
        observacao3: '',
        composicao: [{ periodoApuracao: '201801', codigo: '1001', denominacao: '01/2018', valores: { principal: 2.2, multa: 0.44, juros: 0.56, total: 3.2 } }],
      },
    },
  ]),
  mensagens: [{ codigo: '[Sucesso-PGDASD]', texto: 'Requisição efetuada com sucesso.' }],
})

describe('resposta do Integra Contador', () => {
  it('desembrulha o campo dados, que vem como JSON dentro de string', () => {
    const r = interpretarResposta(200, respostaDas)
    assert.equal(r.ok, true)
    assert.equal(r.status, 200)
    assert.equal(r.mensagens[0].codigo, '[Sucesso-PGDASD]')
    assert.ok(Array.isArray(r.dados))
  })

  it('DAS gerado: PDF, número, vencimento original, limite de acolhimento, total e observações', () => {
    const das = lerDasGerado(interpretarResposta(200, respostaDas).dados)
    assert.equal(das.pdf.subarray(0, 5).toString(), '%PDF-')
    assert.equal(das.numeroDocumento, '07202221401801678')
    assert.equal(das.vencimento, '2018-02-20')
    assert.equal(das.dataLimiteAcolhimento, '2022-08-31')
    assert.equal(das.total, 58.15)
    assert.deepEqual(das.observacoes, ['Esta empresa NÃO É OPTANTE pelo Simples Nacional.'])
  })

  it('DARF da DCTFWeb vem em PDFByteArrayBase64', () => {
    const corpo = JSON.stringify({ status: 200, dados: JSON.stringify({ PDFByteArrayBase64: PDF }), mensagens: [{ codigo: '[Sucesso-DCTFWEB]', texto: 'ok' }] })
    assert.equal(lerDarfGerado(interpretarResposta(200, corpo).dados).subarray(0, 5).toString(), '%PDF-')
  })

  it('última declaração: número, recibo e declaração', () => {
    const corpo = JSON.stringify({
      status: 200,
      dados: JSON.stringify({ numeroDeclaracao: '00000000201801001', recibo: { nomeArquivo: 'PGDASD-RECIBO.pdf', pdf: PDF }, declaracao: { nomeArquivo: 'PGDASD-DECLARACAO.pdf', pdf: PDF } }),
      mensagens: [],
    })
    const d = lerUltimaDeclaracao(interpretarResposta(200, corpo).dados)
    assert.equal(d.numeroDeclaracao, '00000000201801001')
    assert.equal(d.recibo?.nomeArquivo, 'PGDASD-RECIBO.pdf')
    assert.equal(d.declaracao?.pdf.subarray(0, 5).toString(), '%PDF-')
  })

  it('resposta sem PDF vira erro claro, não um arquivo vazio', () => {
    assert.throws(() => lerDasGerado([{ cnpjCompleto: '1' }]), ErroSerpro)
    assert.throws(() => lerDarfGerado({}), ErroSerpro)
  })
})

describe('falhas', () => {
  it('429 do gateway: pede para aguardar', () => {
    const r = interpretarResposta(429, '')
    assert.equal(r.ok, false)
    assert.match(explicarFalha(r), /limitou as requisições/)
  })

  it('403: contrato ou procuração', () => {
    assert.match(explicarFalha(interpretarResposta(403, '{}')), /procuração eletrônica/)
  })

  it('erro de negócio: repassa as mensagens do Serpro', () => {
    const corpo = JSON.stringify({ status: 400, mensagens: [{ codigo: '[Erro-PGDASD-MSG_ISN_019]', texto: 'Não há declaração transmitida para o período.' }], dados: '' })
    const r = interpretarResposta(400, corpo)
    assert.equal(r.ok, false)
    assert.equal(explicarFalha(r), '[Erro-PGDASD-MSG_ISN_019] Não há declaração transmitida para o período.')
  })

  it('status interno de erro dentro de um HTTP 200 também é falha', () => {
    assert.equal(interpretarResposta(200, JSON.stringify({ status: 500, mensagens: [] })).ok, false)
  })

  it('erro fora do JSON ainda vira mensagem', () => {
    assert.match(explicarFalha(interpretarResposta(502, '<html><h1>Bad Gateway</h1></html>'), '<html><h1>Bad Gateway</h1></html>'), /Bad Gateway/)
  })
})

describe('período', () => {
  it("'AAAA-MM' vira 'AAAAMM' e o formato errado é recusado", () => {
    assert.equal(periodoSerpro('2026-08'), '202608')
    assert.throws(() => periodoSerpro('08/2026'), ErroSerpro)
  })
})
