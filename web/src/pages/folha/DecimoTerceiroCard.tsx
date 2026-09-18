import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Gift } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { Alerta, Botao, Campo, Card, Input, Select } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { numero } from '../../lib/escritorio'

interface Resultado {
  avos: number
  bruto: number
  primeiraParcela: { mes: number; avos: number; valor: number; fgts: number }
  segundaParcela: { adiantamentoAbatido: number; inss: number; irrf: { valor: number; metodo: string; reducao: number }; liquido: number; fgts: number }
  avisos: string[]
}

interface Linha {
  funcionarioId: string
  nome: string
  cargo: string
  salario: number
  resultado?: Resultado
  erro?: string
}

const MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** 13º salário dos empregados: avos, 1ª parcela, INSS e IRRF sobre o total, líquido da 2ª e FGTS. */
export function DecimoTerceiroCard() {
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [mes, setMes] = useState('11')
  const [ajustes, setAjustes] = useState<Record<string, { variaveis?: string; semDireito?: string }>>({})
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function calcular() {
    setCalculando(true)
    setErro(null)
    try {
      const enviados = Object.fromEntries(
        Object.entries(ajustes).map(([id, a]) => [id, { variaveisAteNovembro: a.variaveis ? numero(a.variaveis) : undefined, mesesSemDireito: a.semDireito ? Number(a.semDireito) : undefined }]),
      )
      const r = await httpsCallable<unknown, { linhas: Linha[] }>(functions, 'decimoTerceiroDoAno')({ ano: Number(ano), mesDoAdiantamento: Number(mes), ajustes: enviados })
      setLinhas(r.data.linhas)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível calcular.')
    } finally {
      setCalculando(false)
    }
  }

  const ajustar = (id: string, campo: 'variaveis' | 'semDireito', valor: string) => setAjustes((a) => ({ ...a, [id]: { ...a[id], [campo]: valor } }))
  const soma = (f: (r: Resultado) => number) => (linhas ?? []).reduce((s, l) => s + (l.resultado ? f(l.resultado) : 0), 0)

  return (
    <Card className="mt-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Gift className="h-4 w-4" /> 13º salário
      </h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        1/12 da remuneração de dezembro por mês com 15 dias ou mais de serviço. A 1ª parcela sai sem descontos; INSS e IRRF incidem sobre o valor total, só na 2ª, separados do salário do mês (Decreto 10.854/2021, arts. 76 a 82). Sócio
        com pró-labore não tem 13º.
      </p>

      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-6">
        <Campo label="Ano" className="sm:col-span-1">
          <Input inputMode="numeric" value={ano} onChange={(e) => setAno(e.target.value)} />
        </Campo>
        <Campo label="1ª parcela paga em" className="sm:col-span-2">
          <Select value={mes} onChange={(e) => setMes(e.target.value)}>
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => (
              <option key={m} value={m}>
                {MESES[m]}
              </option>
            ))}
          </Select>
        </Campo>
        <div className="sm:col-span-3">
          <Botao carregando={calculando} onClick={() => void calcular()}>
            Calcular o 13º
          </Botao>
        </div>
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {linhas && linhas.length === 0 && <p className="mt-4 text-sm text-slate-500">Nenhum empregado ativo com direito a 13º neste ano.</p>}

      {linhas && linhas.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Empregado</th>
                <th className="px-2 py-2 font-medium">Variáveis até nov.</th>
                <th className="px-2 py-2 font-medium">Meses s/ direito</th>
                <th className="px-2 py-2 text-right font-medium">Avos</th>
                <th className="px-2 py-2 text-right font-medium">13º bruto</th>
                <th className="px-2 py-2 text-right font-medium">1ª parcela</th>
                <th className="px-2 py-2 text-right font-medium">INSS</th>
                <th className="px-2 py-2 text-right font-medium">IRRF</th>
                <th className="px-2 py-2 text-right font-medium">Líquido da 2ª</th>
                <th className="py-2 pl-2 text-right font-medium">FGTS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map((l) => (
                <tr key={l.funcionarioId} className="align-top">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-slate-900">{l.nome}</p>
                    <p className="text-xs text-slate-500">
                      {l.cargo} · {formatBRL(l.salario)}
                    </p>
                    {l.erro && <p className="text-xs text-red-700">{l.erro}</p>}
                    {l.resultado?.avisos.map((a) => (
                      <p key={a} className="text-xs text-amber-700">
                        {a}
                      </p>
                    ))}
                  </td>
                  <td className="px-2 py-2">
                    <Input className="h-8 w-28 text-right" inputMode="decimal" placeholder="0,00" value={ajustes[l.funcionarioId]?.variaveis ?? ''} onChange={(e) => ajustar(l.funcionarioId, 'variaveis', e.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <Input className="h-8 w-16 text-right" inputMode="numeric" placeholder="0" value={ajustes[l.funcionarioId]?.semDireito ?? ''} onChange={(e) => ajustar(l.funcionarioId, 'semDireito', e.target.value)} />
                  </td>
                  {l.resultado ? (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums">{l.resultado.avos}/12</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatBRL(l.resultado.bruto)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatBRL(l.resultado.primeiraParcela.valor)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatBRL(l.resultado.segundaParcela.inss)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatBRL(l.resultado.segundaParcela.irrf.valor)}</td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">{formatBRL(l.resultado.segundaParcela.liquido)}</td>
                      <td className="py-2 pl-2 text-right tabular-nums">{formatBRL(l.resultado.primeiraParcela.fgts + l.resultado.segundaParcela.fgts)}</td>
                    </>
                  ) : (
                    <td colSpan={7} />
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-2 pr-3" colSpan={4}>
                  Total
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatBRL(soma((r) => r.bruto))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatBRL(soma((r) => r.primeiraParcela.valor))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatBRL(soma((r) => r.segundaParcela.inss))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatBRL(soma((r) => r.segundaParcela.irrf.valor))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatBRL(soma((r) => r.segundaParcela.liquido))}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{formatBRL(soma((r) => r.primeiraParcela.fgts + r.segundaParcela.fgts))}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Informe os variáveis (horas extras, comissões) devidos de janeiro a novembro e recalcule. O desconto simplificado e a redução da Lei 15.270/2025 entram no IRRF quando mais favoráveis ao empregado (Perguntas e Respostas IRPF
            2026, pergunta 332; Lei 9.250/1995, art. 3º-A, § 3º). Não cobre 13º de rescisão, afastamento pelo INSS nem o ajuste de janeiro dos variáveis.
          </p>
        </div>
      )}
    </Card>
  )
}
