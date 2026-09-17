/**
 * Consulta de NFS-e municipal no padrão ABRASF 2.02.
 *
 * Os XMLs deste teste seguem os exemplos oficiais publicados pelo próprio município em
 * "Manuais e Legislação → Integração com o Webservice" (Envio_Recebimento_202.zip), e os
 * namespaces vêm do WSDL publicado em https://conceicaodosouros.nfiss.com.br/?WSDL
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { falhaSoap, interpretarResposta } from '../../providers/fiscal/abrasfNfiss'
import { ABRASF_NS_DADOS, dataAbrasf, hostDoMunicipio, mesesEntre } from '../../providers/fiscal/AbrasfProvider'
import { idNotaMunicipal } from '../importacaoMunicipal'

const compNfse = (numero: string, cancelada = false) =>
  '<CompNfse>' +
  '<Nfse versao="2.02"><InfNfse Id="NFSE1">' +
  `<Numero>${numero}</Numero><CodigoVerificacao>ABC12345</CodigoVerificacao>` +
  '<DataEmissao>2025-03-14T10:22:00-03:00</DataEmissao>' +
  '<ValoresNfse><BaseCalculo>16275.00</BaseCalculo><Aliquota>2.00</Aliquota>' +
  '<ValorIss>325.50</ValorIss><ValorLiquidoNfse>15949.50</ValorLiquidoNfse></ValoresNfse>' +
  '<PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>60748857000116</Cnpj></CpfCnpj>' +
  '<InscricaoMunicipal>13950</InscricaoMunicipal></IdentificacaoPrestador>' +
  '<RazaoSocial>PAULO SERGIO DE CARVALHO</RazaoSocial></PrestadorServico>' +
  '<OrgaoGerador><CodigoMunicipio>3117801</CodigoMunicipio><Uf>MG</Uf></OrgaoGerador>' +
  '<DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico Id="DECL1">' +
  '<Rps Id="RPS1"><IdentificacaoRps><Numero>42</Numero><Serie>A1</Serie><Tipo>1</Tipo></IdentificacaoRps>' +
  '<DataEmissao>2025-03-14</DataEmissao><Status>1</Status></Rps>' +
  '<Competencia>2025-03-01</Competencia>' +
  '<Servico><Valores><ValorServicos>16275.00</ValorServicos><ValorIss>325.50</ValorIss><Aliquota>2.00</Aliquota></Valores>' +
  '<IssRetido>2</IssRetido><ItemListaServico>0105</ItemListaServico>' +
  '<CodigoTributacaoMunicipio>620100100</CodigoTributacaoMunicipio>' +
  '<Discriminacao>DESENVOLVIMENTO DE SOFTWARE EM MARCO/2025</Discriminacao>' +
  '<CodigoMunicipio>3117801</CodigoMunicipio></Servico>' +
  '<Prestador><CpfCnpj><Cnpj>60748857000116</Cnpj></CpfCnpj></Prestador>' +
  '<Tomador><IdentificacaoTomador><CpfCnpj><Cnpj>16713376000183</Cnpj></CpfCnpj></IdentificacaoTomador>' +
  '<RazaoSocial>STARTAIDEIA TECNOLOGIA DA INFORMACAO LTDA</RazaoSocial></Tomador>' +
  '</InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>' +
  '</InfNfse></Nfse>' +
  (cancelada ? '<NfseCancelamento><Confirmacao><DataHora>2025-04-01T09:00:00-03:00</DataHora></Confirmacao></NfseCancelamento>' : '') +
  '</CompNfse>'

/** A resposta real vem com o XML de retorno dentro de outputXML, como texto. */
const envelope = (interno: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  '<ConsultarNfseServicoPrestadoResponse xmlns="http://nfse.abrasf.org.br">' +
  `<outputXML><![CDATA[${interno}]]></outputXML>` +
  '</ConsultarNfseServicoPrestadoResponse></soap:Body></soap:Envelope>'

const resposta = (...comps: string[]) =>
  envelope(
    `<ConsultarNfseServicoPrestadoResposta xmlns="${ABRASF_NS_DADOS}"><ListaNfse>${comps.join('')}</ListaNfse></ConsultarNfseServicoPrestadoResposta>`,
  )

describe('endereço do município na plataforma', () => {
  it('monta produção e homologação pelo apelido', () => {
    assert.equal(hostDoMunicipio('conceicaodosouros', 'producao'), 'conceicaodosouros.nfiss.com.br')
    assert.equal(hostDoMunicipio('conceicaodosouros', 'homologacao'), 'homologaconceicaodosouros.nfiss.com.br')
  })

  it('aceita host completo e URL colada', () => {
    assert.equal(hostDoMunicipio('conceicaodosouros.nfiss.com.br', 'producao'), 'conceicaodosouros.nfiss.com.br')
    assert.equal(hostDoMunicipio('https://conceicaodosouros.nfiss.com.br/soap/', 'producao'), 'conceicaodosouros.nfiss.com.br')
  })
})

describe('faixas de período', () => {
  it('quebra o período mês a mês', () => {
    const faixas = mesesEntre(new Date(2025, 0, 10), new Date(2025, 2, 20))
    assert.equal(faixas.length, 3)
    assert.equal(dataAbrasf(faixas[0].de), '2025-01-10')
    assert.equal(dataAbrasf(faixas[0].ate), '2025-01-31')
    assert.equal(dataAbrasf(faixas[1].de), '2025-02-01')
    assert.equal(dataAbrasf(faixas[2].ate), '2025-03-20')
  })

  it('período dentro de um mês só vira uma faixa', () => {
    const faixas = mesesEntre(new Date(2025, 5, 3), new Date(2025, 5, 9))
    assert.equal(faixas.length, 1)
    assert.equal(dataAbrasf(faixas[0].de), '2025-06-03')
    assert.equal(dataAbrasf(faixas[0].ate), '2025-06-09')
  })
})

describe('leitura da resposta ABRASF', () => {
  const r = interpretarResposta(resposta(compNfse('7')))
  const nota = r.notas[0]

  it('desembrulha o outputXML e encontra a nota', () => {
    assert.equal(r.notas.length, 1)
    assert.equal(nota.numero, '7')
    assert.equal(nota.codigoVerificacao, 'ABC12345')
    assert.equal(nota.cancelada, false)
  })

  it('lê prestador, tomador e RPS', () => {
    assert.equal(nota.cnpjPrestador, '60748857000116')
    assert.equal(nota.razaoSocialPrestador, 'PAULO SERGIO DE CARVALHO')
    assert.equal(nota.inscricaoMunicipalPrestador, '13950')
    assert.equal(nota.cnpjTomador, '16713376000183')
    assert.equal(nota.razaoSocialTomador, 'STARTAIDEIA TECNOLOGIA DA INFORMACAO LTDA')
    assert.equal(nota.numeroRps, '42')
    assert.equal(nota.serieRps, 'A1')
  })

  it('lê valores, competência e serviço', () => {
    assert.equal(nota.valorServicos, 16275)
    assert.equal(nota.baseCalculo, 16275)
    assert.equal(nota.aliquota, 2)
    assert.equal(nota.valorIss, 325.5)
    assert.equal(nota.valorLiquido, 15949.5)
    assert.equal(nota.competencia, '2025-03')
    assert.equal(nota.itemListaServico, '0105')
    assert.equal(nota.codigoMunicipio, '3117801')
    assert.match(nota.discriminacao ?? '', /DESENVOLVIMENTO DE SOFTWARE/)
    assert.ok(nota.dataEmissao instanceof Date)
  })

  it('guarda o XML do próprio bloco da nota', () => {
    assert.ok(nota.xml.startsWith('<CompNfse'))
    assert.ok(nota.xml.includes('<Numero>7</Numero>'))
  })

  it('marca nota cancelada pelo bloco NfseCancelamento', () => {
    const cancelada = interpretarResposta(resposta(compNfse('8', true))).notas[0]
    assert.equal(cancelada.cancelada, true)
  })

  it('separa várias notas do mesmo lote, cada uma com o seu XML', () => {
    const varias = interpretarResposta(resposta(compNfse('1'), compNfse('2'), compNfse('3')))
    assert.equal(varias.notas.length, 3)
    assert.deepEqual(
      varias.notas.map((n) => n.numero),
      ['1', '2', '3'],
    )
    assert.ok(varias.notas[1].xml.includes('<Numero>2</Numero>'))
    assert.equal(varias.notas[1].xml.includes('<Numero>3</Numero>'), false)
  })

  it('lista vazia não quebra', () => {
    const vazia = interpretarResposta(resposta())
    assert.equal(vazia.notas.length, 0)
    assert.equal(vazia.temMaisPaginas, false)
  })

  it('recolhe as mensagens de retorno do município', () => {
    const comErro = envelope(
      `<ConsultarNfseServicoPrestadoResposta xmlns="${ABRASF_NS_DADOS}"><ListaMensagemRetorno>` +
        '<MensagemRetorno><Codigo>E160</Codigo><Mensagem>Nenhuma nota encontrada</Mensagem></MensagemRetorno>' +
        '</ListaMensagemRetorno></ConsultarNfseServicoPrestadoResposta>',
    )
    const r2 = interpretarResposta(comErro)
    assert.equal(r2.notas.length, 0)
    assert.deepEqual(r2.mensagens, ['E160 — Nenhuma nota encontrada'])
  })

  it('reconhece falha SOAP', () => {
    const falha =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Certificado nao autorizado</faultstring></soap:Fault>' +
      '</soap:Body></soap:Envelope>'
    assert.equal(falhaSoap(falha), 'Certificado nao autorizado')
    assert.equal(falhaSoap('<a/>'), undefined)
  })
})

describe('id da nota municipal', () => {
  it('é estável: reimportar a mesma nota não duplica', () => {
    const a = idNotaMunicipal('3117801', '60748857000116', '7')
    const b = idNotaMunicipal('3117801', '60.748.857/0001-16', '7')
    assert.equal(a, b)
    assert.equal(a, 'mun-3117801-60748857000116-7')
  })

  it('separa notas de municípios e prestadores diferentes', () => {
    assert.notEqual(idNotaMunicipal('3117801', '60748857000116', '7'), idNotaMunicipal('3550308', '60748857000116', '7'))
    assert.notEqual(idNotaMunicipal('3117801', '60748857000116', '7'), idNotaMunicipal('3117801', '11222333000181', '7'))
  })

  it('não colide com a chave de acesso nacional, de 50 dígitos', () => {
    assert.ok(idNotaMunicipal('3117801', '60748857000116', '7').startsWith('mun-'))
  })
})
