/**
 * Pagamentos, caixa postal e situação fiscal: leitura das respostas do Integra Contador.
 *
 * As respostas abaixo são as que o ambiente Trial oficial devolveu em 18/09/2026
 * (PAGTOWEB/PAGAMENTOS71 e CAIXAPOSTAL/MSGCONTRIBUINTE61), reduzidas a poucos itens; o texto do
 * relatório é o do PDF devolvido por SITFIS/RELATORIOSITFIS92 no mesmo ambiente.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { lerCaixaPostal, lerPagamentos } from '../../providers/fiscal/serproIntegraContador'
import { resumirSituacaoFiscal } from '../serproMonitor'

const pagamentos = [
  {
    numeroDocumento: '9999999999',
    tipo: { codigo: '4', descricao: 'DOCUMENTO DE ARRECADAÇÃO DE RECEITAS FEDERAIS', descricaoAbreviada: 'DARF' },
    periodoApuracao: '2019-09-30T00:00:00-03:00',
    dataArrecadacao: '2019-09-30T00:00:00-03:00',
    dataVencimento: '2019-09-30T00:00:00-03:00',
    receitaPrincipal: { codigo: '481', descricao: 'IRRF - Juros e Comissões em Geral - Residentes no Exterior', extensaoReceita: null },
    referencia: null,
    valorTotal: 369176.53,
    valorPrincipal: 369176.53,
    valorMulta: null,
    desmembramentos: [],
  },
]

const mensagem = (extra: Record<string, string>) => ({
  codigoSistemaRemetente: '00019',
  dataEnvio: '20220802',
  horaEnvio: '160251',
  indicadorLeitura: '0',
  dataLeitura: '',
  dataCiencia: '20220817',
  assuntoModelo: 'Notificação de recebimento de mensagem e-MAC - Mensagem nº ++VARIAVEL++ (complemento)',
  valorParametroAssunto: '083548',
  relevancia: '1',
  isn: '0001493189',
  descricaoOrigem: 'RECEITA FEDERAL DO BRASIL',
  ...extra,
})

const caixaPostal = {
  codigo: '00',
  conteudo: [
    {
      quantidadeMensagens: '50',
      indicadorUltimaPagina: 'N',
      cnpjMatriz: '99999999999999',
      listaMensagens: [mensagem({}), mensagem({ isn: '0001492796', indicadorLeitura: '1', dataLeitura: '20220726', dataCiencia: '20220726', relevancia: '2', dataEnvio: '20220726' }), mensagem({ isn: '0001493188', relevancia: '2' })],
    },
  ],
}

describe('pagamentos', () => {
  it('lê número do documento, data da arrecadação e valor', () => {
    assert.deepEqual(lerPagamentos(pagamentos), [{ numeroDocumento: '9999999999', tipo: 'DARF', dataArrecadacao: '2019-09-30', valorTotal: 369176.53, codigoReceita: '481' }])
  })
  it('resposta vazia ou fora do formato não quebra', () => {
    assert.deepEqual(lerPagamentos(undefined), [])
    assert.deepEqual(lerPagamentos({}), [])
    assert.deepEqual(lerPagamentos([{ numeroDocumento: '' }]), [])
  })
})

describe('caixa postal', () => {
  it('monta o assunto, conta as não lidas e avisa que há mais páginas', () => {
    const c = lerCaixaPostal(caixaPostal)
    assert.equal(c.mensagens.length, 3)
    assert.equal(c.naoLidas, 2)
    assert.equal(c.temMaisPaginas, true)
    assert.deepEqual(c.mensagens[0], {
      isn: '0001493189',
      assunto: 'Notificação de recebimento de mensagem e-MAC - Mensagem nº 083548 (complemento)',
      enviadaEm: '2022-08-02',
      lida: false,
      cienciaEm: '2022-08-17',
      relevante: false,
      origem: 'RECEITA FEDERAL DO BRASIL',
    })
    assert.equal(c.mensagens[1].lida, true)
    assert.equal(c.mensagens[2].relevante, true)
  })
  it('caixa vazia', () => {
    assert.deepEqual(lerCaixaPostal({ codigo: '00', conteudo: [{ indicadorUltimaPagina: 'S', listaMensagens: [] }] }), { mensagens: [], naoLidas: 0, temMaisPaginas: false })
    assert.deepEqual(lerCaixaPostal(undefined), { mensagens: [], naoLidas: 0, temMaisPaginas: false })
  })
})

describe('situação fiscal', () => {
  const semPendencias = `INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO
Certidão Emitida ____
Certidão Negativa:  ZZZZ.ZZZZ.ZZZZ.ZZZZ
Emissão: 01/09/2026
Data de Validade: 28/02/2027
________________ Diagnóstico Fiscal na Receita Federal e Procuradoria-Geral da Fazenda Nacional _______________
Não foram detectadas pendências/exigibilidades suspensas nos controles da Receita Federal e da Procuradoria-Geral da Fazenda Nacional.
Final do Relatório`

  it('reconhece a frase literal de ausência de pendências e a certidão', () => {
    assert.deepEqual(resumirSituacaoFiscal(semPendencias), { semPendencias: true, certidao: 'Certidão Negativa', certidaoValidaAte: '2027-02-28' })
  })
  it('sem a frase, não afirma que está tudo certo', () => {
    assert.deepEqual(resumirSituacaoFiscal('Diagnóstico Fiscal\nPendência - Débito (SIEF)\n1234-01 PA 08/2026'), { semPendencias: false })
  })
  it('data de validade mascarada do ambiente de demonstração é ignorada', () => {
    assert.equal(resumirSituacaoFiscal('Certidão Negativa: X\nData de Validade: 99/99/9999').certidaoValidaAte, undefined)
  })
})
