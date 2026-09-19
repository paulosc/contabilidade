/**
 * Emissão de NFS-e: montagem do DPS e dos eventos (leiaute v1.01), assinatura XMLDSig e
 * leitura das respostas do SEFIN Nacional (contrato do Swagger oficial).
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import { assinarXml, materialDoPfx, verificarAssinatura } from '../assinatura'
import {
  agoraBrasilia,
  idDps,
  idPedidoEvento,
  lerDpsDeNfse,
  montarDps,
  montarPedidoCancelamento,
  validarDps,
  type DadosDps,
} from '../dps'
import { comDeclaracaoUtf8, comprimir, descomprimir, interpretarConsultaDps, interpretarEmissao, interpretarEvento, resumirErros } from '../../providers/fiscal/sefinNacional'
import { gerarCertificadoDeTeste } from './apoio'

const CHAVE = '31178012260748857000116000000000000926090381879606'

const dadosBase = (): DadosDps => ({
  ambiente: 'homologacao',
  dhEmi: '2026-09-17T10:00:00-03:00',
  serie: '1',
  numero: '7',
  competencia: '2026-09-01',
  tpEmit: '1',
  codigoMunicipioEmissao: '3117801',
  prestador: {
    cnpj: '11222333000181',
    inscricaoMunicipal: '13950',
    fone: '3591040850',
    email: 'contato@exemplo.com.br',
    regime: { opSimpNac: '3', regApTribSN: '1', regEspTrib: '0' },
  },
  tomador: {
    cnpj: '16713376000183',
    nome: 'CLIENTE & CIA <LTDA>',
    endereco: { codigoMunicipio: '4314902', cep: '90540010', logradouro: 'CANDIDO SILVEIRA', numero: '198', complemento: 'SALA 304', bairro: 'AUXILIADORA' },
  },
  servico: { codigoMunicipioPrestacao: '3117801', cTribNac: '010401', cTribMun: '001', descricao: 'DESENVOLVIMENTO DE SOFTWARE EM SETEMBRO/2026' },
  valores: {
    vServ: '16990.00',
    tribMun: { tribISSQN: '1', tpRetISSQN: '1' },
    tribFed: { piscofins: { cst: '00', tpRetPisCofins: '0' } },
    totTrib: { pTotTribSN: '6.00' },
  },
})

/** Ordem dos filhos diretos de um elemento, para conferir contra o XSD. */
const ordem = (xml: string, pai: string): string[] => {
  const corpo = new RegExp(`<${pai}[^>]*>([\\s\\S]*?)</${pai}>`).exec(xml)?.[1] ?? ''
  const nomes: string[] = []
  let nivel = 0
  for (const m of corpo.matchAll(/<(\/?)([A-Za-z][\w]*)[^>]*?(\/?)>/g)) {
    const [, fecha, nome, vazio] = m
    if (fecha) nivel--
    else {
      if (nivel === 0) nomes.push(nome)
      if (!vazio) nivel++
    }
  }
  return nomes
}

describe('identificadores do leiaute', () => {
  it('Id do DPS: DPS + município(7) + tipo(1) + inscrição(14) + série(5) + número(15)', () => {
    assert.equal(idDps('3117801', '60748857000116', '70000', '8'), 'DPS311780126074885700011670000000000000000008')
    assert.equal(idDps('3117801', '12345678909', '1', '7'), 'DPS311780110001234567890900001000000000000007')
    assert.match(idDps('3117801', '11222333000181', '1', '1'), /^DPS\d{42}$/)
  })

  it('Id do pedido de evento: PRE + chave(50) + tipo(6)', () => {
    assert.equal(idPedidoEvento(CHAVE, '101101'), `PRE${CHAVE}101101`)
    assert.match(idPedidoEvento(CHAVE, '101101'), /^PRE\d{56}$/)
  })
})

describe('montagem do DPS', () => {
  const { xml, id } = montarDps(dadosBase())

  it('raiz, namespace, versão e Id', () => {
    assert.ok(xml.startsWith('<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS'))
    assert.equal(id, 'DPS311780121122233300018100001000000000000007')
    assert.ok(xml.includes(`<infDPS Id="${id}">`))
  })

  it('segue a ordem do TCInfDPS', () => {
    assert.deepEqual(ordem(xml, 'infDPS'), ['tpAmb', 'dhEmi', 'verAplic', 'serie', 'nDPS', 'dCompet', 'tpEmit', 'cLocEmi', 'prest', 'toma', 'serv', 'valores'])
    assert.deepEqual(ordem(xml, 'prest'), ['CNPJ', 'IM', 'fone', 'email', 'regTrib'])
    assert.deepEqual(ordem(xml, 'toma'), ['CNPJ', 'xNome', 'end'])
    assert.deepEqual(ordem(xml, 'end'), ['endNac', 'xLgr', 'nro', 'xCpl', 'xBairro'])
    assert.deepEqual(ordem(xml, 'valores'), ['vServPrest', 'trib'])
    assert.deepEqual(ordem(xml, 'trib'), ['tribMun', 'tribFed', 'totTrib'])
  })

  it('homologação vira tpAmb 2; produção vira 1', () => {
    assert.ok(xml.includes('<tpAmb>2</tpAmb>'))
    assert.ok(montarDps({ ...dadosBase(), ambiente: 'producao' }).xml.includes('<tpAmb>1</tpAmb>'))
  })

  it('escapa o texto e não emite opcionais vazios', () => {
    assert.ok(xml.includes('<xNome>CLIENTE &amp; CIA &lt;LTDA&gt;</xNome>'))
    assert.equal(xml.includes('<vDescCondIncond>'), false)
    assert.equal(xml.includes('<subst>'), false)
    assert.equal(xml.includes('<interm>'), false)
  })

  it('substituição entra antes do prestador, com a chave e o motivo', () => {
    const d = dadosBase()
    d.substituicao = { chaveSubstituida: CHAVE, motivo: '99', descricao: 'Valor informado errado na nota original' }
    const { xml: x } = montarDps(d)
    assert.deepEqual(ordem(x, 'infDPS').slice(7, 10), ['cLocEmi', 'subst', 'prest'])
    assert.ok(x.includes(`<subst><chSubstda>${CHAVE}</chSubstda><cMotivo>99</cMotivo><xMotivo>Valor informado errado na nota original</xMotivo></subst>`))
  })

  it('valida antes de montar: número, valor, motivo', () => {
    assert.throws(() => montarDps({ ...dadosBase(), numero: '007' }), /Número do DPS/)
    assert.throws(() => montarDps({ ...dadosBase(), valores: { ...dadosBase().valores, vServ: '0' } }), /maior que zero/)
    assert.doesNotThrow(() => montarDps({ ...dadosBase(), valores: { ...dadosBase().valores, vServ: '16990' } }), 'valor inteiro é aceito')
    const d = dadosBase()
    d.substituicao = { chaveSubstituida: '123', motivo: '99' }
    assert.throws(() => validarDps(d), /50 dígitos/)
  })
})

describe('leitura do DPS embutido numa NFS-e (modelo para "gerar igual")', () => {
  const nfse =
    '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS' + CHAVE + '"><nNFSe>9</nNFSe>' +
    '<DPS versao="1.01"><infDPS Id="DPS311780126074885700011670000000000000000008"><tpAmb>1</tpAmb><dhEmi>2026-09-02T16:19:40-03:00</dhEmi>' +
    '<verAplic>EmissorWeb_1.6.0.0</verAplic><serie>70000</serie><nDPS>8</nDPS><dCompet>2026-09-02</dCompet><tpEmit>1</tpEmit><cLocEmi>3117801</cLocEmi>' +
    '<prest><CNPJ>60748857000116</CNPJ><IM>13950</IM><fone>3591040850</fone><email>X@Y.COM</email><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>' +
    '<toma><CNPJ>16713376000183</CNPJ><xNome>STARTAIDEIA</xNome><end><endNac><cMun>4314902</cMun><CEP>90540010</CEP></endNac><xLgr>CANDIDO SILVEIRA</xLgr><nro>198</nro><xCpl>SALA  304</xCpl><xBairro>AUXILIADORA</xBairro></end></toma>' +
    '<serv><locPrest><cLocPrestacao>3117801</cLocPrestacao></locPrest><cServ><cTribNac>010401</cTribNac><cTribMun>001</cTribMun><xDescServ>DESENVOLVIMENTO EM AGOSTO/2026.</xDescServ></cServ></serv>' +
    '<valores><vServPrest><vServ>16990.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>' +
    '<tribFed><piscofins><CST>00</CST><tpRetPisCofins>0</tpRetPisCofins></piscofins></tribFed><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>' +
    '</infDPS></DPS></infNFSe></NFSe>'

  it('traz o modelo completo e remonta um DPS válido com numeração nova', () => {
    const { dados, gruposIgnorados } = lerDpsDeNfse(nfse)
    assert.deepEqual(gruposIgnorados, [])
    assert.equal(dados.prestador.cnpj, '60748857000116')
    assert.equal(dados.prestador.regime.opSimpNac, '3')
    assert.equal(dados.tomador?.nome, 'STARTAIDEIA')
    assert.equal(dados.tomador?.endereco?.codigoMunicipio, '4314902')
    assert.equal(dados.servico.cTribNac, '010401')
    assert.equal(dados.valores.vServ, '16990.00')
    assert.equal(dados.valores.totTrib.pTotTribSN, '6.00')
    assert.equal(dados.valores.tribFed?.piscofins?.cst, '00')

    const novo = { ...dados, serie: '1', numero: '1', dhEmi: '2026-10-01T09:00:00-03:00', competencia: '2026-10-01', valores: { ...dados.valores, vServ: '17500.00' } }
    const { xml, id } = montarDps(novo)
    assert.equal(id, 'DPS311780126074885700011600001000000000000001')
    assert.ok(xml.includes('<vServ>17500.00</vServ>'))
    assert.ok(xml.includes('<verAplic>Contabilidade_1.0</verAplic>'))
    assert.ok(xml.includes('<xCpl>SALA  304</xCpl>'))
  })

  it('avisa quando a nota-modelo tem grupos que a emissão não reproduz', () => {
    const comObra = nfse.replace('<serv>', '<serv><obra><cObra>123</cObra></obra>')
    assert.deepEqual(lerDpsDeNfse(comObra).gruposIgnorados, ['obra'])
  })
})

describe('pedido de cancelamento (e101101)', () => {
  it('monta o pedido na ordem do TCInfPedReg com a descrição fixa do evento', () => {
    const { xml, id } = montarPedidoCancelamento({
      ambiente: 'producao',
      dhEvento: '2026-09-17T11:00:00-03:00',
      autor: { cnpj: '60748857000116' },
      chave: CHAVE,
      motivo: '1',
      descricao: 'Nota emitida com o valor errado, será reemitida',
    })
    assert.equal(id, `PRE${CHAVE}101101`)
    assert.ok(xml.startsWith('<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infPedReg Id="PRE'))
    assert.deepEqual(ordem(xml, 'infPedReg'), ['tpAmb', 'verAplic', 'dhEvento', 'CNPJAutor', 'chNFSe', 'e101101'])
    assert.deepEqual(ordem(xml, 'e101101'), ['xDesc', 'cMotivo', 'xMotivo'])
    assert.ok(xml.includes('<xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo>'))
  })

  it('exige justificativa de 15 a 255 caracteres', () => {
    const base = { ambiente: 'producao' as const, dhEvento: '2026-09-17T11:00:00-03:00', autor: { cnpj: '60748857000116' }, chave: CHAVE, motivo: '9' as const }
    assert.throws(() => montarPedidoCancelamento({ ...base, descricao: 'curta' }), /15 a 255/)
    assert.throws(() => montarPedidoCancelamento({ ...base, descricao: 'x'.repeat(256) }), /15 a 255/)
  })

  it('data/hora de Brasília no formato do leiaute', () => {
    assert.match(agoraBrasilia(new Date('2026-09-17T14:05:09Z')), /^2026-09-17T11:05:09-03:00$/)
  })
})

describe('assinatura XMLDSig', () => {
  const cert = gerarCertificadoDeTeste({ cnpj: '11222333000181' })
  const material = materialDoPfx(cert.pfxBase64, cert.senha)

  it('assina o infDPS, põe a Signature como irmã, sem prefixo, com o certificado no KeyInfo', () => {
    const { xml, id } = montarDps(dadosBase())
    const assinado = assinarXml(xml, id, material)
    assert.ok(/<\/infDPS><Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/.test(assinado), 'Signature logo após o infDPS')
    assert.ok(assinado.trimEnd().endsWith('</Signature></DPS>'))
    assert.equal(/<ds:/.test(assinado), false, 'nenhum prefixo de namespace (E1228)')
    assert.ok(assinado.includes(`<Reference URI="#${id}">`))
    assert.ok(assinado.includes('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"'))
    assert.ok(assinado.includes('Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"'))
    assert.ok(assinado.includes('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"'))
    assert.ok(assinado.includes('<X509Certificate>' + material.certificadoBase64.slice(0, 20)))
    assert.equal(verificarAssinatura(assinado, material.certificadoPem), true)
  })

  it('a declaração UTF-8 acrescentada no envio não quebra a assinatura', () => {
    const { xml, id } = montarDps(dadosBase())
    const enviado = descomprimir(comprimir(assinarXml(xml, id, material)))
    assert.ok(enviado.startsWith('<?xml version="1.0" encoding="UTF-8"?><DPS '))
    assert.equal(verificarAssinatura(enviado, material.certificadoPem), true)
  })

  it('a verificação falha se o conteúdo assinado for alterado', () => {
    const { xml, id } = montarDps(dadosBase())
    const assinado = assinarXml(xml, id, material).replace('<vServ>16990.00</vServ>', '<vServ>1.00</vServ>')
    assert.equal(verificarAssinatura(assinado, material.certificadoPem), false)
  })

  it('assina também o pedido de evento', () => {
    const { xml, id } = montarPedidoCancelamento({
      ambiente: 'homologacao',
      dhEvento: '2026-09-17T11:00:00-03:00',
      autor: { cnpj: '11222333000181' },
      chave: CHAVE,
      motivo: '2',
      descricao: 'Serviço não foi prestado ao tomador',
    })
    const assinado = assinarXml(xml, id, material)
    assert.ok(/<\/infPedReg><Signature /.test(assinado))
    assert.equal(verificarAssinatura(assinado, material.certificadoPem), true)
  })

  it('senha errada do certificado é recusada', () => {
    assert.throws(() => materialDoPfx(cert.pfxBase64, 'errada'))
  })
})

describe('respostas do SEFIN Nacional', () => {
  const nfseXml = '<NFSe><infNFSe Id="NFS' + CHAVE + '"><nNFSe>10</nNFSe></infNFSe></NFSe>'

  it('gzip + base64 vai e volta, sempre com a declaração UTF-8 (sem ela o SEFIN rejeita com E1229)', () => {
    assert.equal(descomprimir(comprimir('<a>ç</a>')), '<?xml version="1.0" encoding="UTF-8"?><a>ç</a>')
  })

  it('declaração UTF-8: acrescenta, troca a que declara outra codificação e tira o BOM', () => {
    assert.equal(comDeclaracaoUtf8('<a/>'), '<?xml version="1.0" encoding="UTF-8"?><a/>')
    assert.equal(comDeclaracaoUtf8('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'), '<?xml version="1.0" encoding="UTF-8"?><a/>')
    assert.equal(comDeclaracaoUtf8(String.fromCharCode(0xfeff) + '<a/>'), '<?xml version="1.0" encoding="UTF-8"?><a/>')
    assert.equal(comDeclaracaoUtf8(comDeclaracaoUtf8('<a/>')), '<?xml version="1.0" encoding="UTF-8"?><a/>')
  })

  it('201: chave, id do DPS e a NFS-e descompactada', () => {
    const corpo = JSON.stringify({
      tipoAmbiente: 2,
      versaoAplicativo: '1.0',
      dataHoraProcessamento: '2026-09-17T10:00:01-03:00',
      idDps: 'DPS311780121122233300018100001000000000000007',
      chaveAcesso: CHAVE,
      nfseXmlGZipB64: gzipSync(Buffer.from(nfseXml)).toString('base64'),
      alertas: [{ codigo: 'A001', descricao: 'Alerta qualquer' }],
    })
    const r = interpretarEmissao(201, corpo)
    assert.equal(r.chaveAcesso, CHAVE)
    assert.equal(r.nfseXml, nfseXml)
    assert.equal(r.alertas[0].codigo, 'A001')
    assert.deepEqual(r.erros, [])
  })

  it('400: lista de erros de negócio legível', () => {
    const r = interpretarEmissao(400, JSON.stringify({ tipoAmbiente: 2, erros: [{ codigo: 'E0718', descricao: 'A assinatura deve ser feita com o certificado do emitente', complemento: 'CNPJ difere' }] }))
    assert.equal(r.chaveAcesso, undefined)
    assert.equal(resumirErros(r.erros), 'E0718 — A assinatura deve ser feita com o certificado do emitente (CNPJ difere)')
  })

  it('erro fora do JSON (gateway) ainda vira mensagem', () => {
    const r = interpretarEmissao(503, '<html><body><h1>503 Service Unavailable</h1></body></html>')
    assert.equal(r.erros[0].codigo, 'HTTP503')
    assert.match(r.erros[0].descricao, /503 Service Unavailable/)
  })

  it('evento registrado: XML do evento descompactado', () => {
    const ev = '<evento><infEvento Id="EVT' + CHAVE + '101101001"/></evento>'
    const r = interpretarEvento(201, JSON.stringify({ tipoAmbiente: 1, eventoXmlGZipB64: gzipSync(Buffer.from(ev)).toString('base64') }))
    assert.equal(r.eventoXml, ev)
    assert.equal(interpretarEvento(400, JSON.stringify({ erros: [{ codigo: 'E0046', descricao: 'Uma NFS-e cancelada não pode ser substituída.' }] })).erros[0].codigo, 'E0046')
  })

  it('consulta de DPS: 404 é "ainda não gerou nota", 200 traz a chave', () => {
    assert.deepEqual(interpretarConsultaDps(404, ''), { status: 404, erros: [] })
    const r = interpretarConsultaDps(200, JSON.stringify({ chaveAcesso: CHAVE, idDps: 'DPS1' }))
    assert.equal(r.chaveAcesso, CHAVE)
  })
})
