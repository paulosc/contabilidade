/**
 * Leitor do Comprovante de Inscrição e de Situação Cadastral (cartão CNPJ).
 * O texto abaixo tem a estrutura exata que o leitor de PDF devolve para o comprovante emitido no
 * site da Receita (conferido com um comprovante real em 18/09/2026), com dados fictícios.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroCartaoCnpj, lerCartaoCnpj } from '../cartaoCnpj'

const COMPROVANTE = `REPÚBLICA FEDERATIVA DO BRASIL
CADASTRO NACIONAL DA PESSOA JURÍDICA
NÚMERO DE INSCRIÇÃO
11.222.333/0001-81
MATRIZ
COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO
CADASTRAL
DATA DE ABERTURA
09/05/2025
NOME EMPRESARIAL
EMPRESA DE EXEMPLO TECNOLOGIA LTDA
TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)
EXEMPLOTECH
PORTE
ME
CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL (*)
62.02-3-00 - Desenvolvimento e licenciamento de programas de computador customizáveis (Dispensada *)
CÓDIGO E DESCRIÇÃO DAS ATIVIDADES ECONÔMICAS SECUNDÁRIAS (*)
62.03-1-00 - Desenvolvimento e licenciamento de programas de computador não-customizáveis (Dispensada *)
62.04-0-00 - Consultoria em tecnologia da informação (Dispensada *)
85.99-6-03 - Treinamento em informática (Dispensada *)
CÓDIGO E DESCRIÇÃO DA NATUREZA JURÍDICA
206-2 - Sociedade Empresária Limitada
LOGRADOURO
R DAS FLORES
NÚMERO
81
COMPLEMENTO
********
CEP
37.548-000
BAIRRO/DISTRITO
CENTRO
MUNICÍPIO
CONCEICAO DOS OUROS
UF
MG
ENDEREÇO ELETRÔNICO
CONTATO@EXEMPLOTECH.COM.BR
TELEFONE
(35) 3333-0000
ENTE FEDERATIVO RESPONSÁVEL (EFR)
*****
SITUAÇÃO CADASTRAL
ATIVA
DATA DA SITUAÇÃO CADASTRAL
09/05/2025
MOTIVO DE SITUAÇÃO CADASTRAL
SITUAÇÃO ESPECIAL
********
DATA DA SITUAÇÃO ESPECIAL
********
(*) A dispensa de alvarás e licenças é direito do empreendedor que atende aos requisitos constantes na Resolução CGSIM nº 51, de 11 de junho de 2019, ou da
a Receita Federal qualquer responsabilidade quanto às atividades dispensadas.
Aprovado pela Instrução Normativa RFB nº 2.119, de 06 de dezembro de 2022.
Emitido no dia 09/09/2026 às 11:06:26 (data e hora de Brasília).09/09/2026, 11:06 about:blank
about:blank 1/1`

describe('cartão CNPJ', () => {
  const c = lerCartaoCnpj(COMPROVANTE)

  it('identificação', () => {
    assert.equal(c.cnpj, '11222333000181')
    assert.equal(c.matriz, true)
    assert.equal(c.razaoSocial, 'EMPRESA DE EXEMPLO TECNOLOGIA LTDA')
    assert.equal(c.nomeFantasia, 'EXEMPLOTECH')
    assert.equal(c.dataAbertura, '2025-05-09')
    assert.equal(c.porte, 'ME')
  })
  it('atividades e natureza jurídica, sem a nota de dispensa', () => {
    assert.deepEqual(c.cnaePrincipal, { codigo: '62.02-3-00', descricao: 'Desenvolvimento e licenciamento de programas de computador customizáveis' })
    assert.equal(c.cnaesSecundarios.length, 3)
    assert.deepEqual(c.cnaesSecundarios[2], { codigo: '85.99-6-03', descricao: 'Treinamento em informática' })
    assert.deepEqual(c.naturezaJuridica, { codigo: '206-2', descricao: 'Sociedade Empresária Limitada' })
  })
  it('endereço e contato; campo com asteriscos sai vazio', () => {
    assert.deepEqual(c.endereco, { logradouro: 'R DAS FLORES', numero: '81', cep: '37548000', bairro: 'CENTRO', cidade: 'CONCEICAO DOS OUROS', uf: 'MG' })
    assert.equal(c.email, 'contato@exemplotech.com.br')
    assert.equal(c.telefone, '3533330000')
  })
  it('situação cadastral: motivo vazio não engole o rótulo seguinte', () => {
    assert.equal(c.situacaoCadastral, 'ATIVA')
    assert.equal(c.dataSituacaoCadastral, '2025-05-09')
    assert.equal(c.motivoSituacaoCadastral, undefined)
    assert.equal(c.situacaoEspecial, undefined)
    assert.equal(c.emitidoEm, '2026-09-09')
  })
  it('filial e empresa sem atividade secundária', () => {
    const filial = lerCartaoCnpj(COMPROVANTE.replace('MATRIZ', 'FILIAL').replace(/62\.03-1-00[\s\S]*?85\.99-6-03[^\n]*\n/, 'Não informada\n'))
    assert.equal(filial.matriz, false)
    assert.deepEqual(filial.cnaesSecundarios, [])
  })
})

describe('recusa o que não é o comprovante', () => {
  it('outro PDF', () => {
    assert.throws(() => lerCartaoCnpj('Documento de Arrecadação do Simples Nacional\nCNPJ 11.222.333/0001-81'), ErroCartaoCnpj)
  })
  it('CNPJ com dígito verificador errado', () => {
    assert.throws(() => lerCartaoCnpj(COMPROVANTE.replace('11.222.333/0001-81', '11.222.333/0001-82')), /CNPJ válido/)
  })
})
