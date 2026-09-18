import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ErroOfx, decodificarOfx, lerOfx } from '../ofx'

// OFX 1.x (SGML), no formato que os bancos brasileiros exportam: tags de valor sem fechamento
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260901120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>0341<BRANCHID>1234<ACCTID>567890<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801
<DTEND>20260831
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260805100000[-3:BRT]
<TRNAMT>5000.00
<FITID>20260805001
<CHECKNUM>001
<MEMO>PIX RECEBIDO CLIENTE EXEMPLO LTDA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260820
<TRNAMT>-1114.22
<FITID>20260820002
<MEMO>PAGTO DAS SIMPLES NACIONAL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260831
<TRNAMT>-29,90
<FITID>20260831003
<NAME>TARIFA
<MEMO>TAR PACOTE SERVICOS &amp; MANUTENCAO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3855.88<DTASOF>20260831</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>260</BANKID><ACCTID>1234567-8</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260810</DTPOSTED><TRNAMT>1200.50</TRNAMT><FITID>abc-1</FITID><MEMO>Transferência recebida - João</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260811</DTPOSTED><TRNAMT>-89.90</TRNAMT><FITID>abc-2</FITID><MEMO>Compra no débito</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1110.60</BALAMT><DTASOF>20260831</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('OFX 1.x (SGML)', () => {
  const e = lerOfx(SGML)
  it('lê banco, conta, período e saldo', () => {
    assert.equal(e.banco, '0341')
    assert.equal(e.agencia, '1234')
    assert.equal(e.conta, '567890')
    assert.equal(e.de, '2026-08-01')
    assert.equal(e.ate, '2026-08-31')
    assert.equal(e.saldoFinal, 3855.88)
    assert.equal(e.saldoEm, '2026-08-31')
  })
  it('lê as transações com sinal, data sem fuso e memo', () => {
    assert.equal(e.transacoes.length, 3)
    assert.deepEqual(e.transacoes[0], { fitid: '20260805001', tipo: 'CREDIT', data: '2026-08-05', valor: 5000, memo: 'PIX RECEBIDO CLIENTE EXEMPLO LTDA', documento: '001' })
    assert.equal(e.transacoes[1].valor, -1114.22)
  })
  it('aceita vírgula decimal, junta NAME e MEMO e desfaz entidades', () => {
    assert.equal(e.transacoes[2].valor, -29.9)
    assert.equal(e.transacoes[2].memo, 'TARIFA — TAR PACOTE SERVICOS & MANUTENCAO')
  })
  it('o saldo confere com a soma das transações quando o saldo inicial é zero', () => {
    assert.equal(Math.round(e.transacoes.reduce((s, t) => s + t.valor, 0) * 100) / 100, 3855.88)
  })
})

describe('OFX 2.x (XML)', () => {
  it('lê do mesmo jeito', () => {
    const e = lerOfx(XML)
    assert.equal(e.banco, '260')
    assert.equal(e.conta, '1234567-8')
    assert.equal(e.transacoes.length, 2)
    assert.equal(e.transacoes[0].memo, 'Transferência recebida - João')
    assert.equal(e.transacoes[1].valor, -89.9)
    assert.equal(e.saldoFinal, 1110.6)
  })
})

describe('arquivo e codificação', () => {
  it('recusa o que não é OFX', () => {
    assert.throws(() => lerOfx('data;historico;valor'), ErroOfx)
  })
  it('Windows-1252 sem declarar UTF-8 é lido com os acentos certos', () => {
    const bytes = Buffer.from('OFXHEADER:100 CHARSET:1252 <OFX><STMTTRN><DTPOSTED>20260801<TRNAMT>1<FITID>1<MEMO>Pagamento de salário</STMTTRN></OFX>', 'latin1')
    assert.equal(lerOfx(decodificarOfx(bytes)).transacoes[0].memo, 'Pagamento de salário')
  })
  it('UTF-8 continua UTF-8', () => {
    const bytes = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><OFX><STMTTRN><DTPOSTED>20260801</DTPOSTED><TRNAMT>1</TRNAMT><FITID>1</FITID><MEMO>Pró-labore</MEMO></STMTTRN></OFX>', 'utf8')
    assert.equal(lerOfx(decodificarOfx(bytes)).transacoes[0].memo, 'Pró-labore')
  })
  it('transação sem data ou sem valor é descartada, sem quebrar', () => {
    assert.equal(lerOfx('<OFX><STMTTRN><TRNAMT>10<FITID>1</STMTTRN><STMTTRN><DTPOSTED>20260801<FITID>2</STMTTRN></OFX>').transacoes.length, 0)
  })
})
