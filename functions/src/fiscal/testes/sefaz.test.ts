/**
 * Respostas do NFeDistribuicaoDFe: leitura do retDistDFeInt, descompactação do docZip e
 * os códigos de retorno previstos na NT 2014.002.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { descompactarDocZip, extrairFalhaSoap, formatarNsu, interpretarRetorno, UF_IBGE } from '../../providers/fiscal/sefazNacional'
import { RETORNO, avaliarTesteDeConexao, explicarRetorno, explicarTesteDeConexao, tpAmbDe } from '../../providers/fiscal/DistribuicaoDFeProvider'
import { CHAVE_NFE, falhaSoap, procEventoCancelamento, procNFe, respostaSefaz, resumoNFe } from './apoio'

describe('NSU', () => {
  it('sempre tem 15 dígitos (tipo TNSU do schema)', () => {
    assert.equal(formatarNsu('1'), '000000000000001')
    assert.equal(formatarNsu(0), '000000000000000')
    assert.equal(formatarNsu('000000000000123'), '000000000000123')
    assert.equal(formatarNsu('12.345'), '000000000012345')
    assert.equal(formatarNsu(''), '000000000000000')
  })

  it('corta um NSU maior que o permitido em vez de gerar XML inválido', () => {
    assert.equal(formatarNsu('1234567890123456789').length, 15)
  })
})

describe('tpAmb', () => {
  it('usa 1 para produção e 2 para homologação', () => {
    assert.equal(tpAmbDe('producao'), '1')
    assert.equal(tpAmbDe('homologacao'), '2')
  })
})

describe('retorno do Web Service', () => {
  it('lê uma resposta sem documentos (cStat 137)', () => {
    const r = interpretarRetorno(
      respostaSefaz({ cStat: RETORNO.NENHUM_DOCUMENTO, xMotivo: 'Nenhum documento localizado', ultNSU: '000000000000010', maxNSU: '000000000000010' }),
    )
    assert.equal(r.cStat, '137')
    assert.equal(r.ultNSU, '000000000000010')
    assert.equal(r.maxNSU, '000000000000010')
    assert.equal(r.documentos.length, 0)
  })

  it('lê uma resposta com vários documentos e descompacta cada docZip', () => {
    const r = interpretarRetorno(
      respostaSefaz({
        cStat: RETORNO.DOCUMENTO_LOCALIZADO,
        xMotivo: 'Documento(s) localizado(s)',
        ultNSU: '000000000000003',
        maxNSU: '000000000000050',
        documentos: [
          { nsu: '000000000000002', schema: 'resNFe_v1.01.xsd', xml: resumoNFe() },
          { nsu: '000000000000003', schema: 'procNFe_v4.00.xsd', xml: procNFe() },
        ],
      }),
    )
    assert.equal(r.cStat, '138')
    assert.equal(r.documentos.length, 2)
    assert.equal(r.documentos[0].nsu, '000000000000002')
    assert.equal(r.documentos[0].schema, 'resNFe_v1.01.xsd')
    assert.ok(r.documentos[0].xml.includes('<resNFe'))
    assert.ok(r.documentos[1].xml.includes('<nfeProc'))
  })

  it('lê a rejeição 589 mantendo ultNSU e maxNSU', () => {
    const r = interpretarRetorno(
      respostaSefaz({
        cStat: RETORNO.NSU_SUPERIOR_AO_MAXIMO,
        xMotivo: 'Rejeicao: Numero do NSU informado superior ao maior NSU',
        ultNSU: '000000000000000',
        maxNSU: '000000000000042',
      }),
    )
    assert.equal(r.cStat, '589')
    assert.equal(r.maxNSU, '000000000000042')
  })

  it('lê a rejeição 656 (consumo indevido) com o último NSU consultado', () => {
    const r = interpretarRetorno(
      respostaSefaz({ cStat: RETORNO.CONSUMO_INDEVIDO, xMotivo: 'Rejeicao: Consumo Indevido', ultNSU: '000000000000077', maxNSU: '000000000000090' }),
    )
    assert.equal(r.cStat, '656')
    assert.equal(r.ultNSU, '000000000000077')
  })

  it('transforma falha SOAP em erro com a mensagem do servidor', () => {
    assert.throws(
      () => interpretarRetorno(falhaSoap('Server was unable to process request')),
      /Server was unable to process request/,
    )
    assert.equal(extrairFalhaSoap(falhaSoap('boom')), 'boom')
    assert.equal(extrairFalhaSoap('<a/>'), undefined)
  })

  it('avisa quando a resposta não tem retDistDFeInt', () => {
    assert.throws(() => interpretarRetorno('<html>erro</html>'), /retDistDFeInt/)
  })

  it('ignora docZip vazio em vez de quebrar o lote', () => {
    const xml = respostaSefaz({ cStat: '138', ultNSU: '1', maxNSU: '1' }).replace(
      '</retDistDFeInt>',
      '<loteDistDFeInt><docZip NSU="000000000000001" schema="resNFe_v1.01.xsd"></docZip></loteDistDFeInt></retDistDFeInt>',
    )
    assert.equal(interpretarRetorno(xml).documentos.length, 0)
  })
})

describe('docZip', () => {
  it('descompacta gzip em base64', () => {
    const original = '<resNFe>conteúdo com acento</resNFe>'
    assert.equal(descompactarDocZip(gzipSync(Buffer.from(original, 'utf8')).toString('base64')), original)
  })

  it('aceita base64 quebrado em linhas (é assim que a SEFAZ envia)', () => {
    const base64 = gzipSync(Buffer.from('<x/>', 'utf8')).toString('base64')
    const comQuebras = base64.replace(/(.{20})/g, '$1\n')
    assert.equal(descompactarDocZip(comQuebras), '<x/>')
  })

  it('avisa quando o conteúdo não é compactado', () => {
    assert.throws(() => descompactarDocZip(Buffer.from('texto puro').toString('base64')), /descompactar/)
  })
})

describe('mensagens dos códigos de retorno', () => {
  it('explica os códigos que o usuário pode ver', () => {
    assert.match(explicarRetorno(RETORNO.CONSUMO_INDEVIDO, ''), /1 hora/)
    assert.match(explicarRetorno(RETORNO.CNPJ_DIFERE_CERTIFICADO, ''), /raiz/)
    assert.match(explicarRetorno(RETORNO.CERTIFICADO_VENCIDO, ''), /validade/)
    assert.match(explicarRetorno(RETORNO.NENHUM_DOCUMENTO, ''), /Nenhum documento/)
    assert.match(explicarRetorno(RETORNO.PARALISADO_SEM_PREVISAO, ''), /paralisado/i)
  })

  it('devolve o motivo original quando o código não está catalogado', () => {
    assert.equal(explicarRetorno('999', 'Rejeicao: Erro nao catalogado'), 'Rejeicao: Erro nao catalogado')
    assert.match(explicarRetorno('999', ''), /Retorno 999/)
  })
})

describe('códigos de UF', () => {
  it('usa a tabela do IBGE aceita pelo schema (TCodUfIBGE)', () => {
    assert.equal(UF_IBGE.MG, '31')
    assert.equal(UF_IBGE.SP, '35')
    assert.equal(UF_IBGE.DF, '53')
    assert.equal(Object.keys(UF_IBGE).length, 27)
  })
})

describe('documentos do lote chegam íntegros', () => {
  it('mantém a chave de acesso no XML descompactado', () => {
    const r = interpretarRetorno(
      respostaSefaz({
        cStat: '138',
        ultNSU: '000000000000004',
        maxNSU: '000000000000004',
        documentos: [{ nsu: '000000000000004', schema: 'procEventoNFe_v1.00.xsd', xml: procEventoCancelamento() }],
      }),
    )
    assert.ok(r.documentos[0].xml.includes(CHAVE_NFE))
  })
})

describe('teste de conexão', () => {
  it('trata 137, 138 e 589 como conexão funcionando', () => {
    // 589 é o retorno normal de um CNPJ sem nenhum documento (maxNSU = 0), o caso de homologação
    for (const cStat of [RETORNO.NENHUM_DOCUMENTO, RETORNO.DOCUMENTO_LOCALIZADO, RETORNO.NSU_SUPERIOR_AO_MAXIMO]) {
      assert.equal(avaliarTesteDeConexao(cStat), 'ok')
    }
  })

  it('trata 656 como aviso: a comunicação funciona, o CNPJ é que está bloqueado', () => {
    assert.equal(avaliarTesteDeConexao(RETORNO.CONSUMO_INDEVIDO), 'atencao')
  })

  it('trata problema de certificado ou de CNPJ como erro', () => {
    for (const cStat of [RETORNO.CNPJ_DIFERE_CERTIFICADO, RETORNO.CERTIFICADO_VENCIDO, RETORNO.CERTIFICADO_SEM_CNPJ, RETORNO.AMBIENTE_DIVERGENTE, '999']) {
      assert.equal(avaliarTesteDeConexao(cStat), 'erro')
    }
  })

  it('não chama de falha o que foi sucesso', () => {
    const msg = explicarTesteDeConexao(RETORNO.NSU_SUPERIOR_AO_MAXIMO, '', 'homologacao')
    assert.match(msg, /funcionando/)
    assert.match(msg, /homologação/)
    assert.equal(/recusou|falha|erro/i.test(msg), false)
  })

  it('diz claramente quando a SEFAZ recusou', () => {
    assert.match(explicarTesteDeConexao(RETORNO.CNPJ_DIFERE_CERTIFICADO, '', 'producao'), /recusou com o código 593/)
  })
})
