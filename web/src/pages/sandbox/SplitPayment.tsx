import { useState, type ComponentProps } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { ArrowRight, FlaskConical, Landmark, Store } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, Input, Select } from '../../components/ui'
import { formatBRL } from '../../lib/utils'
import { numero } from '../../lib/escritorio'

interface Parcela {
  numero: number
  valor: number
  segregadoIbs: number
  segregadoCbs: number
  liquidoAoFornecedor: number
}

interface Resultado {
  procedimentoAplicado: 'padrao' | 'simplificado' | 'sem_split'
  motivos: string[]
  parcelas: Parcela[]
  totalSegregadoIbs: number
  totalSegregadoCbs: number
  totalLiquidoAoFornecedor: number
  devolucaoAoFornecedor: { ibs: number; cbs: number; prazo: string } | null
  saldoARecolherPeloFornecedor: { ibs: number; cbs: number }
  creditoParaOAdquirente: 'sim' | 'nao' | 'nao_se_aplica'
  base: string[]
}

interface Resposta {
  entrada: { valorOperacao: number; debitoIbs: number; debitoCbs: number }
  resultado: Resultado
}

const valorOpcional = z.string().refine((v) => !v.trim() || numero(v) >= 0, 'Valor inválido')

const esquema = z
  .object({
    valorOperacao: z.string().refine((v) => numero(v) > 0, 'Informe o valor'),
    aliquotaIbs: valorOpcional,
    aliquotaCbs: valorOpcional,
    extintoIbs: valorOpcional,
    extintoCbs: valorOpcional,
    procedimento: z.enum(['padrao', 'simplificado']),
    tributosInformados: z.boolean(),
    consultaDisponivel: z.boolean(),
    percentualSimplificadoIbs: valorOpcional,
    percentualSimplificadoCbs: valorOpcional,
    parcelas: z.string().refine((v) => Number(v) >= 1 && Number(v) <= 60, 'De 1 a 60'),
    instrumento: z.enum(['pix', 'boleto', 'cartao', 'ted', 'dinheiro']),
    adquirenteContribuinte: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const simplificado = v.procedimento === 'simplificado' || !v.tributosInformados
    if (simplificado && v.instrumento !== 'dinheiro') {
      if (!v.percentualSimplificadoIbs.trim()) ctx.addIssue({ code: 'custom', path: ['percentualSimplificadoIbs'], message: 'Informe a hipótese' })
      if (!v.percentualSimplificadoCbs.trim()) ctx.addIssue({ code: 'custom', path: ['percentualSimplificadoCbs'], message: 'Informe a hipótese' })
    }
  })
type Form = z.infer<typeof esquema>

const PROCEDIMENTOS = { padrao: 'Padrão (art. 32)', simplificado: 'Simplificado (art. 33)', sem_split: 'Sem split payment' } as const
const opcional = (v: string) => (v.trim() ? numero(v) : undefined)

const Marcador = ({ rotulo, dica, ...props }: { rotulo: string; dica: string } & ComponentProps<'input'>) => (
  <label className="flex items-start gap-2 text-sm text-slate-700">
    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...props} />
    <span>
      {rotulo}
      <span className="block text-xs text-slate-500">{dica}</span>
    </span>
  </label>
)

/**
 * Sandbox do split payment: simula, com números, como o IBS e a CBS são separados do pagamento
 * na liquidação financeira. Não fala com a Plataforma Pública, não grava nada.
 */
export function SplitPayment() {
  const [resposta, setResposta] = useState<Resposta | null>(null)
  const [simulando, setSimulando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const form = useForm<Form>({
    resolver: zodResolver(esquema),
    defaultValues: {
      valorOperacao: '10.000,00',
      aliquotaIbs: '0,1',
      aliquotaCbs: '0,9',
      extintoIbs: '',
      extintoCbs: '',
      procedimento: 'padrao',
      tributosInformados: true,
      consultaDisponivel: true,
      percentualSimplificadoIbs: '',
      percentualSimplificadoCbs: '',
      parcelas: '1',
      instrumento: 'pix',
      adquirenteContribuinte: false,
    },
  })
  const erros = form.formState.errors
  const [procedimento, tributosInformados, instrumento] = form.watch(['procedimento', 'tributosInformados', 'instrumento'])
  const pedePercentual = (procedimento === 'simplificado' || !tributosInformados) && instrumento !== 'dinheiro'

  async function simular(v: Form) {
    setSimulando(true)
    setErro(null)
    try {
      const r = await httpsCallable<unknown, Resposta>(functions, 'simularSplitPayment')({
        valorOperacao: numero(v.valorOperacao),
        aliquotaIbs: opcional(v.aliquotaIbs),
        aliquotaCbs: opcional(v.aliquotaCbs),
        extintoIbs: opcional(v.extintoIbs),
        extintoCbs: opcional(v.extintoCbs),
        procedimento: v.procedimento,
        tributosInformados: v.tributosInformados,
        consultaDisponivel: v.consultaDisponivel,
        percentualSimplificadoIbs: opcional(v.percentualSimplificadoIbs),
        percentualSimplificadoCbs: opcional(v.percentualSimplificadoCbs),
        parcelas: Number(v.parcelas),
        instrumento: v.instrumento,
        adquirenteContribuinte: v.adquirenteContribuinte,
      })
      setResposta(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível simular.')
      setResposta(null)
    } finally {
      setSimulando(false)
    }
  }

  const r = resposta?.resultado
  const segregado = r ? Math.round((r.totalSegregadoIbs + r.totalSegregadoCbs) * 100) / 100 : 0

  return (
    <>
      <CabecalhoPagina titulo="Sandbox · Split payment" descricao="Simulador do recolhimento do IBS e da CBS na liquidação financeira (LC 214/2025, arts. 31 a 36, com a redação da LC 227/2026)." />

      <div className="mb-6">
        <Alerta tipo="info">
          <strong className="inline-flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4" /> Ambiente de estudo.
          </strong>{' '}
          Nada aqui é gravado, enviado à Receita ou ao Comitê Gestor, nem gera obrigação. A implantação do split payment é gradual, por ato conjunto do CGIBS e da RFB (art. 35, § 2º). A API da Plataforma Pública (Manual de Integração e
          Swagger do Ato Conjunto RFB/CGIBS nº 2/2026) <strong>ainda não está ligada</strong>: é destinada aos prestadores de serviço de pagamento, e a pasta oficial dos arquivos estava fora do ar quando este sandbox foi escrito.
        </Alerta>
      </div>

      <form onSubmit={form.handleSubmit(simular)}>
        <Card className="mb-4">
          <h2 className="mb-3 text-base font-semibold">A operação</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo label="Valor da operação (R$)" className="sm:col-span-2" erro={erros.valorOperacao?.message} obrigatorio>
              <Input inputMode="decimal" {...form.register('valorOperacao')} />
            </Campo>
            <Campo label="Alíquota do IBS (%)" className="sm:col-span-2" erro={erros.aliquotaIbs?.message} dica="Teste de 2026: 0,1% (art. 343)">
              <Input inputMode="decimal" {...form.register('aliquotaIbs')} />
            </Campo>
            <Campo label="Alíquota da CBS (%)" className="sm:col-span-2" erro={erros.aliquotaCbs?.message} dica="Teste de 2026: 0,9% (art. 346)">
              <Input inputMode="decimal" {...form.register('aliquotaCbs')} />
            </Campo>
            <Campo label="IBS já extinto (R$)" className="sm:col-span-2" erro={erros.extintoIbs?.message} dica="Crédito compensado ou pagamento (art. 27)">
              <Input inputMode="decimal" placeholder="0,00" {...form.register('extintoIbs')} />
            </Campo>
            <Campo label="CBS já extinta (R$)" className="sm:col-span-2" erro={erros.extintoCbs?.message}>
              <Input inputMode="decimal" placeholder="0,00" {...form.register('extintoCbs')} />
            </Campo>
            <Campo label="Parcelas (pelo fornecedor)" className="sm:col-span-2" erro={erros.parcelas?.message} dica="Segregação proporcional em cada uma (art. 34, II)">
              <Input inputMode="numeric" {...form.register('parcelas')} />
            </Campo>
          </div>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-3 text-base font-semibold">O pagamento</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo label="Instrumento" className="sm:col-span-3">
              <Select {...form.register('instrumento')}>
                <option value="pix">Pix</option>
                <option value="boleto">Boleto</option>
                <option value="cartao">Cartão</option>
                <option value="ted">TED / transferência</option>
                <option value="dinheiro">Dinheiro (não passa por prestador de pagamento)</option>
              </Select>
            </Campo>
            <Campo label="Procedimento escolhido" className="sm:col-span-3">
              <Select {...form.register('procedimento')}>
                <option value="padrao">Padrão — segrega o débito real (art. 32)</option>
                <option value="simplificado">Simplificado — percentual fixo (art. 33)</option>
              </Select>
            </Campo>
            <div className="grid grid-cols-1 gap-2 sm:col-span-6 sm:grid-cols-3">
              <Marcador rotulo="Tributos informados ao originar o pagamento" dica="Sem isso, cai no simplificado (art. 33, § 2º-A)" {...form.register('tributosInformados')} />
              <Marcador rotulo="Consulta ao sistema do CGIBS/RFB disponível" dica="Sem ela, segrega o débito cheio (art. 32, § 4º)" {...form.register('consultaDisponivel')} />
              <Marcador rotulo="Adquirente é contribuinte do regime regular" dica="Define se há crédito e a opção do art. 36" {...form.register('adquirenteContribuinte')} />
            </div>
            {pedePercentual && (
              <>
                <Campo label="Simplificado: % de IBS" className="sm:col-span-3" erro={erros.percentualSimplificadoIbs?.message} dica="Hipótese sua: o CGIBS ainda vai fixar (art. 33, § 2º)">
                  <Input inputMode="decimal" placeholder="0,05" {...form.register('percentualSimplificadoIbs')} />
                </Campo>
                <Campo label="Simplificado: % de CBS" className="sm:col-span-3" erro={erros.percentualSimplificadoCbs?.message} dica="Hipótese sua: a RFB ainda vai fixar">
                  <Input inputMode="decimal" placeholder="0,50" {...form.register('percentualSimplificadoCbs')} />
                </Campo>
              </>
            )}
          </div>
        </Card>

        <Botao type="submit" carregando={simulando}>
          <FlaskConical className="h-4 w-4" /> Simular
        </Botao>
      </form>

      {erro && (
        <div className="mt-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {r && resposta && (
        <div className="mt-6 space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Resultado</h2>
              <Badge tom={r.procedimentoAplicado === 'sem_split' ? 'amarelo' : 'roxo'}>{PROCEDIMENTOS[r.procedimentoAplicado]}</Badge>
            </div>

            <div className="mt-4 grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">O cliente paga</p>
                <p className="text-xl font-semibold tabular-nums">{formatBRL(resposta.entrada.valorOperacao)}</p>
                <p className="text-xs text-slate-500">
                  débitos no documento: IBS {formatBRL(resposta.entrada.debitoIbs)} · CBS {formatBRL(resposta.entrada.debitoCbs)}
                </p>
              </div>
              <ArrowRight className="hidden h-5 w-5 self-center text-slate-400 md:block" />
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                <p className="flex items-center gap-1.5 text-xs text-violet-800">
                  <Landmark className="h-3.5 w-3.5" /> Segregado na liquidação
                </p>
                <p className="text-xl font-semibold text-violet-900 tabular-nums">{formatBRL(segregado)}</p>
                <p className="text-xs text-violet-800">
                  IBS ao CGIBS: {formatBRL(r.totalSegregadoIbs)} · CBS à RFB: {formatBRL(r.totalSegregadoCbs)}
                </p>
              </div>
              <ArrowRight className="hidden h-5 w-5 self-center text-slate-400 md:block" />
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="flex items-center gap-1.5 text-xs text-emerald-800">
                  <Store className="h-3.5 w-3.5" /> O fornecedor recebe
                </p>
                <p className="text-xl font-semibold text-emerald-900 tabular-nums">{formatBRL(r.totalLiquidoAoFornecedor)}</p>
                {r.devolucaoAoFornecedor && (
                  <p className="text-xs text-emerald-800">
                    + devolução de {formatBRL(r.devolucaoAoFornecedor.ibs + r.devolucaoAoFornecedor.cbs)} em {r.devolucaoAoFornecedor.prazo}
                  </p>
                )}
              </div>
            </div>

            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {r.motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
              {(r.saldoARecolherPeloFornecedor.ibs > 0 || r.saldoARecolherPeloFornecedor.cbs > 0) && (
                <li className="font-medium text-amber-800">
                  O split não cobriu tudo: o fornecedor ainda recolhe IBS {formatBRL(r.saldoARecolherPeloFornecedor.ibs)} e CBS {formatBRL(r.saldoARecolherPeloFornecedor.cbs)} no vencimento (art. 34, IV).
                </li>
              )}
              {r.creditoParaOAdquirente === 'sim' && <li>O adquirente contribuinte se credita à medida que o débito é extinto (art. 47).</li>}
              {r.creditoParaOAdquirente === 'nao' && <li className="font-medium text-amber-800">No simplificado, o valor segregado não gera crédito para o adquirente contribuinte (art. 33, § 7º, II).</li>}
            </ul>
          </Card>

          {r.parcelas.length > 1 && (
            <Card className="p-0">
              <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Parcela a parcela</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Parcela</th>
                      <th className="px-4 py-2 text-right font-medium">Valor pago</th>
                      <th className="px-4 py-2 text-right font-medium">IBS segregado</th>
                      <th className="px-4 py-2 text-right font-medium">CBS segregada</th>
                      <th className="px-4 py-2 text-right font-medium">Ao fornecedor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.parcelas.map((p) => (
                      <tr key={p.numero}>
                        <td className="px-4 py-1.5">
                          {p.numero}/{r.parcelas.length}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(p.valor)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(p.segregadoIbs)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(p.segregadoCbs)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatBRL(p.liquidoAoFornecedor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 text-base font-semibold">Base legal aplicada</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">
              {r.base.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card className="mt-6">
        <h2 className="mb-2 text-base font-semibold">O que falta para sair do sandbox</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <strong>Manual de Integração e Swagger da Plataforma Pública</strong> (Ato Conjunto RFB/CGIBS nº 2, de 27/05/2026): ficam no Portal Nacional de Tributação de Bens e Serviços (consumo.tributos.gov.br → Manuais) e no site do
            CGIBS (Central de Conteúdo → Documentos Técnicos). Quem integra com a plataforma são os prestadores de serviço de pagamento, não o contribuinte.
          </li>
          <li>
            <strong>Do lado de quem vende</strong>, o que o sistema vai precisar fazer é incluir no documento fiscal os dados que vinculam a operação ao pagamento e destacar o IBS e a CBS (art. 32, §§ 1º e 2º-A) — isso depende das notas
            técnicas da NFS-e e da NF-e.
          </li>
          <li>
            <strong>Os percentuais do procedimento simplificado</strong> ainda serão fixados pelo CGIBS (IBS) e pela RFB (CBS), por setor ou por contribuinte (art. 33, § 2º).
          </li>
          <li>
            <strong>O cronograma</strong> de implantação gradual e as hipóteses em que o split será facultativo virão por ato conjunto (art. 35, § 2º).
          </li>
        </ul>
      </Card>
    </>
  )
}
