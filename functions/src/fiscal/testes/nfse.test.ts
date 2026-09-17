/**
 * NFS-e nacional: chave de acesso, leitura do XML e distribuição pelo ADN.
 *
 * O XML de exemplo segue o leiaute oficial (pacote NFSe-ESQUEMAS_XSD v1.01, namespace
 * http://www.sped.fazenda.gov.br/nfse) e usa a mesma chave da nota real que motivou o módulo.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { analisarXml } from '../xml'
import { eventoCancelaNfse, lerDocumentoServico, tipoDoDocumentoServico } from '../documentoServico'
import { avaliarRespostaNfse, papelNaNota } from '../sincronizacaoNfse'
import { decodificarDocumento, interpretarJson, nsuAdn } from '../../providers/fiscal/adnNacional'
import { ADN_URLS, lerChaveNfse, mesmaRaiz } from '../../providers/fiscal/AdnContribuintesProvider'

const CHAVE = '31178012260748857000116000000000000926090381879606'
const CNPJ = '60748857000116'

const nfse = (chave = CHAVE, cStat = '100') =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">' +
  `<infNFSe Id="NFS${chave}">` +
  '<xLocEmi>Conceição dos Ouros</xLocEmi><xLocPrestacao>Conceição dos Ouros</xLocPrestacao>' +
  '<nNFSe>9</nNFSe><verAplic>1.00</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis>' +
  `<cStat>${cStat}</cStat><dhProc>2026-09-02T16:19:40-03:00</dhProc><nDFSe>9</nDFSe>` +
  '<emit><CNPJ>60748857000116</CNPJ><IM>13950</IM><xNome>PAULO SERGIO DE CARVALHO</xNome></emit>' +
  '<valores><vBC>1000.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>20.00</vISSQN><vLiq>980.00</vLiq></valores>' +
  '<DPS versao="1.01"><infDPS Id="DPS123">' +
  '<tpAmb>1</tpAmb><dhEmi>2026-09-02T16:19:40-03:00</dhEmi><verAplic>1.00</verAplic>' +
  '<serie>70000</serie><nDPS>8</nDPS><dCompet>2026-09-02</dCompet><tpEmit>1</tpEmit><cLocEmi>3117801</cLocEmi>' +
  '<prest><CNPJ>60748857000116</CNPJ><IM>13950</IM></prest>' +
  '<toma><CNPJ>11222333000181</CNPJ><xNome>CLIENTE EXEMPLO LTDA</xNome></toma>' +
  '<serv><locPrest><cLocPrestacao>3117801</cLocPrestacao></locPrest>' +
  '<cServ><cTribNac>010101</cTribNac><xDescServ>Desenvolvimento de sistemas</xDescServ></cServ></serv>' +
  '<valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores>' +
  '</infDPS></DPS>' +
  '</infNFSe></NFSe>'

const eventoCancelamento = (chave = CHAVE) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">' +
  '<infEvento Id="EVT1">' +
  `<chNFSe>${chave}</chNFSe><dhEvento>2026-09-03T10:00:00-03:00</dhEvento>` +
  '<tpEvento>101101</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>Cancelamento de NFS-e</xEvento>' +
  '</infEvento></evento>'

describe('chave de acesso da NFS-e', () => {
  it('tem 50 dígitos e se decompõe conforme o leiaute nacional', () => {
    const p = lerChaveNfse(CHAVE)
    assert.ok(p)
    assert.equal(p.codigoMunicipio, '3117801')
    assert.equal(p.ambienteGerador, '2')
    assert.equal(p.tipoInscricao, '2')
    assert.equal(p.inscricaoFederal, CNPJ)
    assert.equal(p.numero, '9')
    assert.equal(p.competencia, '2026-09')
    assert.equal(p.dv, '6')
  })

  it('recusa chave de NF-e (44 dígitos)', () => {
    assert.equal(lerChaveNfse('31260912345678000199550010000012341000012347'), null)
    assert.equal(lerChaveNfse(''), null)
  })
})

describe('leitura da NFS-e', () => {
  const lido = lerDocumentoServico(analisarXml(nfse()))

  it('identifica o tipo pela raiz do XML', () => {
    assert.equal(tipoDoDocumentoServico(analisarXml(nfse())), 'nfse')
    assert.equal(tipoDoDocumentoServico(analisarXml(eventoCancelamento())), 'evento')
    assert.equal(tipoDoDocumentoServico(analisarXml('<outro/>')), 'desconhecido')
  })

  it('lê a chave do atributo Id (NFS + 50 dígitos)', () => {
    assert.equal(lido.tipo, 'nfse')
    assert.equal(lido.chaveAcesso, CHAVE)
  })

  it('separa prestador e tomador', () => {
    assert.equal(lido.nota?.cnpjPrestador, CNPJ)
    assert.equal(lido.nota?.razaoSocialPrestador, 'PAULO SERGIO DE CARVALHO')
    assert.equal(lido.nota?.inscricaoMunicipalPrestador, '13950')
    assert.equal(lido.nota?.cnpjTomador, '11222333000181')
    assert.equal(lido.nota?.razaoSocialTomador, 'CLIENTE EXEMPLO LTDA')
  })

  it('traz número, DPS, competência, situação e serviço', () => {
    assert.equal(lido.nota?.numero, '9')
    assert.equal(lido.nota?.serieDps, '70000')
    assert.equal(lido.nota?.numeroDps, '8')
    assert.equal(lido.nota?.competencia, '2026-09')
    assert.equal(lido.nota?.situacao, 'NFS-e Gerada')
    assert.equal(lido.nota?.descricaoServico, 'Desenvolvimento de sistemas')
    assert.equal(lido.nota?.codigoTributacaoNacional, '010101')
    assert.equal(lido.nota?.municipioEmissao, 'Conceição dos Ouros')
    assert.ok(lido.nota?.dataEmissao instanceof Date)
  })

  it('lê os valores do serviço e do ISSQN', () => {
    assert.equal(lido.nota?.valorServico, 1000)
    assert.equal(lido.nota?.baseCalculo, 1000)
    assert.equal(lido.nota?.aliquota, 2)
    assert.equal(lido.nota?.valorIss, 20)
    assert.equal(lido.nota?.valorLiquido, 980)
  })

  it('traduz as situações do leiaute (TStat)', () => {
    assert.equal(lerDocumentoServico(analisarXml(nfse(CHAVE, '107'))).nota?.situacao, 'NFS-e MEI')
    assert.equal(lerDocumentoServico(analisarXml(nfse(CHAVE, '103'))).nota?.situacao, 'NFS-e Avulsa')
  })
})

describe('eventos da NFS-e', () => {
  it('lê chave, tipo e sequencial', () => {
    const lido = lerDocumentoServico(analisarXml(eventoCancelamento()))
    assert.equal(lido.tipo, 'evento')
    assert.equal(lido.evento?.chaveAcesso, CHAVE)
    assert.equal(lido.evento?.tipoEvento, '101101')
    assert.equal(lido.evento?.numeroSequencial, '1')
  })

  it('reconhece os eventos que cancelam a nota', () => {
    assert.equal(eventoCancelaNfse('101101'), true)
    assert.equal(eventoCancelaNfse('101103'), true)
    assert.equal(eventoCancelaNfse('105102'), true)
    assert.equal(eventoCancelaNfse('202201'), false)
  })
})

describe('papel da empresa na nota', () => {
  it('prestador é receita, tomador é despesa', () => {
    assert.equal(papelNaNota(CNPJ, { cnpjPrestador: CNPJ, cnpjTomador: '11222333000181' }), 'prestador')
    assert.equal(papelNaNota('11222333000181', { cnpjPrestador: CNPJ, cnpjTomador: '11222333000181' }), 'tomador')
    assert.equal(papelNaNota('99999999999999', { cnpjPrestador: CNPJ, cnpjTomador: '11222333000181' }), 'outro')
  })

  it('aceita CNPJ com máscara', () => {
    assert.equal(papelNaNota('60.748.857/0001-16', { cnpjPrestador: CNPJ }), 'prestador')
  })
})

describe('resposta do ADN', () => {
  it('lê lote, NSU e documentos em base64+gzip', () => {
    const corpo = JSON.stringify({
      LoteDFe: [{ NSU: 12, ChaveAcesso: CHAVE, ArquivoXml: gzipSync(Buffer.from(nfse(), 'utf8')).toString('base64') }],
      ultNSU: 12,
      maxNSU: 40,
    })
    const r = interpretarJson(corpo)
    assert.equal(r.documentos.length, 1)
    assert.equal(r.documentos[0].nsu, '12')
    assert.equal(r.documentos[0].chaveAcesso, CHAVE)
    assert.ok(r.documentos[0].xml.includes('<NFSe'))
    assert.equal(r.ultNSU, '12')
    assert.equal(r.maxNSU, '40')
  })

  it('aceita base64 sem compactação e XML em texto puro', () => {
    const emBase64 = JSON.stringify({ LoteDFe: [{ NSU: 1, ArquivoXml: Buffer.from(nfse(), 'utf8').toString('base64') }] })
    assert.ok(interpretarJson(emBase64).documentos[0].xml.includes('<NFSe'))
    const emTexto = JSON.stringify({ LoteDFe: [{ NSU: 1, ArquivoXml: nfse() }] })
    assert.ok(interpretarJson(emTexto).documentos[0].xml.includes('<NFSe'))
  })

  it('registra as chaves do JSON recebido, para conferir o formato real', () => {
    const r = interpretarJson(JSON.stringify({ LoteDFe: [], ultNSU: 3, maxNSU: 3 }))
    assert.deepEqual(r.formatoRecebido, ['LoteDFe', 'ultNSU', 'maxNSU'])
  })

  it('aceita um array na raiz e grafias alternativas dos campos', () => {
    const r = interpretarJson(JSON.stringify([{ nsu: 7, documentoXml: nfse() }]))
    assert.equal(r.documentos.length, 1)
    assert.equal(r.documentos[0].nsu, '7')
  })

  it('corpo vazio não quebra', () => {
    assert.deepEqual(interpretarJson('').documentos, [])
  })

  it('avisa quando a resposta não é JSON', () => {
    assert.throws(() => interpretarJson('<html>erro</html>'), /não é JSON/)
  })

  it('recusa conteúdo que não dá para decodificar', () => {
    assert.throws(() => decodificarDocumento(Buffer.from([0x01, 0x02, 0x03]).toString('base64')), /decodificar/)
  })
})

describe('controle de NSU do ADN', () => {
  it('normaliza o NSU sem o preenchimento de 15 posições da NF-e', () => {
    assert.equal(nsuAdn('000000000000012'), '12')
    assert.equal(nsuAdn(0), '0')
    assert.equal(nsuAdn(''), '0')
  })

  it('continua enquanto o ultNSU for menor que o maxNSU', () => {
    const passo = avaliarRespostaNfse({ ultNSU: '12', maxNSU: '40', documentos: [{ xml: '<x/>' }] }, '0')
    assert.equal(passo.acao, 'continuar')
    assert.equal(passo.nsu, '12')
    assert.equal(passo.temDocumentos, true)
  })

  it('para quando o ultNSU alcança o maxNSU', () => {
    const passo = avaliarRespostaNfse({ ultNSU: '40', maxNSU: '40', documentos: [{ xml: '<x/>' }] }, '12')
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.temDocumentos, true, 'o último lote ainda precisa ser gravado')
  })

  it('lote vazio encerra a varredura sem perder o NSU', () => {
    const passo = avaliarRespostaNfse({ documentos: [] }, '40')
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.nsu, '40')
    assert.equal(passo.situacao, 'aguardando')
  })
})

describe('NSU quando o ADN não devolve ultNSU no topo', () => {
  // formato real observado em produção: StatusProcessamento, LoteDFe, Alertas, Erros,
  // TipoAmbiente, VersaoAplicativo, DataHoraProcessamento — sem ultNSU nem maxNSU
  const respostaReal = (nsus: number[]) =>
    JSON.stringify({
      StatusProcessamento: 'Processado',
      LoteDFe: nsus.map((n) => ({ NSU: n, ArquivoXml: Buffer.from(nfse(), 'utf8').toString('base64') })),
      Alertas: [],
      Erros: [],
      TipoAmbiente: 1,
      VersaoAplicativo: '1.00',
      DataHoraProcessamento: '2026-09-17T16:11:00-03:00',
    })

  it('deriva o ultNSU do maior NSU do lote', () => {
    const r = interpretarJson(respostaReal([14, 15, 16]))
    assert.equal(r.documentos.length, 3)
    assert.equal(r.ultNSU, '16')
    assert.equal(r.maxNSU, undefined)
  })

  it('registra também as chaves de um item do lote', () => {
    const r = interpretarJson(respostaReal([1]))
    assert.ok(r.formatoRecebido?.includes('LoteDFe'))
    assert.ok(r.formatoRecebido?.includes('item:NSU'))
    assert.ok(r.formatoRecebido?.includes('item:ArquivoXml'))
  })

  it('avança e continua quando o NSU derivado é maior que o atual', () => {
    const passo = avaliarRespostaNfse({ ultNSU: '16', documentos: [{ xml: '<x/>' }] }, '0')
    assert.equal(passo.acao, 'continuar')
    assert.equal(passo.nsu, '16')
    assert.equal(passo.motivo, undefined)
  })

  it('PARA quando vêm documentos mas o NSU não avança, em vez de repetir o mesmo lote', () => {
    const passo = avaliarRespostaNfse({ documentos: [{ xml: '<x/>' }] }, '0')
    assert.equal(passo.acao, 'parar')
    assert.equal(passo.motivo, 'sem-nsu')
    assert.equal(passo.temDocumentos, true, 'o lote ainda precisa ser gravado')
  })

  it('também para se o NSU devolvido for menor ou igual ao atual', () => {
    assert.equal(avaliarRespostaNfse({ ultNSU: '16', documentos: [{ xml: '<x/>' }] }, '16').motivo, 'sem-nsu')
    assert.equal(avaliarRespostaNfse({ ultNSU: '9', documentos: [{ xml: '<x/>' }] }, '16').motivo, 'sem-nsu')
  })
})

describe('endereços e raiz de CNPJ', () => {
  it('usa os endereços oficiais do ADN', () => {
    assert.equal(ADN_URLS.producao, 'https://adn.nfse.gov.br/contribuintes')
    assert.equal(ADN_URLS.homologacao, 'https://adn.producaorestrita.nfse.gov.br/contribuintes')
  })

  it('valida a raiz do CNPJ e o CPF inteiro', () => {
    assert.equal(mesmaRaiz('60748857000116', '60748857000205'), true)
    assert.equal(mesmaRaiz('11222333000181', '60748857000116'), false)
    assert.equal(mesmaRaiz('09075959605', '09075959605'), true)
    assert.equal(mesmaRaiz('09075959605', '09075959600'), false)
  })
})
