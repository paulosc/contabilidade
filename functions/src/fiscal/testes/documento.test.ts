/** Leitura dos documentos do lote: resumo de NF-e, NF-e completa e eventos. */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { analisarXml, descendente, textoFilho } from '../xml'
import { eventoCancelaNota, lerDocumento, tipoPeloSchema, ufPelaChave } from '../documento'
import { CHAVE_NFE, procEventoCancelamento, procNFe, resumoNFe } from './apoio'

const ler = (xml: string, schema: string) => lerDocumento(xml, schema, analisarXml(xml))

describe('tipo do documento', () => {
  it('usa o atributo schema informado pela SEFAZ', () => {
    assert.equal(tipoPeloSchema('resNFe_v1.01.xsd'), 'resumo_nfe')
    assert.equal(tipoPeloSchema('procNFe_v4.00.xsd'), 'nfe')
    assert.equal(tipoPeloSchema('resEvento_v1.01.xsd'), 'resumo_evento')
    assert.equal(tipoPeloSchema('procEventoNFe_v1.00.xsd'), 'evento')
  })

  it('cai para a tag raiz quando o schema vem vazio', () => {
    assert.equal(tipoPeloSchema('', analisarXml(procNFe())), 'nfe')
    assert.equal(tipoPeloSchema('', analisarXml(resumoNFe())), 'resumo_nfe')
    assert.equal(tipoPeloSchema('outro.xsd', analisarXml('<qualquer/>')), 'desconhecido')
  })
})

describe('resumo da NF-e', () => {
  const lido = ler(resumoNFe(), 'resNFe_v1.01.xsd')

  it('extrai os campos do leiaute resNFe', () => {
    assert.equal(lido.tipo, 'resumo_nfe')
    assert.equal(lido.chaveAcesso, CHAVE_NFE)
    assert.equal(lido.nota?.cnpjEmitente, '12345678000199')
    assert.equal(lido.nota?.razaoSocialEmitente, 'FORNECEDOR DE MATERIAL LTDA')
    assert.equal(lido.nota?.valorTotal, 1530.75)
    assert.equal(lido.nota?.protocolo, '131260000012345')
    assert.equal(lido.nota?.status, 'resumo')
  })

  it('deriva número, série e modelo da chave de acesso', () => {
    assert.equal(lido.nota?.modelo, '55')
    assert.equal(lido.nota?.serie, '1')
    assert.equal(lido.nota?.numero, '1234')
  })

  it('marca nota cancelada ou denegada pelo cSitNFe', () => {
    assert.equal(ler(resumoNFe(CHAVE_NFE, '3'), 'resNFe_v1.01.xsd').nota?.status, 'cancelada')
    assert.equal(ler(resumoNFe(CHAVE_NFE, '2'), 'resNFe_v1.01.xsd').nota?.status, 'denegada')
  })
})

describe('NF-e completa', () => {
  const lido = ler(procNFe(), 'procNFe_v4.00.xsd')

  it('lê a chave do atributo Id do infNFe', () => {
    assert.equal(lido.tipo, 'nfe')
    assert.equal(lido.chaveAcesso, CHAVE_NFE)
  })

  it('separa emitente e destinatário (CNPJ homônimo em níveis diferentes)', () => {
    assert.equal(lido.nota?.cnpjEmitente, '12345678000199')
    assert.equal(lido.nota?.razaoSocialEmitente, 'FORNECEDOR DE MATERIAL LTDA')
    assert.equal(lido.nota?.cnpjDestinatario, '98765432000188')
    assert.equal(lido.nota?.razaoSocialDestinatario, 'EMPRESA TESTE LTDA')
  })

  it('traz número, série, natureza, valor, protocolo e status', () => {
    assert.equal(lido.nota?.numero, '1234')
    assert.equal(lido.nota?.serie, '1')
    assert.equal(lido.nota?.naturezaOperacao, 'VENDA DE MERCADORIA')
    assert.equal(lido.nota?.valorTotal, 1530.75)
    assert.equal(lido.nota?.protocolo, '131260000012345')
    assert.equal(lido.nota?.status, 'autorizada')
    assert.equal(lido.nota?.ufEmitente, 'MG')
    assert.ok(lido.nota?.dataEmissao instanceof Date)
  })

  it('lê todos os itens com código, NCM, CFOP, unidade e valores', () => {
    const produtos = lido.nota?.produtos ?? []
    assert.equal(produtos.length, 2)
    assert.deepEqual(produtos[0], {
      codigo: 'P-001',
      descricao: 'CIMENTO CP II 50KG',
      ncm: '25232910',
      cfop: '5102',
      unidade: 'SC',
      quantidade: 10,
      valorUnitario: 38.5,
      valorTotal: 385,
    })
    assert.equal(produtos[1].descricao, 'TINTA ACRILICA 18L')
    assert.equal(produtos[1].valorTotal, 1145.75)
  })

  it('marca como denegada quando o protocolo traz cStat 110', () => {
    const denegada = procNFe().replace('<cStat>100</cStat>', '<cStat>110</cStat>')
    assert.equal(ler(denegada, 'procNFe_v4.00.xsd').nota?.status, 'denegada')
  })
})

describe('eventos', () => {
  const lido = ler(procEventoCancelamento(), 'procEventoNFe_v1.00.xsd')

  it('lê chave, tipo, sequência e protocolo do evento', () => {
    assert.equal(lido.tipo, 'evento')
    assert.equal(lido.evento?.chaveAcesso, CHAVE_NFE)
    assert.equal(lido.evento?.tpEvento, '110111')
    assert.equal(lido.evento?.nSeqEvento, '1')
    assert.equal(lido.evento?.protocolo, '131260000099999')
    assert.ok(lido.evento?.dataEvento instanceof Date)
  })

  it('usa a descrição do evento quando ela vem no XML', () => {
    assert.equal(lido.evento?.descricao, 'Cancelamento registrado')
  })

  it('reconhece os eventos que cancelam a nota', () => {
    assert.equal(eventoCancelaNota('110111'), true)
    assert.equal(eventoCancelaNota('110112'), true)
    assert.equal(eventoCancelaNota('110110'), false)
    assert.equal(eventoCancelaNota('210210'), false)
  })
})

describe('documento sem chave de acesso', () => {
  it('é marcado como desconhecido em vez de virar registro solto', () => {
    assert.equal(ler('<resNFe><vNF>10</vNF></resNFe>', 'resNFe_v1.01.xsd').tipo, 'desconhecido')
    assert.equal(ler('<nfeProc><NFe><infNFe/></NFe></nfeProc>', 'procNFe_v4.00.xsd').tipo, 'desconhecido')
  })
})

describe('UF pela chave de acesso', () => {
  it('usa os dois primeiros dígitos (código IBGE)', () => {
    assert.equal(ufPelaChave(CHAVE_NFE), 'MG')
    assert.equal(ufPelaChave('35260912345678000199550010000012341000012347'), 'SP')
    assert.equal(ufPelaChave('99260912345678000199550010000012341000012347'), undefined)
  })
})

describe('leitor de XML', () => {
  it('ignora prefixo de namespace', () => {
    const no = analisarXml('<nfe:raiz xmlns:nfe="x"><nfe:valor>7</nfe:valor></nfe:raiz>')
    assert.equal(no.nome, 'raiz')
    assert.equal(textoFilho(no, 'valor'), '7')
  })

  it('lê CDATA e entidades', () => {
    const no = analisarXml('<a><b><![CDATA[1 < 2]]></b><c>M&amp;M</c></a>')
    assert.equal(textoFilho(no, 'b'), '1 < 2')
    assert.equal(textoFilho(no, 'c'), 'M&M')
  })

  it('não expande entidade declarada em DOCTYPE (proteção contra XXE)', () => {
    const xml = '<!DOCTYPE a [<!ENTITY xxe "SEGREDO">]><a><b>&xxe;</b></a>'
    assert.equal(textoFilho(analisarXml(xml), 'b'), '&xxe;')
  })

  it('aceita tag autofechada e comentário', () => {
    const no = analisarXml('<a><!-- nota --><b/><c>1</c></a>')
    assert.equal(no.filhos.length, 2)
    assert.equal(textoFilho(no, 'c'), '1')
  })

  it('encontra descendente em qualquer profundidade', () => {
    const no = analisarXml('<a><b><c><d>ok</d></c></b></a>')
    assert.equal(descendente(no, 'd')?.texto, 'ok')
  })

  it('avisa quando não há elemento raiz', () => {
    assert.throws(() => analisarXml('   '), /sem elemento raiz/)
  })
})
