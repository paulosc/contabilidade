import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { httpsCallable } from 'firebase/functions'
import { FileText, PlugZap, Power, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { functions } from '../../lib/firebase'
import { useDocumento } from '../../services/firestore'
import { Alerta, Badge, Botao, Campo, Card, Input, Select } from '../../components/ui'
import { confirmar } from '../../components/Dialogo'
import { formatCpfCnpj, formatData, somenteDigitos } from '../../lib/utils'
import { diasAte, esquemaCertificadoFiscal, lerArquivoBase64, nsuLegivel, UFS, type FormCertificadoFiscal } from '../../lib/fiscal'
import { AMBIENTES_FISCAIS, SITUACOES_SYNC_FISCAL, type ConfiguracaoFiscal } from '../../types'

type Msg = { tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null

function Indicador({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string; tom?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{rotulo}</p>
      <p className={`text-lg font-semibold ${tom ?? 'text-slate-900'}`}>{valor}</p>
      {detalhe && <p className="text-xs text-slate-500">{detalhe}</p>}
    </div>
  )
}

export function FiscalCard() {
  const { membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  // tempo real: a Cloud Function escreve o documento e a tela reage sozinha (nada de polling)
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const [editando, setEditando] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const form = useForm<FormCertificadoFiscal>({
    resolver: zodResolver(esquemaCertificadoFiscal),
    defaultValues: { cnpj: '', uf: 'MG', ambiente: 'homologacao', senha: '' },
  })

  const cert = config?.certificado
  const validoAte = cert?.validoAte?.toDate?.()
  const diasRestantes = validoAte ? diasAte(validoAte) : null
  const sync = config?.sincronizacao
  const proxima = sync?.proximaPermitidaEm?.toDate?.()

  async function chamar<T>(nome: string, dados: unknown, chave: string): Promise<T | null> {
    setOcupado(chave)
    setMsg(null)
    try {
      const r = await httpsCallable<unknown, T>(functions, nome)(dados)
      return r.data
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha na operação.' })
      return null
    } finally {
      setOcupado(null)
    }
  }

  async function salvarCertificado(valores: FormCertificadoFiscal) {
    if (!arquivo) {
      setMsg({ tipo: 'erro', texto: 'Escolha o arquivo .pfx ou .p12 do certificado A1.' })
      return
    }
    setOcupado('salvar')
    setMsg(null)
    try {
      const pfxBase64 = await lerArquivoBase64(arquivo)
      await httpsCallable(functions, 'salvarCertificadoFiscal')({
        pfxBase64,
        senha: valores.senha,
        cnpj: somenteDigitos(valores.cnpj),
        uf: valores.uf,
        ambiente: valores.ambiente,
      })
      setMsg({ tipo: 'sucesso', texto: 'Certificado validado e guardado com segurança. Use "Testar conexão" antes de ativar.' })
      setEditando(false)
      setArquivo(null)
      form.reset({ ...valores, senha: '' })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível salvar o certificado.' })
    } finally {
      setOcupado(null)
    }
  }

  async function testar() {
    const r = await chamar<{ ok: boolean; mensagem: string }>('testarConexaoFiscal', {}, 'testar')
    if (r) setMsg({ tipo: r.ok ? 'sucesso' : 'erro', texto: r.mensagem })
  }

  async function sincronizar() {
    const r = await chamar<{ executou: boolean; motivo?: string; documentosProcessados: number; nsuInicial: string; nsuFinal: string; mensagemRetorno?: string }>(
      'sincronizarFiscalAgora',
      {},
      'sincronizar',
    )
    if (!r) return
    setMsg(
      r.executou
        ? {
            tipo: 'sucesso',
            texto: `${r.documentosProcessados} documento(s) processado(s). NSU ${nsuLegivel(r.nsuInicial)} → ${nsuLegivel(r.nsuFinal)}.${r.mensagemRetorno ? ` ${r.mensagemRetorno}` : ''}`,
          }
        : { tipo: 'info', texto: r.motivo ?? 'Sincronização não executada.' },
    )
  }

  async function alternarAtivo() {
    const ativar = !config?.ativo
    if (
      !ativar &&
      !(await confirmar('Desativar a busca automática de notas fiscais? As notas já baixadas continuam disponíveis.', {
        titulo: 'Desativar integração',
      }))
    ) {
      return
    }
    const r = await chamar('ativarIntegracaoFiscal', { ativo: ativar }, 'ativar')
    if (r) setMsg({ tipo: 'sucesso', texto: ativar ? 'Integração ativada. A sincronização automática roda de hora em hora.' : 'Integração desativada.' })
  }

  async function remover() {
    if (!(await confirmar('Remover o certificado digital desta empresa? A integração será desativada.'))) return
    const r = await chamar('removerCertificadoFiscal', {}, 'remover')
    if (r) setMsg({ tipo: 'sucesso', texto: 'Certificado removido.' })
  }

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="h-4 w-4" /> Integração fiscal (NF-e)
        </h2>
        {config?.ativo ? <Badge tom="verde">🟢 Ativa</Badge> : <Badge tom="amarelo">Inativa</Badge>}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Busca automática, no Ambiente Nacional da NF-e, das notas emitidas para o CNPJ da empresa.
        O certificado A1 e a senha ficam cifrados no backend — a senha nunca aparece nesta tela.
      </p>

      {msg && (
        <div className="mb-3">
          <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
        </div>
      )}

      {/* ---------- painel ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Situação"
          valor={sync ? SITUACOES_SYNC_FISCAL[sync.status] : 'Não configurada'}
          detalhe={config ? AMBIENTES_FISCAIS[config.ambiente] : undefined}
          tom={sync?.status === 'erro' ? 'text-red-700' : sync?.status === 'aguardando' ? 'text-emerald-700' : undefined}
        />
        <Indicador
          rotulo="Certificado"
          valor={validoAte ? formatData(cert?.validoAte) : '—'}
          detalhe={
            diasRestantes === null
              ? 'Nenhum certificado cadastrado'
              : diasRestantes < 0
                ? 'Vencido'
                : `Válido até · faltam ${diasRestantes} dia(s)`
          }
          tom={diasRestantes !== null && diasRestantes < 30 ? 'text-amber-700' : undefined}
        />
        <Indicador
          rotulo="Última sincronização"
          valor={sync?.ultimaSincronizacao ? formatData(sync.ultimaSincronizacao) : '—'}
          detalhe={proxima && proxima.getTime() > Date.now() ? `Próxima a partir de ${proxima.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Roda de hora em hora'}
        />
        <Indicador
          rotulo="Último NSU"
          valor={nsuLegivel(sync?.ultimoNsu)}
          detalhe={sync ? `Maior NSU na SEFAZ: ${nsuLegivel(sync.maxNsu)}` : undefined}
        />
        <Indicador rotulo="Notas encontradas" valor={String(sync?.documentosEncontrados ?? 0)} />
        <Indicador rotulo="Notas processadas" valor={String(sync?.documentosProcessados ?? 0)} />
        <Indicador rotulo="Erros" valor={String(sync?.erros ?? 0)} tom={sync?.erros ? 'text-red-700' : undefined} />
        <Indicador
          rotulo="CNPJ consultado"
          valor={config?.cnpj ? formatCpfCnpj(config.cnpj) : '—'}
          detalhe={cert ? `${cert.tipo} · ${cert.titular}` : undefined}
        />
      </div>

      {sync?.mensagemRetorno && (
        <p className="mt-3 text-xs text-slate-600">
          Último retorno da SEFAZ{sync.codigoRetorno ? ` (${sync.codigoRetorno})` : ''}: {sync.mensagemRetorno}
        </p>
      )}

      {/* ---------- ações ---------- */}
      {ehAdmin && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Botao tamanho="sm" variante="secundario" onClick={() => setEditando((v) => !v)}>
            {editando ? 'Fechar' : cert ? 'Trocar certificado' : 'Cadastrar certificado'}
          </Botao>
          {cert && (
            <>
              <Botao tamanho="sm" variante="secundario" carregando={ocupado === 'testar'} onClick={() => void testar()}>
                <PlugZap className="h-3.5 w-3.5" /> Testar conexão
              </Botao>
              <Botao tamanho="sm" variante="secundario" carregando={ocupado === 'sincronizar'} onClick={() => void sincronizar()}>
                <RefreshCw className="h-3.5 w-3.5" /> Sincronizar agora
              </Botao>
              <Botao tamanho="sm" variante={config?.ativo ? 'secundario' : 'primario'} carregando={ocupado === 'ativar'} onClick={() => void alternarAtivo()}>
                <Power className="h-3.5 w-3.5" /> {config?.ativo ? 'Desativar integração' : 'Ativar integração'}
              </Botao>
              <Botao tamanho="sm" variante="secundario" carregando={ocupado === 'remover'} onClick={() => void remover()}>
                <Trash2 className="h-3.5 w-3.5" /> Remover certificado
              </Botao>
            </>
          )}
          <Link to="/notas-fiscais" className="ml-auto">
            <Botao tamanho="sm" variante="secundario">
              <FileText className="h-3.5 w-3.5" /> Ver notas fiscais
            </Botao>
          </Link>
        </div>
      )}

      {/* ---------- formulário do certificado ---------- */}
      {editando && ehAdmin && (
        <form onSubmit={form.handleSubmit(salvarCertificado)} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-6">
          <Campo label="CNPJ da empresa" className="sm:col-span-3" erro={form.formState.errors.cnpj?.message} obrigatorio
            dica="Precisa ter a mesma raiz (8 primeiros dígitos) do CNPJ do certificado">
            <Input
              {...form.register('cnpj')}
              onChange={(e) => form.setValue('cnpj', formatCpfCnpj(e.target.value), { shouldValidate: true })}
              placeholder="00.000.000/0001-00"
              inputMode="numeric"
            />
          </Campo>
          <Campo label="UF" className="sm:col-span-1" erro={form.formState.errors.uf?.message}>
            <Select {...form.register('uf')}>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Ambiente" className="sm:col-span-2" erro={form.formState.errors.ambiente?.message}
            dica="Comece em homologação e só depois mude para produção">
            <Select {...form.register('ambiente')}>
              {Object.entries(AMBIENTES_FISCAIS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Certificado digital A1 (.pfx ou .p12)" className="sm:col-span-3" obrigatorio
            dica="O arquivo vai cifrado para o backend e nunca fica no navegador">
            <input
              type="file"
              accept=".pfx,.p12"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
          </Campo>
          <Campo label="Senha do certificado" className="sm:col-span-3" erro={form.formState.errors.senha?.message} obrigatorio>
            <Input type="password" autoComplete="new-password" {...form.register('senha')} />
          </Campo>
          <div className="sm:col-span-6">
            <Botao type="submit" tamanho="sm" carregando={ocupado === 'salvar'}>
              Validar e salvar certificado
            </Botao>
            <p className="mt-2 text-xs text-slate-500">
              A validade e o CNPJ são lidos do próprio certificado. Certificado vencido ou com senha errada é recusado na hora.
            </p>
          </div>
        </form>
      )}
    </Card>
  )
}
