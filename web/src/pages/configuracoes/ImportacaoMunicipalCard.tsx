import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { Building, Download, Save } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { functions } from '../../lib/firebase'
import { useColecao, useDocumento } from '../../services/firestore'
import { Alerta, Botao, Campo, Card, Input } from '../../components/ui'
import { formatData } from '../../lib/utils'
import { apelidoMunicipio } from '../../lib/fiscal'
import type { ConfiguracaoFiscal, NotaServico } from '../../types'

type Msg = { tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null

const esquemaMunicipio = z.object({
  municipio: z.string().min(3, 'Informe o município ou o endereço do web service'),
  inscricaoMunicipal: z.string(),
})
type FormMunicipio = z.infer<typeof esquemaMunicipio>

const hoje = new Date().toISOString().slice(0, 10)
const esquemaPeriodo = z
  .object({ de: z.string().min(10, 'Informe a data inicial'), ate: z.string().min(10, 'Informe a data final') })
  .refine((d) => d.de <= d.ate, { path: ['ate'], message: 'A data final é anterior à inicial' })
type FormPeriodo = z.infer<typeof esquemaPeriodo>

/**
 * Importação das NFS-e antigas direto do web service do município (padrão ABRASF 2.02).
 *
 * Serve para o que existe só no sistema da prefeitura: as notas anteriores à migração do
 * município para o Emissor Nacional, que o Ambiente de Dados Nacional não distribui.
 */
export function ImportacaoMunicipalCard() {
  const { membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const { dados: notas } = useColecao<NotaServico>('notasServico')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [incluirTomadas, setIncluirTomadas] = useState(false)

  /**
   * Sugestão a partir das notas que a empresa já emitiu: o município e a inscrição municipal
   * estão no próprio XML. Evita fixar um município no código — o escritório atende empresas de
   * cidades diferentes, e cada uma sugere a sua.
   */
  const sugestao = useMemo(() => {
    const minha = notas.find((n) => n.papel === 'prestador' && (n.municipioEmissao || n.inscricaoMunicipalPrestador))
    return {
      municipio: apelidoMunicipio(minha?.municipioEmissao),
      inscricaoMunicipal: minha?.inscricaoMunicipalPrestador ?? '',
    }
  }, [notas])

  const formMunicipio = useForm<FormMunicipio>({
    resolver: zodResolver(esquemaMunicipio),
    values: {
      municipio: config?.municipioWebservice ?? sugestao.municipio,
      inscricaoMunicipal: config?.inscricaoMunicipal ?? sugestao.inscricaoMunicipal,
    },
  })

  const formPeriodo = useForm<FormPeriodo>({
    resolver: zodResolver(esquemaPeriodo),
    defaultValues: { de: `${new Date().getFullYear() - 1}-01-01`, ate: hoje },
  })

  async function salvarMunicipio(v: FormMunicipio) {
    setOcupado('municipio')
    setMsg(null)
    try {
      await httpsCallable(functions, 'salvarMunicipioWebservice')({
        municipio: v.municipio,
        inscricaoMunicipal: v.inscricaoMunicipal,
      })
      setMsg({ tipo: 'sucesso', texto: 'Município salvo. Agora escolha o período e importe.' })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível salvar.' })
    } finally {
      setOcupado(null)
    }
  }

  async function importar(v: FormPeriodo) {
    const municipio = formMunicipio.getValues('municipio')?.trim()
    if (!municipio) {
      setMsg({ tipo: 'erro', texto: 'Informe o município do web service.' })
      return
    }
    setOcupado('importar')
    setMsg(null)
    try {
      // guarda o município junto, para a importação ser um clique só
      if (municipio !== config?.municipioWebservice || formMunicipio.getValues('inscricaoMunicipal') !== config?.inscricaoMunicipal) {
        await httpsCallable(functions, 'salvarMunicipioWebservice')({
          municipio,
          inscricaoMunicipal: formMunicipio.getValues('inscricaoMunicipal'),
        })
      }
      const r = await httpsCallable<
        unknown,
        { encontradas: number; novas: number; atualizadas: number; consultas: number; erros: number; mensagens: string[] }
      >(functions, 'importarNfseMunicipal')({ de: v.de, ate: v.ate, incluirTomadas })
      const d = r.data
      const detalhe = d.mensagens.length ? ` ${d.mensagens.join(' · ')}` : ''
      setMsg({
        tipo: d.novas || d.atualizadas ? 'sucesso' : 'info',
        texto:
          `${d.encontradas} nota(s) encontrada(s) em ${d.consultas} consulta(s) — ` +
          `${d.novas} nova(s), ${d.atualizadas} já conhecida(s).${d.erros ? ` ${d.erros} erro(s).` : ''}${detalhe}`,
      })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha na importação.' })
    } finally {
      setOcupado(null)
    }
  }

  const ultima = config?.importacaoMunicipal

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Building className="h-4 w-4" /> Importar notas do sistema municipal
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Busca as NFS-e direto no web service da prefeitura (padrão ABRASF 2.02), pelo CNPJ e período. É o caminho
        para as notas anteriores à migração do município para o Emissor Nacional — essas o Ambiente de Dados
        Nacional não distribui. Usa o mesmo certificado digital.
      </p>

      {msg && (
        <div className="mb-3">
          <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
        </div>
      )}

      {!ehAdmin ? (
        <p className="text-sm text-slate-500">Somente administradores podem importar.</p>
      ) : (
        <>
          <form onSubmit={formMunicipio.handleSubmit(salvarMunicipio)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo
              label="Município no web service"
              className="sm:col-span-4"
              erro={formMunicipio.formState.errors.municipio?.message}
              dica={
                config?.municipioWebservice
                  ? 'O apelido usado no endereço do portal'
                  : sugestao.municipio
                    ? `Sugerido pelas suas notas: ${sugestao.municipio}`
                    : 'O apelido usado no endereço do portal, ex.: conceicaodosouros'
              }
              obrigatorio
            >
              <Input placeholder="conceicaodosouros" {...formMunicipio.register('municipio')} />
            </Campo>
            <Campo label="Inscrição municipal" className="sm:col-span-2" dica="Exigida na consulta">
              <Input placeholder="13950" {...formMunicipio.register('inscricaoMunicipal')} />
            </Campo>
            <div className="sm:col-span-6">
              <Botao tamanho="sm" variante="secundario" type="submit" carregando={ocupado === 'municipio'}>
                <Save className="h-3.5 w-3.5" /> Salvar município
              </Botao>
            </div>
          </form>

          <form
            onSubmit={formPeriodo.handleSubmit(importar)}
            className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-6"
          >
            <Campo label="De" className="sm:col-span-2" erro={formPeriodo.formState.errors.de?.message}>
              <Input type="date" {...formPeriodo.register('de')} />
            </Campo>
            <Campo label="Até" className="sm:col-span-2" erro={formPeriodo.formState.errors.ate?.message}>
              <Input type="date" {...formPeriodo.register('ate')} />
            </Campo>
            <div className="flex items-end sm:col-span-2">
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={incluirTomadas}
                  onChange={(e) => setIncluirTomadas(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Incluir as recebidas
              </label>
            </div>
            <div className="sm:col-span-6">
              <Botao type="submit" carregando={ocupado === 'importar'}>
                <Download className="h-4 w-4" /> Importar período
              </Botao>
              <p className="mt-2 text-xs text-slate-500">
                A consulta é feita mês a mês, como o padrão exige. Períodos longos podem precisar de mais de uma
                execução — é só repetir que ela continua, sem duplicar nada.
              </p>
            </div>
          </form>

          {ultima?.ultimaEm && (
            <p className="mt-3 text-xs text-slate-600">
              Última importação em {formatData(ultima.ultimaEm)}
              {ultima.periodoDe ? ` · período ${ultima.periodoDe} a ${ultima.periodoAte}` : ''}
              {ultima.notasImportadas ? ` · ${ultima.notasImportadas} nota(s) nova(s)` : ''}
            </p>
          )}
        </>
      )}
    </Card>
  )
}
