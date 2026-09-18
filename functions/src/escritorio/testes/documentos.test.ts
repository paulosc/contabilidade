import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
// só a parte pura: o resto de documentos.ts fala com Firestore e Storage
import { ErroDocumento, nomeSeguro } from '../documentos'

describe('nome de arquivo enviado pelo cliente', () => {
  it('aceita os tipos de documento de escritório e devolve o tipo certo', () => {
    assert.deepEqual(nomeSeguro('Extrato agosto.PDF'), { nome: 'Extrato agosto.PDF', tipo: 'application/pdf' })
    assert.equal(nomeSeguro('extrato.ofx').tipo, 'application/x-ofx')
    assert.equal(nomeSeguro('nota.xml').tipo, 'application/xml')
    assert.equal(nomeSeguro('foto.JPEG').tipo, 'image/jpeg')
  })
  it('descarta o caminho e caracteres que quebram nome de arquivo', () => {
    assert.equal(nomeSeguro('C:\\Users\\fulano\\Desktop\\nota.pdf').nome, 'nota.pdf')
    assert.equal(nomeSeguro('../../etc/passwd.txt').nome, 'passwd.txt')
    assert.equal(nomeSeguro('rel<at>ório:"1"|?.pdf').nome, 'relatório1.pdf')
    assert.equal(nomeSeguro('quebra\nde\tlinha.pdf').nome, 'quebradelinha.pdf')
  })
  it('recusa executável, HTML e arquivo sem extensão', () => {
    for (const n of ['virus.exe', 'pagina.html', 'script.js', 'macro.xlsm', 'semextensao', '', '.pdf.exe']) assert.throws(() => nomeSeguro(n), ErroDocumento, n)
  })
  it('nome longo é cortado preservando a extensão', () => {
    const r = nomeSeguro(`${'a'.repeat(300)}.pdf`)
    assert.equal(r.nome.length, 120)
    assert.ok(r.nome.endsWith('.pdf'))
  })
})
