import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { ArrowLeft, FilePlus2, Send, ShieldAlert } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { functions } from '../../lib/firebase'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, Input, Select, Spinner, Textarea } from '../../components/ui'
import { confirmar } from '../../components/Dialogo'
import { formatBRL, formatCpfCnpj, somenteDigitos, validarCnpj, validarCpf } from '../../lib/utils'
import { formatarChave } from '../../lib/fiscal'

interface Regime {
  opSimpNac: string
  regApTribSN?: string
  regEspTrib: string
}

interface Base {
  prestador: { cnpj?: string; cpf?: string; inscricaoMunicipal?: string; regime: Regime }
  codigoMunicipioEmissao: string
  origemRegime: 'ultima_nota' | 'perfil_fiscal'
  ultimaTributacao?: { pTotTribSN?: string; tpRetISSQN?: string; pAliq?: string }
  servicosAnteriores: Array<{ cTribNac: string; cTribMun?: string; cNBS?: string; descricao: string; vezes: number }>
  tomadoresAnteriores: Array<{ documento: string; nome: string; vezes: number }>
  numeracao: { serie: string; proximoNumero: number }
}

interface Resultado {
  chaveAcesso: string
  numero?: string
  ambiente: string
  alertas: Array<{ codigo: string; descricao: string }>
}

const SIMPLES: Record<string, string> = { '1': 'Não optante do Simples', '2': 'MEI', '3': 'ME/EPP no Simples Nacional' }
const APURACAO: Record<string, string> = {
  '1': 'Tributos federais e ISSQN pelo Simples',
  '2': 'Federais pelo Simples, ISSQN por fora (legislação municipal)',
  '3': 'Federais e ISSQN por fora do Simples',
}

const hoje = new Date().toLocaleDateString('en-CA')
const numero = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'))
const decimal = (v: string) => numero(v).toFixed(2)
const percentual = z.string().refine((v) => !v.trim() || (numero(v) >= 0 && numero(v) <= 100), 'De 0 a 100')

const esquema = z
  .object({
    tipoTomador: z.enum(['cnpj', 'cpf', 'nenhum']),
    documentoTomador: z.string(),
    nomeTomador: z.string().trim().max(300),
    emailTomador: z.string().trim().email('E-mail inválido').or(z.literal('')),
    cTribNac: z.string().refine((v) => /^\d{6}$/.test(somenteDigitos(v)), '6 dígitos: item, subitem e desdobro (ex.: 01.03.01)'),
    cTribMun: z.string().trim().max(3),
    cNBS: z.string().refine((v) => !v.trim() || /^\d{9}$/.test(somenteDigitos(v)), 'NBS tem 9 dígitos'),
    descricao: z.string().trim().min(1, 'Descreva o serviço').max(2000, 'No máximo 2000 caracteres'),
    municipioPrestacao: z.string().refine((v) => /^\d{7}$/.test(somenteDigitos(v)), 'Código IBGE de 7 dígitos'),
    competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de competência'),
    valor: z.string().refine((v) => numero(v) > 0, 'O valor precisa ser maior que zero'),
    regApTribSN: z.string(),
    tpRetISSQN: z.enum(['1', '2']),
    pAliq: percentual,
    pTotTribSN: percentual,
    pTotFed: percentual,
    pTotEst: percentual,
    pTotMun: percentual,
    ambiente: z.enum(['homologacao', 'producao']),
    confirmacao: z.string(),
  })
  .superRefine((d, ctx) => {
    const doc = somenteDigitos(d.documentoTomador)
    if (d.tipoTomador === 'cnpj' && !validarCnpj(doc)) ctx.addIssue({ code: 'custom', path: ['documentoTomador'], message: 'CNPJ inválido' })
    if (d.tipoTomador === 'cpf' && !validarCpf(doc)) ctx.addIssue({ code: 'custom', path: ['documentoTomador'], message: 'CPF inválido' })
    if (d.tipoTomador !== 'nenhum' && d.nomeTomador.length < 2) ctx.addIssue({ code: 'custom', path: ['nomeTomador'], message: 'Informe o nome do tomador' })
    if (d.ambiente === 'producao' && d.confirmacao !== 'PRODUCAO') ctx.addIssue({ code: 'custom', path: ['confirmacao'], message: 'Digite PRODUCAO para emitir com validade fiscal' })
  })
type Form = z.infer<typeof esquema>

/**
 * Emissão de NFS-e sem nota-modelo. Prestador, município emissor e situação no Simples vêm do
 * backend (certificado, cadastro, última nota ou perfil fiscal); tomador, serviço e valores vêm
 * daqui. Numeração, data/hora e assinatura continuam sendo do servidor.
 */
export function NovaNotaServico() {
  const { membro } = useAuth()
  const [base, setBase] = useState<Base | null>(null)
  const [erroBase, setErroBase] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const form = useForm<Form>({
    resolver: zodResolver(esquema),
    defaultValues: {
      tipoTomador: 'cnpj',
      documentoTomador: '',
      nomeTomador: '',
      emailTomador: '',
      cTribNac: '',
      cTribMun: '',
      cNBS: '',
      descricao: '',
      municipioPrestacao: '',
      competencia: hoje,
      valor: '',
      regApTribSN: '1',
      tpRetISSQN: '1',
      pAliq: '',
      pTotTribSN: '',
      pTotFed: '',
      pTotEst: '',
      pTotMun: '',
      ambiente: 'homologacao',
      confirmacao: '',
    },
  })
  const { register, handleSubmit, setValue, watch, formState } = form
  const erros = formState.errors
  const [tipoTomador, ambiente, tpRetISSQN, regApTribSN, cTribNac] = watch(['tipoTomador', 'ambiente', 'tpRetISSQN', 'regApTribSN', 'cTribNac'])

  useEffect(() => {
    httpsCallable<unknown, Base>(functions, 'baseNotaNovaNfse')({})
      .then((r) => {
        const b = r.data
        setBase(b)
        setValue('municipioPrestacao', b.codigoMunicipioEmissao)
        if (b.prestador.regime.regApTribSN) setValue('regApTribSN', b.prestador.regime.regApTribSN)
        if (b.ultimaTributacao?.pTotTribSN) setValue('pTotTribSN', Number(b.ultimaTributacao.pTotTribSN).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
        const servico = b.servicosAnteriores[0]
        if (servico) {
          setValue('cTribNac', servico.cTribNac)
          if (servico.cTribMun) setValue('cTribMun', servico.cTribMun)
          if (servico.cNBS) setValue('cNBS', servico.cNBS)
        }
      })
      .catch((e: unknown) => setErroBase(e instanceof Error ? e.message : 'Não foi possível preparar a emissão.'))
  }, [setValue])

  const regime = base?.prestador.regime
  const meEpp = regime?.opSimpNac === '3'
  const mei = regime?.opSimpNac === '2'
  const naoOptante = regime?.opSimpNac === '1'
  // Anexo I: ME/EPP pelo Simples sem retenção não informa alíquota (E0625); retido ou ISSQN fora do Simples, informa
  const pedeAliquota = !meEpp || tpRetISSQN !== '1' || regApTribSN !== '1'

  function usarServico(codigo: string) {
    const s = base?.servicosAnteriores.find((x) => x.cTribNac === codigo)
    if (!s) return
    setValue('cTribNac', s.cTribNac, { shouldValidate: true })
    setValue('cTribMun', s.cTribMun ?? '')
    setValue('cNBS', s.cNBS ?? '')
    if (!form.getValues('descricao')) setValue('descricao', s.descricao)
  }

  function usarTomador(documento: string) {
    const t = base?.tomadoresAnteriores.find((x) => x.documento === documento)
    if (!t) return
    setValue('tipoTomador', t.documento.length === 11 ? 'cpf' : 'cnpj')
    setValue('documentoTomador', formatCpfCnpj(t.documento), { shouldValidate: true })
    setValue('nomeTomador', t.nome, { shouldValidate: true })
  }

  function montarDados(f: Form) {
    if (!base || !regime) return null
    const doc = somenteDigitos(f.documentoTomador)
    const totTrib = meEpp
      ? { pTotTribSN: decimal(f.pTotTribSN || '0') }
      : mei
        ? { indTotTrib: '0' as const }
        : { pTotTrib: { fed: decimal(f.pTotFed || '0'), est: decimal(f.pTotEst || '0'), mun: decimal(f.pTotMun || '0') } }
    return {
      ambiente: f.ambiente,
      dhEmi: '',
      serie: '',
      numero: '',
      competencia: f.competencia,
      tpEmit: '1',
      codigoMunicipioEmissao: base.codigoMunicipioEmissao,
      prestador: { ...base.prestador, regime: meEpp ? { ...regime, regApTribSN: f.regApTribSN } : regime },
      ...(f.tipoTomador === 'nenhum'
        ? {}
        : { tomador: { ...(f.tipoTomador === 'cnpj' ? { cnpj: doc } : { cpf: doc }), nome: f.nomeTomador.trim(), ...(f.emailTomador ? { email: f.emailTomador } : {}) } }),
      servico: {
        codigoMunicipioPrestacao: somenteDigitos(f.municipioPrestacao),
        cTribNac: somenteDigitos(f.cTribNac),
        ...(f.cTribMun.trim() ? { cTribMun: f.cTribMun.trim() } : {}),
        descricao: f.descricao.trim(),
        ...(f.cNBS.trim() ? { cNBS: somenteDigitos(f.cNBS) } : {}),
      },
      valores: {
        vServ: decimal(f.valor),
        tribMun: { tribISSQN: '1', tpRetISSQN: f.tpRetISSQN, ...(pedeAliquota && f.pAliq.trim() ? { pAliq: decimal(f.pAliq) } : {}) },
        totTrib,
      },
    }
  }

  async function emitir(f: Form) {
    const dados = montarDados(f)
    if (!dados) return
    setErro(null)
    const producao = f.ambiente === 'producao'
    const ok = await confirmar(
      producao
        ? `Emitir NFS-e em PRODUÇÃO de ${formatBRL(numero(f.valor))}${f.tipoTomador !== 'nenhum' ? ` para ${f.nomeTomador}` : ''}? Ela terá validade fiscal e só sai por cancelamento.`
        : `Emitir em produção restrita (teste, sem validade jurídica) no valor de ${formatBRL(numero(f.valor))}?`,
      { titulo: producao ? 'Emissão com validade fiscal' : 'Emissão de teste', textoConfirmar: 'Assinar e enviar', perigo: producao },
    )
    if (!ok) return
    setEnviando(true)
    try {
      const r = await httpsCallable<unknown, Resultado>(functions, 'emitirNfse')({ dados, ambiente: f.ambiente, confirmacao: f.confirmacao })
      setResultado(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A emissão falhou.')
    } finally {
      setEnviando(false)
    }
  }

  if (membro?.papel !== 'admin') {
    return (
      <>
        <CabecalhoPagina titulo="Nova NFS-e" />
        <Alerta tipo="erro">Somente administradores emitem notas.</Alerta>
      </>
    )
  }

  if (resultado) {
    return (
      <>
        <CabecalhoPagina titulo="NFS-e emitida" descricao={resultado.ambiente === 'producao' ? 'Documento com validade fiscal.' : 'Nota de teste em produção restrita — sem validade jurídica.'} />
        <Card>
          <div className="flex items-center gap-2">
            <Badge tom={resultado.ambiente === 'producao' ? 'verde' : 'amarelo'}>{resultado.ambiente === 'producao' ? 'Produção' : 'Produção restrita'}</Badge>
            <span className="text-lg font-semibold">NFS-e nº {resultado.numero ?? '—'}</span>
          </div>
          <p className="mt-2 font-mono text-xs break-all text-slate-500">{formatarChave(resultado.chaveAcesso)}</p>
          {resultado.alertas.length > 0 && (
            <div className="mt-3">
              <Alerta tipo="info">{resultado.alertas.map((a) => `${a.codigo} — ${a.descricao}`).join(' · ')}</Alerta>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/notas-servico">
              <Botao tamanho="sm">Ver na lista e baixar o PDF</Botao>
            </Link>
            <Botao tamanho="sm" variante="secundario" onClick={() => setResultado(null)}>
              <FilePlus2 className="h-3.5 w-3.5" /> Emitir outra
            </Botao>
          </div>
        </Card>
      </>
    )
  }

  return (
    <>
      <CabecalhoPagina titulo="Nova NFS-e" descricao="Nota de serviço do zero, sem precisar de uma nota anterior como modelo." />
      <div className="mb-3">
        <Link to="/notas-servico" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para as notas
        </Link>
      </div>

      {erroBase && <Alerta tipo="erro">{erroBase}</Alerta>}
      {!base && !erroBase && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {base && regime && (
        <form onSubmit={handleSubmit(emitir)} className="space-y-4">
          <Card>
            <h2 className="mb-2 text-base font-semibold">Prestador</h2>
            <p className="text-sm text-slate-700">
              {formatCpfCnpj(base.prestador.cnpj ?? base.prestador.cpf ?? '')} · {SIMPLES[regime.opSimpNac] ?? regime.opSimpNac}
              {base.prestador.inscricaoMunicipal ? ` · IM ${base.prestador.inscricaoMunicipal}` : ''} · município IBGE {base.codigoMunicipioEmissao} · DPS série {base.numeracao.serie} nº{' '}
              {base.numeracao.proximoNumero}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {base.origemRegime === 'ultima_nota'
                ? 'Situação no Simples e inscrição municipal copiadas da última nota emitida pela empresa.'
                : 'Sem nota anterior: a situação no Simples veio do perfil fiscal. Se o SEFIN recusar (regra E0160), o cadastro do Simples diz outra coisa — confira o perfil.'}
            </p>
            {meEpp && (
              <div className="mt-3 max-w-xl">
                <Campo label="Regime de apuração no Simples" dica="Só muda se a empresa ultrapassou sublimite ou limite do Simples">
                  <Select {...register('regApTribSN')}>
                    {Object.entries(APURACAO).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold">Tomador (quem contratou o serviço)</h2>
            {base.tomadoresAnteriores.length > 0 && (
              <div className="mb-3 max-w-xl">
                <Campo label="Usar um tomador de nota anterior">
                  <Select defaultValue="" onChange={(e) => usarTomador(e.target.value)}>
                    <option value="">Escolha…</option>
                    {base.tomadoresAnteriores.map((t) => (
                      <option key={t.documento} value={t.documento}>
                        {t.nome} · {formatCpfCnpj(t.documento)}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Campo label="Identificação" className="sm:col-span-2">
                <Select {...register('tipoTomador')}>
                  <option value="cnpj">CNPJ</option>
                  <option value="cpf">CPF</option>
                  <option value="nenhum">Sem tomador identificado</option>
                </Select>
              </Campo>
              {tipoTomador !== 'nenhum' && (
                <>
                  <Campo label={tipoTomador === 'cnpj' ? 'CNPJ' : 'CPF'} className="sm:col-span-2" erro={erros.documentoTomador?.message} obrigatorio>
                    <Input inputMode="numeric" {...register('documentoTomador')} onChange={(e) => setValue('documentoTomador', formatCpfCnpj(e.target.value), { shouldValidate: formState.isSubmitted })} />
                  </Campo>
                  <Campo label="E-mail" className="sm:col-span-2" erro={erros.emailTomador?.message} dica="Opcional">
                    <Input type="email" {...register('emailTomador')} />
                  </Campo>
                  <Campo label="Nome ou razão social" className="sm:col-span-6" erro={erros.nomeTomador?.message} obrigatorio>
                    <Input {...register('nomeTomador')} />
                  </Campo>
                </>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold">Serviço</h2>
            {base.servicosAnteriores.length > 0 && (
              <div className="mb-3 max-w-xl">
                <Campo label="Usar um serviço de nota anterior">
                  <Select value={base.servicosAnteriores.some((s) => s.cTribNac === somenteDigitos(cTribNac)) ? somenteDigitos(cTribNac) : ''} onChange={(e) => usarServico(e.target.value)}>
                    <option value="">Escolha…</option>
                    {base.servicosAnteriores.map((s) => (
                      <option key={s.cTribNac} value={s.cTribNac}>
                        {s.cTribNac.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3')} · {s.descricao.slice(0, 70) || 'sem descrição'} ({s.vezes}×)
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Campo label="Código de tributação nacional" className="sm:col-span-2" erro={erros.cTribNac?.message} dica="Item e subitem da LC 116 + desdobro" obrigatorio>
                <Input inputMode="numeric" placeholder="010301" {...register('cTribNac')} />
              </Campo>
              <Campo label="Código municipal" className="sm:col-span-1" erro={erros.cTribMun?.message} dica="Se o município usar">
                <Input {...register('cTribMun')} />
              </Campo>
              <Campo label="Código NBS" className="sm:col-span-1" erro={erros.cNBS?.message} dica="Opcional, 9 dígitos">
                <Input inputMode="numeric" {...register('cNBS')} />
              </Campo>
              <Campo label="Município da prestação (IBGE)" className="sm:col-span-2" erro={erros.municipioPrestacao?.message} dica="Padrão: o da empresa">
                <Input inputMode="numeric" {...register('municipioPrestacao')} />
              </Campo>
              <Campo label="Descrição do serviço" className="sm:col-span-6" erro={erros.descricao?.message} obrigatorio>
                <Textarea rows={3} {...register('descricao')} />
              </Campo>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold">Valores e tributos</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Campo label="Competência" className="sm:col-span-2" erro={erros.competencia?.message} obrigatorio>
                <Input type="date" {...register('competencia')} />
              </Campo>
              <Campo label="Valor do serviço (R$)" className="sm:col-span-2" erro={erros.valor?.message} obrigatorio>
                <Input inputMode="decimal" placeholder="0,00" {...register('valor')} />
              </Campo>
              <Campo label="ISSQN" className="sm:col-span-2">
                <Select {...register('tpRetISSQN')}>
                  <option value="1">Não retido (a empresa recolhe)</option>
                  <option value="2">Retido pelo tomador</option>
                </Select>
              </Campo>
              {pedeAliquota && (
                <Campo label="Alíquota do ISSQN (%)" className="sm:col-span-2" erro={erros.pAliq?.message} dica={meEpp ? 'A do ISSQN no Simples para a sua faixa' : 'A do município para o serviço'}>
                  <Input inputMode="decimal" placeholder={base.ultimaTributacao?.pAliq ? Number(base.ultimaTributacao.pAliq).toLocaleString('pt-BR') : ''} {...register('pAliq')} />
                </Campo>
              )}
              {meEpp && (
                <Campo label="Tributos aproximados (% do Simples)" className="sm:col-span-2" erro={erros.pTotTribSN?.message} dica="A alíquota efetiva — veja em Simples Nacional">
                  <Input inputMode="decimal" placeholder="6,00" {...register('pTotTribSN')} />
                </Campo>
              )}
              {naoOptante && (
                <>
                  <Campo label="Tributos aproximados federais (%)" className="sm:col-span-2" erro={erros.pTotFed?.message}>
                    <Input inputMode="decimal" {...register('pTotFed')} />
                  </Campo>
                  <Campo label="Estaduais (%)" className="sm:col-span-1" erro={erros.pTotEst?.message}>
                    <Input inputMode="decimal" {...register('pTotEst')} />
                  </Campo>
                  <Campo label="Municipais (%)" className="sm:col-span-1" erro={erros.pTotMun?.message}>
                    <Input inputMode="decimal" {...register('pTotMun')} />
                  </Campo>
                </>
              )}
            </div>
            {mei && <p className="mt-2 text-xs text-slate-500">MEI: a nota sai sem estimativa de tributos, como o leiaute exige para o MEI.</p>}
            {meEpp && !pedeAliquota && <p className="mt-2 text-xs text-slate-500">Sem retenção e com o ISSQN no Simples, a alíquota não vai na nota: o Sistema Nacional a calcula (regra E0625 do leiaute).</p>}
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold">Onde emitir</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Campo label="Ambiente" className="sm:col-span-3">
                <Select {...register('ambiente')}>
                  <option value="homologacao">Produção restrita (teste, sem validade)</option>
                  <option value="producao">Produção (validade fiscal)</option>
                </Select>
              </Campo>
              {ambiente === 'producao' && (
                <Campo label="Confirmação" className="sm:col-span-3" erro={erros.confirmacao?.message} dica="Digite PRODUCAO" obrigatorio>
                  <Input autoComplete="off" {...register('confirmacao')} />
                </Campo>
              )}
            </div>
            {ambiente === 'producao' && (
              <p className="mt-3 flex items-start gap-2 text-sm text-amber-700">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Nota em produção é documento fiscal: gera obrigação tributária e só sai por cancelamento, que tem prazo definido pelo município.
              </p>
            )}
          </Card>

          {erro && <Alerta tipo="erro">{erro}</Alerta>}

          <div className="flex flex-wrap gap-2">
            <Botao type="submit" carregando={enviando} variante={ambiente === 'producao' ? 'perigo' : 'primario'}>
              <Send className="h-4 w-4" /> Assinar e emitir
            </Botao>
            <Link to="/notas-servico">
              <Botao type="button" variante="secundario">
                Cancelar
              </Botao>
            </Link>
          </div>
        </form>
      )}
    </>
  )
}
