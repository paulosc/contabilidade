/**
 * DANFSe gerado localmente a partir do XML da NFS-e (NT 008/2026 v1.02).
 *
 * O XML de exemplo reproduz a estrutura de uma NFS-e real do Sistema Nacional (Emissor Web),
 * com os dados trocados por fictícios.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  formatarData,
  formatarDataHora,
  formatarDocumento,
  formatarTribNac,
  formatarValor,
  gerarDanfse,
  lerDadosDanfse,
  municipioIbge,
} from '../danfse'

const CHAVE = '31178012260748857000116000000000000926090381879606'

const nfse = (opcoes: { tpAmb?: string; comTomador?: boolean; tribISSQN?: string; competencia?: string } = {}) => {
  const { tpAmb = '1', comTomador = true, tribISSQN = '1', competencia = '2026-09-02' } = opcoes
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">' +
    `<infNFSe Id="NFS${CHAVE}">` +
    '<xLocEmi>Conceição dos Ouros</xLocEmi><xLocPrestacao>Conceição dos Ouros</xLocPrestacao>' +
    '<nNFSe>9</nNFSe><cLocIncid>3117801</cLocIncid><xLocIncid>Conceição dos Ouros</xLocIncid>' +
    '<xTribNac>Elaboração de programas de computadores.</xTribNac><xTribMun>ELABORAÇÃO DE PROGRAMAS</xTribMun>' +
    '<verAplic>EmissorWeb_1.6.0.0</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>2</procEmi>' +
    '<cStat>100</cStat><dhProc>2026-09-02T16:19:40-03:00</dhProc><nDFSe>16863</nDFSe>' +
    '<emit><CNPJ>11222333000181</CNPJ><IM>13950</IM><xNome>EMPRESA EXEMPLO LTDA</xNome>' +
    '<enderNac><xLgr>RUA DAS FLORES</xLgr><nro>81</nro><xBairro>CENTRO</xBairro><cMun>3117801</cMun><UF>MG</UF><CEP>37548000</CEP></enderNac>' +
    '<fone>3591040850</fone><email>contato@exemplo.com.br</email></emit>' +
    '<valores><vLiq>16990.00</vLiq></valores>' +
    '<DPS versao="1.01"><infDPS Id="DPS311780121122233300018170000000000000000008">' +
    `<tpAmb>${tpAmb}</tpAmb><dhEmi>2026-09-02T16:19:40-03:00</dhEmi><verAplic>EmissorWeb_1.6.0.0</verAplic>` +
    `<serie>70000</serie><nDPS>8</nDPS><dCompet>${competencia}</dCompet><tpEmit>1</tpEmit><cLocEmi>3117801</cLocEmi>` +
    '<prest><CNPJ>11222333000181</CNPJ><IM>13950</IM><fone>3591040850</fone><email>contato@exemplo.com.br</email>' +
    '<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>' +
    (comTomador
      ? '<toma><CNPJ>16713376000183</CNPJ><xNome>CLIENTE TECNOLOGIA LTDA</xNome>' +
        '<end><endNac><cMun>4314902</cMun><CEP>90540010</CEP></endNac><xLgr>CANDIDO SILVEIRA</xLgr><nro>198</nro><xCpl>SALA 304</xCpl><xBairro>AUXILIADORA</xBairro></end></toma>'
      : '') +
    '<serv><locPrest><cLocPrestacao>3117801</cLocPrestacao></locPrest>' +
    '<cServ><cTribNac>010401</cTribNac><cTribMun>001</cTribMun><xDescServ>PRESTAÇÃO DE SERVIÇO DE DESENVOLVIMENTO DE SOFTWARE EM AGOSTO/2026.</xDescServ></cServ></serv>' +
    '<valores><vServPrest><vServ>16990.00</vServ></vServPrest>' +
    `<trib><tribMun><tribISSQN>${tribISSQN}</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
    '<tribFed><piscofins><CST>00</CST><tpRetPisCofins>0</tpRetPisCofins></piscofins></tribFed>' +
    '<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>' +
    '</infDPS></DPS></infNFSe>' +
    '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/><SignatureValue>x</SignatureValue></Signature>' +
    '</NFSe>'
  )
}

describe('formatação dos campos do DANFSe', () => {
  it('documentos, valores, datas e código de tributação no formato da NT', () => {
    assert.equal(formatarDocumento('11222333000181'), '11.222.333/0001-81')
    assert.equal(formatarDocumento(undefined, '12345678909'), '123.456.789-09')
    assert.equal(formatarDocumento(), '-')
    assert.equal(formatarValor('16990.00'), '16.990,00')
    assert.equal(formatarValor(undefined), '-')
    assert.equal(formatarDataHora('2026-09-02T16:19:40-03:00'), '02/09/2026 16:19:40')
    assert.equal(formatarData('2026-09-02'), '02/09/2026')
    assert.equal(formatarTribNac('010401'), '01.04.01')
  })

  it('resolve o município pelo código IBGE embarcado', () => {
    assert.deepEqual(municipioIbge('3117801'), { nome: 'Conceição dos Ouros', uf: 'MG' })
    assert.deepEqual(municipioIbge('4314902'), { nome: 'Porto Alegre', uf: 'RS' })
    assert.equal(municipioIbge('0000000'), undefined)
  })
})

describe('leitura do XML da NFS-e', () => {
  const d = lerDadosDanfse(nfse())

  it('identificação da nota', () => {
    assert.equal(d.chave, CHAVE)
    assert.equal(d.nNFSe, '9')
    assert.equal(d.nDPS, '8')
    assert.equal(d.serie, '70000')
    assert.equal(d.dCompet, '02/09/2026')
    assert.equal(d.dhProc, '02/09/2026 16:19:40')
    assert.equal(d.tpEmit, 'Prestador')
    assert.equal(d.cStat, 'NFS-e Gerada')
    assert.equal(d.ambGer, 'Sistema Nacional da NFS-e')
    assert.equal(d.municipioEmitente, 'Município: Conceição dos Ouros / MG')
  })

  it('prestador completa nome e endereço com o bloco emit quando o emitente é o próprio prestador', () => {
    assert.equal(d.prestador.documento, '11.222.333/0001-81')
    assert.equal(d.prestador.nome, 'EMPRESA EXEMPLO LTDA')
    assert.equal(d.prestador.endereco, 'RUA DAS FLORES, 81, CENTRO')
    assert.equal(d.prestador.municipioUf, 'Conceição dos Ouros / MG')
    assert.equal(d.prestador.ibgeCep, '3117801 / 37.548-000')
    assert.equal(d.prestador.simplesNacional, 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)')
    assert.match(d.prestador.regimeApuracao, /^Regime de apuração dos tributos federais e municipal pelo SN/)
  })

  it('tomador com município resolvido pela tabela IBGE', () => {
    assert.equal(d.tomador?.nome, 'CLIENTE TECNOLOGIA LTDA')
    assert.equal(d.tomador?.municipioUf, 'Porto Alegre / RS')
    assert.equal(d.tomador?.ibgeCep, '4314902 / 90.540-010')
    assert.equal(d.tomador?.endereco, 'CANDIDO SILVEIRA, 198, SALA 304, AUXILIADORA')
    assert.equal(d.tomador?.im, '-')
  })

  it('serviço, ISSQN e totais', () => {
    assert.equal(d.servico.codigos, '01.04.01 / 001')
    assert.equal(d.servico.localPrestacao, 'Conceição dos Ouros / MG / BR')
    assert.equal(d.servico.descricaoCodigo, 'ELABORAÇÃO DE PROGRAMAS')
    assert.equal(d.issqn?.tipo, 'Operação tributável')
    assert.equal(d.issqn?.retencao, 'Não Retido')
    assert.equal(d.issqn?.baseCalculo, '-')
    assert.equal(d.issqn?.temLinhaRegime, false)
    assert.equal(d.total.servico, '16.990,00')
    assert.equal(d.total.liquido, '16.990,00')
    assert.equal(d.federal.descricaoRetencao, 'PIS/COFINS/CSLL Não Retidos')
    assert.equal(d.federal.imprimirPisCofins, true)
  })

  it('informações complementares terminam com os totais aproximados dos tributos', () => {
    assert.match(d.informacoesComplementares, /Totais Aproximados dos Tributos cfe\. Lei nº 12\.741\/2012: Simples Nacional: 6,00%$/)
  })

  it('sem tomador, o bloco é suprimido; sem ISSQN, o bloco vira o aviso', () => {
    const semTomador = lerDadosDanfse(nfse({ comTomador: false }))
    assert.equal(semTomador.tomador, undefined)
    const exportacao = lerDadosDanfse(nfse({ tribISSQN: '3' }))
    assert.equal(exportacao.issqn, undefined)
  })

  it('linha de PIS/COFINS só até a competência de 2026', () => {
    assert.equal(lerDadosDanfse(nfse({ competencia: '2027-01-15' })).federal.imprimirPisCofins, false)
  })

  it('rejeita XML que não é NFS-e', () => {
    assert.throws(() => lerDadosDanfse('<a><b/></a>'), /infNFSe/)
  })
})

describe('geração do PDF', () => {
  const paginas = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

  it('produz um PDF de página única', async () => {
    const pdf = await gerarDanfse(nfse())
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    assert.equal(paginas(pdf), 1)
    assert.ok(pdf.length > 20_000, 'tem fontes, logo e QR embutidos')
  })

  it('homologação, sem tomador, cancelada: continua uma página', async () => {
    for (const [xml, opcoes] of [
      [nfse({ tpAmb: '2' }), {}],
      [nfse({ comTomador: false, tribISSQN: '4' }), {}],
      [nfse(), { marcaDagua: 'CANCELADA' as const }],
    ] as const) {
      const pdf = await gerarDanfse(xml, opcoes)
      assert.equal(paginas(pdf), 1)
    }
  })
})
