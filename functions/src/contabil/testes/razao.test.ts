import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { PLANO_PADRAO, ancestrais, grupoDoCodigo } from '../planoDeContas'
import { ErroContabil, balancete, dre, lancamentoDoExtrato, normalizarMemo, sugerirConta, validarLancamento, type Lancamento } from '../razao'

const contas = new Map(PLANO_PADRAO.map((c) => [c.codigo, c]))
const BANCO = '1.1.1.02'

describe('plano de contas padrão', () => {
  it('códigos únicos e toda conta com pai existente', () => {
    assert.equal(new Set(PLANO_PADRAO.map((c) => c.codigo)).size, PLANO_PADRAO.length)
    for (const c of PLANO_PADRAO) for (const pai of ancestrais(c.codigo)) assert.ok(contas.has(pai), `${c.codigo} sem ${pai}`)
  })
  it('sintética é quem tem filha; toda conta de resultado analítica tem linha na DRE', () => {
    assert.equal(contas.get('1.1.1')!.analitica, false)
    assert.equal(contas.get(BANCO)!.analitica, true)
    for (const c of PLANO_PADRAO) if (c.analitica && ['receita', 'custo', 'despesa'].includes(c.grupo)) assert.ok(c.dre, c.codigo)
  })
  it('grupo e natureza: PL dentro do 2, custo dentro do 4, redutoras invertidas', () => {
    assert.equal(grupoDoCodigo('2.3.1.01'), 'pl')
    assert.equal(grupoDoCodigo('4.1.1.01'), 'custo')
    assert.equal(contas.get('1.2.1.09')!.natureza, 'credora')
    assert.equal(contas.get('3.1.2.01')!.natureza, 'devedora')
    assert.equal(contas.get('2.3.2.03')!.natureza, 'devedora')
  })
})

describe('validação do lançamento', () => {
  const ok: Lancamento = { data: '2026-08-05', historico: 'Recebimento de cliente', partidas: [{ conta: BANCO, debito: 5000 }, { conta: '3.1.1.01', credito: 5000 }] }
  it('aceita partidas que fecham e devolve o valor', () => {
    assert.equal(validarLancamento(ok, contas), 5000)
  })
  it('aceita várias partidas de um lado (0,10 + 0,20 = 0,30 fecha em centavos)', () => {
    assert.equal(validarLancamento({ data: '2026-08-05', historico: 'x', partidas: [{ conta: '4.2.3.01', debito: 0.1 }, { conta: '4.2.3.02', debito: 0.2 }, { conta: BANCO, credito: 0.3 }] }, contas), 0.3)
  })
  it('recusa o que não fecha, conta sintética, conta inexistente, partida dupla e histórico vazio', () => {
    const com = (p: Partial<Lancamento>) => () => validarLancamento({ ...ok, ...p }, contas)
    assert.throws(com({ partidas: [{ conta: BANCO, debito: 100 }, { conta: '3.1.1.01', credito: 99.99 }] }), /não fecham/)
    assert.throws(com({ partidas: [{ conta: '1.1.1', debito: 100 }, { conta: '3.1.1.01', credito: 100 }] }), /sintética/)
    assert.throws(com({ partidas: [{ conta: '9.9.9', debito: 100 }, { conta: '3.1.1.01', credito: 100 }] }), /não existe/)
    assert.throws(com({ partidas: [{ conta: BANCO, debito: 100, credito: 100 }, { conta: '3.1.1.01', credito: 100 }] }), ErroContabil)
    assert.throws(com({ historico: '  ' }), /histórico/)
    assert.throws(com({ data: '2026-13-40' }), /Data/)
    assert.throws(com({ partidas: [{ conta: BANCO, debito: 100 }] }), ErroContabil)
  })
})

describe('lançamento a partir do extrato', () => {
  it('entrada debita o banco; saída credita', () => {
    assert.deepEqual(lancamentoDoExtrato({ data: '2026-08-05', valor: 5000, memo: 'PIX RECEBIDO' }, BANCO, '3.1.1.01').partidas, [{ conta: BANCO, debito: 5000 }, { conta: '3.1.1.01', credito: 5000 }])
    assert.deepEqual(lancamentoDoExtrato({ data: '2026-08-31', valor: -29.9, memo: 'TARIFA' }, BANCO, '4.2.3.01').partidas, [{ conta: '4.2.3.01', debito: 29.9 }, { conta: BANCO, credito: 29.9 }])
  })
  it('usa o memo como histórico quando nada é informado', () => {
    assert.equal(lancamentoDoExtrato({ data: '2026-08-31', valor: -1, memo: 'TARIFA' }, BANCO, '4.2.3.01').historico, 'TARIFA')
    assert.equal(lancamentoDoExtrato({ data: '2026-08-31', valor: -1, memo: 'TARIFA' }, BANCO, '4.2.3.01', 'Tarifa de agosto').historico, 'Tarifa de agosto')
  })
})

// um mês de uma prestadora de serviços no Simples
const mes: Lancamento[] = [
  { data: '2026-07-01', historico: 'Integralização do capital', partidas: [{ conta: BANCO, debito: 10000 }, { conta: '2.3.1.01', credito: 10000 }] },
  { data: '2026-08-05', historico: 'Recebimento de cliente', partidas: [{ conta: BANCO, debito: 20000 }, { conta: '3.1.1.01', credito: 20000 }] },
  { data: '2026-08-10', historico: 'Pró-labore', partidas: [{ conta: '4.2.1.02', debito: 5600 }, { conta: BANCO, credito: 5600 }] },
  { data: '2026-08-15', historico: 'Aluguel', partidas: [{ conta: '4.2.2.01', debito: 1500 }, { conta: BANCO, credito: 1500 }] },
  { data: '2026-08-31', historico: 'Provisão do DAS', partidas: [{ conta: '3.1.2.01', debito: 1460 }, { conta: '2.1.2.01', credito: 1460 }] },
  { data: '2026-08-31', historico: 'Tarifa', partidas: [{ conta: '4.2.3.01', debito: 29.9 }, { conta: BANCO, credito: 29.9 }] },
  { data: '2026-09-21', historico: 'Pagamento do DAS', partidas: [{ conta: '2.1.2.01', debito: 1460 }, { conta: BANCO, credito: 1460 }] },
]

describe('balancete', () => {
  const b = balancete(PLANO_PADRAO, mes, '2026-08-01', '2026-08-31')
  const linha = (codigo: string) => b.linhas.find((l) => l.codigo === codigo)!

  it('débitos e créditos do período fecham', () => {
    assert.equal(b.totalDebitos, b.totalCreditos)
    assert.equal(b.totalDebitos, 28589.9)
  })
  it('saldo anterior vem do que é anterior ao período; o que é posterior fica de fora', () => {
    assert.equal(linha(BANCO).saldoAnterior, 10000)
    assert.equal(linha(BANCO).debitos, 20000)
    assert.equal(linha(BANCO).creditos, 7129.9)
    assert.equal(linha(BANCO).saldoFinal, 22870.1)
    assert.equal(linha('2.1.2.01').saldoFinal, 1460) // o pagamento de setembro não entrou
  })
  it('saldo sai na natureza da conta e as sintéticas somam as filhas', () => {
    assert.equal(linha('3.1.1.01').saldoFinal, 20000) // credora, positivo
    assert.equal(linha('3.1.2.01').saldoFinal, 1460) // redutora devedora, positivo
    assert.equal(linha('1').saldoFinal, 22870.1)
    assert.equal(linha('4.2').saldoFinal, 7129.9)
    assert.equal(linha('3').saldoFinal, 18540) // receita líquida: 20.000 − 1.460
  })
  it('ativo = passivo + PL + resultado', () => {
    assert.deepEqual(b.fechamento, { ativo: 22870.1, passivoEPl: 11460, resultado: 11410.1, confere: true })
  })
  it('contas sem movimento nem saldo não aparecem', () => {
    assert.equal(
      b.linhas.some((l) => l.codigo === '1.2.1.03'),
      false,
    )
  })
})

describe('DRE', () => {
  it('monta as linhas só com o movimento do período', () => {
    const d = dre(PLANO_PADRAO, mes, '2026-08-01', '2026-08-31')
    assert.equal(d.receitaBruta, 20000)
    assert.equal(d.deducoes, 1460)
    assert.equal(d.receitaLiquida, 18540)
    assert.equal(d.custos, 0)
    assert.equal(d.lucroBruto, 18540)
    assert.deepEqual(d.despesas, { pessoal: 5600, administrativas: 1500, financeiras: 29.9, tributarias: 0, total: 7129.9 })
    assert.equal(d.resultado, 11410.1)
    assert.equal(d.contas.length, 5)
  })
  it('período sem movimento dá tudo zero', () => {
    assert.equal(dre(PLANO_PADRAO, mes, '2026-01-01', '2026-01-31').resultado, 0)
  })
  it('o resultado da DRE é o mesmo do fechamento do balancete', () => {
    assert.equal(dre(PLANO_PADRAO, mes, '2026-07-01', '2026-08-31').resultado, balancete(PLANO_PADRAO, mes, '2026-07-01', '2026-08-31').fechamento.resultado)
  })
})

describe('sugestão de conta pelo memo', () => {
  it('normaliza tirando acento, datas e números', () => {
    assert.equal(normalizarMemo('PAGTO DAS SIMPLES NACIONAL 20/08 DOC 123456'), 'pagto das simples nacional doc')
    assert.equal(normalizarMemo('Tarifa — Manutenção de Conta'), 'tarifa manutencao de conta')
  })
  it('vale a regra mais específica', () => {
    const regras = [
      { termo: 'pix', conta: '3.2.1.02' },
      { termo: 'pix recebido cliente exemplo', conta: '3.1.1.01' },
      { termo: 'tarifa', conta: '4.2.3.01' },
    ]
    assert.equal(sugerirConta('PIX RECEBIDO CLIENTE EXEMPLO LTDA 05/08', regras), '3.1.1.01')
    assert.equal(sugerirConta('PIX ENVIADO FULANO', regras), '3.2.1.02')
    assert.equal(sugerirConta('TED 123', regras), undefined)
  })
})
