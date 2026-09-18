/**
 * Contrato de prestação de serviços contábeis: o que importa é não faltar nenhum item do conteúdo
 * mínimo do art. 2º da Resolução CFC 1.590/2020 (alíneas "a" a "m").
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { writeFileSync } from 'node:fs'
import { ErroContrato, clausulasDoContrato, gerarContratoPdf, type DadosContrato } from '../contrato'

const base: DadosContrato = {
  contratada: { nome: 'Escritório Modelo Contábil Ltda', documento: '00.000.000/0001-00', crc: 'MG-000000/O', endereco: 'Rua A, 100, Centro, Pouso Alegre/MG', representante: 'Fulano de Tal', documentoRepresentante: '000.000.000-00' },
  contratante: { nome: 'Cliente de Exemplo Ltda', documento: '11.222.333/0001-81', endereco: 'Rua B, 200, Centro, Pouso Alegre/MG', representante: 'Beltrana de Tal', documentoRepresentante: '111.111.111-11' },
  servicos: ['contabil', 'fiscal', 'acessorias', 'pessoal', 'irpf'],
  diaEntregaDocumentos: 5,
  inicio: '2026-10-01',
  honorarioMensal: 265,
  diaVencimento: 10,
  decimoTerceiroHonorario: true,
  indiceReajuste: 'ipca',
  avisoPrevioDias: 30,
  foro: 'Pouso Alegre/MG',
  data: '2026-09-18',
  cidadeAssinatura: 'Pouso Alegre',
}

describe('cláusulas do contrato', () => {
  const { preambulo, clausulas } = clausulasDoContrato(base)
  const texto = clausulas.map((c) => `${c.titulo}\n${c.paragrafos.join('\n')}`).join('\n')

  it('cobre todas as alíneas do art. 2º da Resolução CFC 1.590/2020', () => {
    const cobertas = new Set(clausulas.flatMap((c) => c.alineas.split(',').map((a) => a.trim())))
    for (const alinea of 'abcdefghijklm') assert.ok(cobertas.has(alinea), `falta a alínea "${alinea}"`)
  })
  it('identifica as partes (a)', () => {
    assert.ok(preambulo.includes('Escritório Modelo Contábil Ltda') && preambulo.includes('11.222.333/0001-81') && preambulo.includes('CRC nº MG-000000/O'))
  })
  it('separa serviço permanente de eventual (b) e diz o que é do cliente (c)', () => {
    assert.ok(texto.includes('de forma permanente') && texto.includes('de forma eventual'))
    assert.ok(texto.includes('Imposto de Renda Pessoa Física'))
    assert.ok(texto.includes('até o dia 5 do mês seguinte'))
  })
  it('traz honorários por extenso, vencimento (e, f), reajuste (g) e aviso prévio (l)', () => {
    assert.ok(texto.includes('R$ 265,00 (duzentos e sessenta e cinco reais)'))
    assert.ok(texto.includes('vencimento no dia 10'))
    assert.ok(texto.includes('IPCA (IBGE)'))
    assert.ok(texto.includes('30 (trinta) dias'))
  })
  it('traz a Carta de Responsabilidade (j), a Lei 9.613/1998 (k) e o foro (m)', () => {
    assert.ok(texto.includes('Carta de Responsabilidade da Administração') && texto.includes('ITG 1000'))
    assert.ok(texto.includes('Lei nº 9.613/1998') && texto.includes('COAF'))
    assert.ok(texto.includes('comarca de Pouso Alegre/MG'))
  })
  it('prazo determinado e sem 13º honorário mudam o texto', () => {
    const t = clausulasDoContrato({ ...base, duracaoMeses: 12, decimoTerceiroHonorario: false }).clausulas.flatMap((c) => c.paragrafos).join('\n')
    assert.ok(t.includes('vigora por 12 meses'))
    assert.ok(!t.includes('honorário adicional'))
    assert.ok(t.includes('Parágrafo primeiro. Os serviços eventuais'))
  })
})

describe('validação', () => {
  it('recusa contrato sem serviço, sem honorário ou com aviso prévio absurdo', () => {
    assert.throws(() => clausulasDoContrato({ ...base, servicos: [] }), ErroContrato)
    assert.throws(() => clausulasDoContrato({ ...base, honorarioMensal: 0 }), ErroContrato)
    assert.throws(() => clausulasDoContrato({ ...base, avisoPrevioDias: 0 }), ErroContrato)
    assert.throws(() => clausulasDoContrato({ ...base, contratante: { nome: '', documento: '' } }), ErroContrato)
  })
  it('só "outros serviços" já basta como objeto', () => {
    assert.doesNotThrow(() => clausulasDoContrato({ ...base, servicos: [], outrosServicos: 'Consultoria tributária mensal' }))
  })
})

describe('PDF', () => {
  it('gera um PDF de poucas páginas', async () => {
    const pdf = await gerarContratoPdf(base)
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
    const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
    assert.ok(paginas >= 2 && paginas <= 5, `${paginas} páginas`)
    if (process.env.AMOSTRA_CONTRATO) writeFileSync(process.env.AMOSTRA_CONTRATO, pdf)
  })
})
