/**
 * Leitura das guias que o contador entrega (DAS, DARF, recibo de honorários).
 *
 * Os textos abaixo têm a forma exata do que o extrator devolve para os PDFs oficiais da Receita
 * (SENDA 1.5.10) e para um recibo de honorários, com CNPJ e nomes trocados por fictícios. As
 * linhas digitáveis são reais: os dígitos verificadores têm que conferir.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { formatarLinhaDigitavel, idDaGuia, lerGuia, lerLinhaArrecadacao, valorPorExtenso } from '../guias'

const DAS = `Documento de Arrecadação
do Simples Nacional
11.222.333/0001-81 EMPRESA EXEMPLO LTDA
Período de Apuração Data de Vencimento Número do Documento
07.20.26257.1699513-2 Pagar este documento até
21/09/2026Observações
Valor Total do Documento
1.114,22
CNPJ Razão Social
agosto/2026 21/09/2026
Código PrincipalDenominação TotalMulta Juros
Composição do Documento de Arrecadação
1001 IRPJ - SIMPLES NACIONAL 44,57 44,57
08/2026
1002 CSLL - SIMPLES NACIONAL 39,00 39,00
08/2026
1004 COFINS - SIMPLES NACIONAL 156,55 156,55
08/2026
1005 PIS - SIMPLES NACIONAL 33,98 33,98
08/2026
1006 INSS - SIMPLES NACIONAL 483,57 483,57
08/2026
1010 ISS - SIMPLES NACIONAL 356,55 356,55
CONCEICAO DOS OUROS (MG) - 08/2026
Totais 1.114,22 1.114,22
SENDA (Versão:1.5.10) 14/09/2026 15:23:371 1Página: /
85800000011 9 14220328262 2 64072026257 4 16995132025 8 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação do Simples Nacional
85800000011 9 14220328262 2 64072026257 4 11.222.333/0001-81
Número: 07.20.26257.1699513-2
Pagar até: 21/09/2026
Valor: 1.114,22
16995132025 8 CNPJ:
Pague com o PIX`

const DARF = `Documento de Arrecadação
de Receitas Federais
11.222.333/0001-81 EMPRESA EXEMPLO LTDA
Período de Apuração Data de Vencimento Número do Documento
07.16.26257.1682996-1 Pagar este documento até
18/09/2026Observações
Nº Recibo Declaração: 50000523502436 Valor Total do Documento
528,00
CNPJ Razão Social
agosto/2026 18/09/2026
Código PrincipalDenominação TotalMulta Juros
Composição do Documento de Arrecadação
1099 CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL 528,00 528,00
01 CP SEGURADOS - CONTRIBUINTES INDIVIDUAIS - 11%
PA:08/2026 Vencimento:18/09/2026
Totais 528,00 528,00
SENDA (Versão:1.5.10) 14/09/2026 15:21:351 1Página: /
85830000005 0 28000385262 9 61071626257 1 16829961979 1 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação de Receitas Federais
85830000005 0 28000385262 9 61071626257 1 11.222.333/0001-81
Número: 07.16.26257.1682996-1
Pagar até: 18/09/2026
Valor: 528,00
16829961979 1 CNPJ:
Pague com o PIX`

const HONORARIOS = `265,00Honorários Contábeis - Honorario 08 20261
EMPRESA EXEMPLO LTDA
RUA DAS FLORES, 81
CENTRO Conceição dos Ouros MG
Cliente
Endereço
Bairro Cidade UF :
Nº 0000001731
16/09/2026Emissão
Vencimento 21/09/2026
Quantidade Descrição Valor
3500000000Telefone :
RECIBO DE HONORÁRIOS
:
:
Total
Duzentos e Sessenta e Cinco Reais( )
Valor Total por extenso:
Arredondamento Atual
Arredondamento Anterior 0,00
0,00
265,00
Resíduo 0,00
Sub-Total 265,00Mensagem:
Após o Vencimento será cobrado juros de % , ao dia.0,00
FULANO DE TAL - CONTABIL EXEMPLO
CPF : 123.456.789-09 CRC : 000.000 - MG`

describe('linha digitável de arrecadação', () => {
  it('monta o código de barras, tira o valor dele e confere os quatro DVs (módulo 11)', () => {
    const l = lerLinhaArrecadacao(DAS)!
    assert.equal(l.codigoBarras, '85800000011142203282626407202625716995132025')
    assert.equal(l.linhaDigitavel, '858000000119142203282622640720262574169951320258')
    assert.equal(l.valor, 1114.22)
    assert.equal(l.valida, true)
    assert.equal(lerLinhaArrecadacao(DARF)!.valor, 528)
    assert.equal(lerLinhaArrecadacao(DARF)!.valida, true)
  })

  it('acusa linha adulterada', () => {
    assert.equal(lerLinhaArrecadacao(DAS.replaceAll('14220328262 2', '14220328263 2'))!.valida, false)
  })

  it('texto sem linha de arrecadação', () => {
    assert.equal(lerLinhaArrecadacao('nada aqui 123'), undefined)
  })

  it('formata para digitar no banco', () => {
    assert.equal(formatarLinhaDigitavel('858000000119142203282622640720262574169951320258'), '85800000011-9 14220328262-2 64072026257-4 16995132025-8')
  })
})

describe('DAS do Simples Nacional', () => {
  const g = lerGuia(DAS)

  it('identificação, vencimento, período e valor', () => {
    assert.equal(g.tipo, 'das')
    assert.equal(g.documentoContribuinte, '11222333000181')
    assert.equal(g.contribuinte, 'EMPRESA EXEMPLO LTDA')
    assert.equal(g.numeroDocumento, '07.20.26257.1699513-2')
    assert.equal(g.periodo, '2026-08')
    assert.equal(g.vencimento, '2026-09-21')
    assert.equal(g.valor, 1114.22)
    assert.deepEqual(g.avisos, [])
  })

  it('composição por tributo fecha com o total', () => {
    assert.equal(g.composicao.length, 6)
    assert.deepEqual(g.composicao[0], { codigo: '1001', denominacao: 'IRPJ - SIMPLES NACIONAL', principal: 44.57, total: 44.57 })
    assert.equal(g.composicao.at(-1)?.denominacao, 'ISS - SIMPLES NACIONAL')
    assert.equal(Math.round(g.composicao.reduce((s, i) => s + i.total, 0) * 100), 111422)
  })

  it('id estável pelo número do documento', () => {
    assert.equal(idDaGuia(g, 'abc'), 'das-0720262571699513' + '2')
  })
})

describe('DARF', () => {
  const g = lerGuia(DARF)

  it('lê o tributo, o recibo da declaração e o valor', () => {
    assert.equal(g.tipo, 'darf')
    assert.equal(g.numeroDocumento, '07.16.26257.1682996-1')
    assert.equal(g.periodo, '2026-08')
    assert.equal(g.vencimento, '2026-09-18')
    assert.equal(g.valor, 528)
    assert.equal(g.composicao[0].codigo, '1099')
    assert.equal(g.descricao, 'DARF — CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL')
    assert.equal(g.observacoes, 'Nº Recibo Declaração: 50000523502436')
  })

  it('valor impresso diferente do código de barras vira aviso, e o código de barras manda', () => {
    const adulterado = lerGuia(DARF.replace('Valor: 528,00', 'Valor: 5.280,00'))
    assert.equal(adulterado.valor, 528)
    assert.ok(adulterado.avisos.some((a) => /difere do valor no código de barras/.test(a)))
  })
})

describe('recibo de honorários', () => {
  const g = lerGuia(HONORARIOS)

  it('número, datas, competência, valor e emitente', () => {
    assert.equal(g.tipo, 'honorarios')
    assert.equal(g.numeroDocumento, '0000001731')
    assert.equal(g.emissao, '2026-09-16')
    assert.equal(g.vencimento, '2026-09-21')
    assert.equal(g.periodo, '2026-08')
    assert.equal(g.valor, 265)
    assert.equal(g.emitente, 'FULANO DE TAL - CONTABIL EXEMPLO')
    assert.match(g.descricao ?? '', /^Honorários Contábeis/)
    assert.equal(g.linhaDigitavel, undefined)
    assert.equal(idDaGuia(g, 'abc'), 'hon-0000001731')
  })
})

describe('documento desconhecido', () => {
  it('não inventa: tipo "outro", com aviso, e id pelo hash do arquivo', () => {
    const g = lerGuia('Boleto qualquer de outro sistema')
    assert.equal(g.tipo, 'outro')
    assert.equal(g.valor, undefined)
    assert.equal(g.avisos.length, 1)
    assert.equal(idDaGuia(g, '0123456789abcdef0123456789abcdef'), 'pdf-0123456789abcdef01234567')
  })
})

describe('valor por extenso', () => {
  it('reais, centavos e os casos de "e"', () => {
    assert.equal(valorPorExtenso(265), 'duzentos e sessenta e cinco reais')
    assert.equal(valorPorExtenso(1114.22), 'mil, cento e quatorze reais e vinte e dois centavos')
    assert.equal(valorPorExtenso(1000), 'mil reais')
    assert.equal(valorPorExtenso(1100), 'mil e cem reais')
    assert.equal(valorPorExtenso(1001), 'mil e um reais')
    assert.equal(valorPorExtenso(100), 'cem reais')
    assert.equal(valorPorExtenso(1), 'um real')
    assert.equal(valorPorExtenso(0.5), 'cinquenta centavos')
    assert.equal(valorPorExtenso(2_000_000), 'dois milhões de reais')
    assert.equal(valorPorExtenso(16990), 'dezesseis mil, novecentos e noventa reais')
  })
})
