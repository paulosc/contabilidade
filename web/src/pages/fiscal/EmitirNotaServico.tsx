import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { ArrowLeft, FilePlus2, Send, ShieldAlert } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { functions } from '../../lib/firebase'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, Input, Select, Spinner, Textarea } from '../../components/ui'
import { confirmar } from '../../components/Dialogo'
import { formatBRL, formatCpfCnpj } from '../../lib/utils'
import { MOTIVOS_SUBSTITUICAO, formatarChave } from '../../lib/fiscal'

/**
 * Espelho do modelo `DadosDps` do backend: o que vai no DPS. A tela só mexe no que muda de uma
 * nota para outra (competência, valor, descrição); o resto vem da nota-modelo e é exibido.
 */
interface PessoaDps {
  cnpj?: string
  cpf?: string
  nif?: string
  inscricaoMunicipal?: string
  nome?: string
  endereco?: { codigoMunicipio?: string; cep?: string; logradouro: string; numero: string; complemento?: string; bairro: string }
  fone?: string
  email?: string
}
interface DadosDps {
  ambiente: 'producao' | 'homologacao'
  dhEmi: string
  serie: string
  numero: string
  competencia: string
  tpEmit: string
  codigoMunicipioEmissao: string
  substituicao?: { chaveSubstituida: string; motivo: string; descricao?: string }
  prestador: PessoaDps & { regime: { opSimpNac: string; regApTribSN?: string; regEspTrib: string } }
  tomador?: PessoaDps
  servico: { codigoMunicipioPrestacao?: string; cTribNac: string; cTribMun?: string; descricao: string }
  valores: { vServ: string; tribMun: { tribISSQN: string; tpRetISSQN: string; pAliq?: string }; totTrib: Record<string, unknown> }
}

interface Modelo {
  dados: DadosDps
  gruposIgnorados: string[]
  numeracao: { serie: string; proximoNumero: number }
}

const hoje = new Date().toISOString().slice(0, 10)

const esquema = z
  .object({
    competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de competência'),
    valor: z
      .string()
      .min(1, 'Informe o valor')
      .refine((v) => Number(v.replace(/\./g, '').replace(',', '.')) > 0, 'O valor precisa ser maior que zero'),
    descricao: z.string().trim().min(1, 'Descreva o serviço').max(2000, 'No máximo 2000 caracteres'),
    tomadorNome: z.string().trim().min(1, 'Informe o nome do tomador'),
    ambiente: z.enum(['homologacao', 'producao']),
    confirmacao: z.string(),
    motivoSubstituicao: z.string(),
    descricaoSubstituicao: z.string().trim(),
  })
  .refine((d) => d.ambiente !== 'producao' || d.confirmacao === 'PRODUCAO', {
    path: ['confirmacao'],
    message: 'Digite PRODUCAO para confirmar a emissão com validade fiscal',
  })
  .refine((d) => !d.descricaoSubstituicao || (d.descricaoSubstituicao.length >= 15 && d.descricaoSubstituicao.length <= 255), {
    path: ['descricaoSubstituicao'],
    message: 'De 15 a 255 caracteres',
  })
type Form = z.infer<typeof esquema>

const SIMPLES: Record<string, string> = { '1': 'Não optante', '2': 'MEI', '3': 'ME/EPP (Simples Nacional)' }
const ISSQN: Record<string, string> = { '1': 'Operação tributável', '2': 'Imunidade', '3': 'Exportação', '4': 'Não incidência' }
const RETENCAO: Record<string, string> = { '1': 'Não retido', '2': 'Retido pelo tomador', '3': 'Retido pelo intermediário' }

/** "16990.00" → "16.990,00" para o campo; e o caminho de volta. */
const paraCampo = (v: string) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const paraLeiaute = (v: string) => Number(v.replace(/\./g, '').replace(',', '.')).toFixed(2)

/**
 * Emissão de NFS-e a partir de uma nota existente ("gerar igual"), com a opção de substituí-la.
 * Só competência, valor, descrição e nome do tomador são editáveis: todo o resto (regime,
 * código de serviço, endereço, tributação) é o da nota-modelo — e é mostrado para revisão.
 */
export function EmitirNotaServico() {
  const { membro } = useAuth()
  const navegar = useNavigate()
  const [params] = useSearchParams()
  const chaveModelo = params.get('modelo') ?? ''
  const substituir = params.get('substituir') === '1'
  const [modelo, setModelo] = useState<Modelo | null>(null)
  const [erroModelo, setErroModelo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ chaveAcesso: string; numero?: string; ambiente: string; alertas: Array<{ codigo: string; descricao: string }> } | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<Form>({
    resolver: zodResolver(esquema),
    defaultValues: { competencia: hoje, valor: '', descricao: '', tomadorNome: '', ambiente: 'homologacao', confirmacao: '', motivoSubstituicao: '99', descricaoSubstituicao: '' },
  })
  const ambiente = watch('ambiente')

  useEffect(() => {
    if (!chaveModelo) {
      setErroModelo('Escolha uma nota emitida pela empresa na lista e use "Gerar nota igual".')
      return
    }
    let ativo = true
    httpsCallable<unknown, Modelo>(functions, 'modeloEmissaoNfse')({ chaveAcesso: chaveModelo })
      .then((r) => {
        if (!ativo) return
        setModelo(r.data)
        const d = r.data.dados
        reset({
          competencia: substituir ? d.competencia : hoje,
          valor: paraCampo(d.valores.vServ),
          descricao: d.servico.descricao,
          tomadorNome: d.tomador?.nome ?? '',
          ambiente: 'homologacao',
          confirmacao: '',
          motivoSubstituicao: '99',
          descricaoSubstituicao: '',
        })
      })
      .catch((e: Error) => ativo && setErroModelo(e.message))
    return () => {
      ativo = false
    }
  }, [chaveModelo, substituir, reset])

  const dadosParaEnvio = useMemo(() => {
    if (!modelo) return null
    return (f: Form): DadosDps => ({
      ...modelo.dados,
      competencia: f.competencia,
      tomador: modelo.dados.tomador ? { ...modelo.dados.tomador, nome: f.tomadorNome } : undefined,
      servico: { ...modelo.dados.servico, descricao: f.descricao },
      valores: { ...modelo.dados.valores, vServ: paraLeiaute(f.valor) },
      substituicao: substituir
        ? { chaveSubstituida: chaveModelo, motivo: f.motivoSubstituicao, descricao: f.descricaoSubstituicao || undefined }
        : undefined,
    })
  }, [modelo, substituir, chaveModelo])

  async function emitir(f: Form) {
    if (!dadosParaEnvio) return
    setErro(null)
    const producao = f.ambiente === 'producao'
    const ok = await confirmar(
      producao
        ? `Emitir NFS-e em PRODUÇÃO no valor de ${formatBRL(Number(paraLeiaute(f.valor)))}${substituir ? ', substituindo a nota-modelo' : ''}? Ela terá validade fiscal e só sai por cancelamento.`
        : `Emitir em produção restrita (teste, sem validade jurídica) no valor de ${formatBRL(Number(paraLeiaute(f.valor)))}?`,
      { titulo: producao ? 'Emissão com validade fiscal' : 'Emissão de teste', textoConfirmar: 'Assinar e enviar', perigo: producao },
    )
    if (!ok) return
    setEnviando(true)
    try {
      const r = await httpsCallable<unknown, NonNullable<typeof resultado>>(functions, 'emitirNfse')({
        dados: dadosParaEnvio(f),
        ambiente: f.ambiente,
        confirmacao: f.confirmacao,
      })
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
        <CabecalhoPagina titulo="Emitir NFS-e" />
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
              <Botao tamanho="sm">Ver na lista</Botao>
            </Link>
            <Botao tamanho="sm" variante="secundario" onClick={() => navegar(0)}>
              <FilePlus2 className="h-3.5 w-3.5" /> Emitir outra igual
            </Botao>
          </div>
        </Card>
      </>
    )
  }

  const d = modelo?.dados

  return (
    <>
      <CabecalhoPagina
        titulo={substituir ? 'Substituir NFS-e' : 'Emitir NFS-e'}
        descricao={substituir ? 'A nota nova referencia a antiga; o Sistema Nacional cancela a antiga por substituição no mesmo ato.' : 'Gera uma nota igual à escolhida, mudando só o que você ajustar.'}
      />
      <div className="mb-3">
        <Link to="/notas-servico" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para as notas
        </Link>
      </div>

      {erroModelo && <Alerta tipo="erro">{erroModelo}</Alerta>}
      {!modelo && !erroModelo && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {modelo && d && (
        <form onSubmit={handleSubmit(emitir)} className="flex flex-col gap-4">
          {modelo.gruposIgnorados.length > 0 && (
            <Alerta tipo="info">
              A nota-modelo tem grupos que esta emissão não reproduz: {modelo.gruposIgnorados.join(', ')}. A nota nova sairá sem eles.
            </Alerta>
          )}

          <Card>
            <h2 className="mb-3 text-base font-semibold">O que muda</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Campo label="Competência" className="sm:col-span-2" erro={errors.competencia?.message} dica="Data em que o serviço foi prestado" obrigatorio>
                <Input type="date" {...register('competencia')} />
              </Campo>
              <Campo label="Valor do serviço (R$)" className="sm:col-span-2" erro={errors.valor?.message} obrigatorio>
                <Input inputMode="decimal" placeholder="16.990,00" {...register('valor')} />
              </Campo>
              <Campo label="Tomador" className="sm:col-span-2" erro={errors.tomadorNome?.message} dica={d.tomador?.cnpj || d.tomador?.cpf ? formatCpfCnpj(d.tomador.cnpj ?? d.tomador.cpf ?? '') : 'sem tomador'}>
                <Input {...register('tomadorNome')} disabled={!d.tomador} />
              </Campo>
              <Campo label="Descrição do serviço" className="sm:col-span-6" erro={errors.descricao?.message} obrigatorio>
                <Textarea {...register('descricao')} />
              </Campo>
            </div>
          </Card>

          {substituir && (
            <Card>
              <h2 className="mb-1 text-base font-semibold">Substituição</h2>
              <p className="mb-3 text-sm text-slate-500">
                Substitui a nota <span className="font-mono text-xs">{formatarChave(chaveModelo)}</span>. Uma nota cancelada não pode ser substituída.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <Campo label="Motivo" className="sm:col-span-2" obrigatorio>
                  <Select {...register('motivoSubstituicao')}>
                    {Object.entries(MOTIVOS_SUBSTITUICAO).map(([c, t]) => (
                      <option key={c} value={c}>
                        {c} — {t}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo label="Descrição do motivo" className="sm:col-span-4" erro={errors.descricaoSubstituicao?.message} dica="Opcional; se informar, de 15 a 255 caracteres">
                  <Input {...register('descricaoSubstituicao')} />
                </Campo>
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-base font-semibold">O que vem da nota-modelo</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500 uppercase">Prestador</dt>
                <dd className="font-medium">{formatCpfCnpj(d.prestador.cnpj ?? d.prestador.cpf ?? '')}</dd>
                <dd className="text-xs text-slate-500">IM {d.prestador.inscricaoMunicipal ?? '—'} · {SIMPLES[d.prestador.regime.opSimpNac] ?? d.prestador.regime.opSimpNac}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 uppercase">Serviço</dt>
                <dd className="font-medium">{d.servico.cTribNac.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3')}{d.servico.cTribMun ? ` / ${d.servico.cTribMun}` : ''}</dd>
                <dd className="text-xs text-slate-500">município {d.servico.codigoMunicipioPrestacao ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 uppercase">ISSQN</dt>
                <dd>{ISSQN[d.valores.tribMun.tribISSQN] ?? d.valores.tribMun.tribISSQN}</dd>
                <dd className="text-xs text-slate-500">{RETENCAO[d.valores.tribMun.tpRetISSQN] ?? d.valores.tribMun.tpRetISSQN}{d.valores.tribMun.pAliq ? ` · ${d.valores.tribMun.pAliq}%` : ''}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 uppercase">Numeração</dt>
                <dd>série {modelo.numeracao.serie} · DPS nº {modelo.numeracao.proximoNumero}</dd>
                <dd className="text-xs text-slate-500">faixa de aplicativo próprio</dd>
              </div>
              {d.tomador?.endereco && (
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-xs text-slate-500 uppercase">Endereço do tomador</dt>
                  <dd>
                    {[d.tomador.endereco.logradouro, d.tomador.endereco.numero, d.tomador.endereco.complemento, d.tomador.endereco.bairro].filter(Boolean).join(', ')}
                    {d.tomador.endereco.codigoMunicipio ? ` · IBGE ${d.tomador.endereco.codigoMunicipio}` : ''}
                  </dd>
                </div>
              )}
            </dl>
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
                <Campo label="Confirmação" className="sm:col-span-3" erro={errors.confirmacao?.message} dica="Digite PRODUCAO" obrigatorio>
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
              <Send className="h-4 w-4" /> {substituir ? 'Assinar e substituir' : 'Assinar e emitir'}
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
