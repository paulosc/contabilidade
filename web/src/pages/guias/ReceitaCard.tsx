import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { FileCheck2, KeyRound, Landmark, PlugZap, Trash2 } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useDocumento } from '../../services/firestore'
import { Alerta, Badge, Botao, Campo, Card, Input } from '../../components/ui'
import { confirmar } from '../../components/Dialogo'
import { formatBRL, formatCpfCnpj } from '../../lib/utils'
import type { ConfiguracaoFiscal } from '../../types'

type Msg = { tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null

const esquemaCredenciais = z.object({
  consumerKey: z.string().trim().min(8, 'Cole a consumer key do contrato'),
  consumerSecret: z.string().trim().min(8, 'Cole a consumer secret do contrato'),
})
type FormCredenciais = z.infer<typeof esquemaCredenciais>

const esquemaDas = z.object({ periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Informe a competência') })
type FormDas = z.infer<typeof esquemaDas>

const esquemaDarf = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Informe a competência'),
  numeroRecibo: z.string().trim().regex(/^\d*$/, 'Só números'),
})
type FormDarf = z.infer<typeof esquemaDarf>

/** Mês anterior: é a competência que costuma estar vencendo agora. */
const mesAnterior = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString('en-CA').slice(0, 7)
}

const dataBr = (iso?: string | null) => (iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') : '—')

function baixar(base64: string, nome: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
}

interface GuiaGerada {
  nova: boolean
  valor: number | null
  vencimento: string | null
  observacoes?: string[]
  avisos: string[]
}

/**
 * Geração oficial de DAS e DARF pela Receita Federal, via Integra Contador (Serpro).
 * O sistema não fabrica guia: ele pede a guia à Receita e guarda o PDF que ela devolve.
 */
export function ReceitaCard() {
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const configurado = Boolean(config?.serpro?.configurado)
  const temCertificado = Boolean(config?.certificado)

  const credenciais = useForm<FormCredenciais>({ resolver: zodResolver(esquemaCredenciais), defaultValues: { consumerKey: '', consumerSecret: '' } })
  const das = useForm<FormDas>({ resolver: zodResolver(esquemaDas), defaultValues: { periodo: mesAnterior() } })
  const darf = useForm<FormDarf>({ resolver: zodResolver(esquemaDarf), defaultValues: { periodo: mesAnterior(), numeroRecibo: '' } })

  async function executar<T>(nome: string, funcao: string, dados: unknown): Promise<T | null> {
    setOcupado(nome)
    setMsg(null)
    try {
      return (await httpsCallable<unknown, T>(functions, funcao)(dados)).data
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'A operação falhou.' })
      return null
    } finally {
      setOcupado(null)
    }
  }

  async function salvar(v: FormCredenciais) {
    const r = await executar<{ ok: boolean }>('salvar', 'salvarCredenciaisSerpro', v)
    if (!r) return
    credenciais.reset({ consumerKey: '', consumerSecret: '' })
    setMsg({ tipo: 'sucesso', texto: 'Credenciais guardadas (cifradas). Use "Testar" para conferir a autenticação.' })
  }

  async function remover() {
    const ok = await confirmar('Remover as credenciais do Serpro desta empresa? A geração de guias pela Receita deixa de funcionar até cadastrar de novo.', {
      titulo: 'Remover credenciais',
      textoConfirmar: 'Remover',
      perigo: true,
    })
    if (ok && (await executar('remover', 'removerCredenciaisSerpro', {}))) setMsg({ tipo: 'info', texto: 'Credenciais removidas.' })
  }

  async function testar() {
    const r = await executar<{ demonstracao: { ok: boolean; detalhe: string }; producao?: { ok: boolean; detalhe: string } }>('testar', 'testarSerpro', {})
    if (!r) return
    const tudoOk = r.demonstracao.ok && (r.producao?.ok ?? true)
    setMsg({
      tipo: tudoOk ? 'sucesso' : 'erro',
      texto: `Demonstração: ${r.demonstracao.detalhe}${r.producao ? ` Produção: ${r.producao.detalhe}` : ' Produção: ainda sem credenciais cadastradas.'}`,
    })
  }

  const resumo = (tipo: string, g: GuiaGerada) =>
    `${tipo} emitido pela Receita${g.valor ? `: ${formatBRL(g.valor)}` : ''}${g.vencimento ? `, pagar até ${dataBr(g.vencimento)}` : ''}${g.nova ? '' : ' (já estava na lista; atualizado)'}. ` +
    'A guia está na lista abaixo, com a linha digitável e o PDF.' +
    // as observações vêm da própria Receita, às vezes como código curto: rotuladas, para não parecerem texto solto
    (g.observacoes?.length ? ` Observações da Receita: ${g.observacoes.join(' · ')}.` : '') +
    (g.avisos.length ? ` ${g.avisos.join(' ')}` : '')

  async function gerarDas(v: FormDas) {
    const r = await executar<GuiaGerada>('das', 'gerarDasReceita', { periodo: v.periodo })
    if (r) setMsg({ tipo: 'sucesso', texto: resumo('DAS', r) })
  }

  async function gerarDarf(v: FormDarf) {
    const r = await executar<GuiaGerada>('darf', 'gerarDarfReceita', { periodo: v.periodo, numeroRecibo: v.numeroRecibo ? Number(v.numeroRecibo) : undefined })
    if (r) setMsg({ tipo: 'sucesso', texto: resumo('DARF', r) })
  }

  async function verDeclaracao() {
    const periodo = das.getValues('periodo')
    const r = await executar<{ numeroDeclaracao: string | null; recibo: { nomeArquivo: string; pdfBase64: string } | null }>('declaracao', 'declaracaoPgdasd', { periodo })
    if (!r) return
    if (r.recibo) baixar(r.recibo.pdfBase64, r.recibo.nomeArquivo)
    setMsg({
      tipo: r.numeroDeclaracao ? 'sucesso' : 'info',
      texto: r.numeroDeclaracao ? `Declaração nº ${r.numeroDeclaracao} transmitida para ${periodo}. O recibo foi baixado.` : `Nenhuma declaração encontrada para ${periodo}.`,
    })
  }

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Landmark className="h-4 w-4" /> Gerar pela Receita Federal
        </h2>
        <Badge tom={configurado ? 'verde' : 'neutro'}>{configurado ? 'Integra Contador ligado' : 'Não configurado'}</Badge>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        DAS e DARF emitidos pela própria Receita, pela API oficial <strong>Integra Contador (Serpro)</strong>. O sistema pede a guia e guarda o PDF que ela devolve — a guia sai
        com número e código de barras válidos. A declaração do período (PGDAS-D, DCTFWeb) precisa já ter sido transmitida pelo contador.
      </p>

      {msg && (
        <div className="mb-3">
          <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
        </div>
      )}

      {!configurado ? (
        <>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Contrate o Integra Contador na loja do Serpro, com o e-CNPJ desta empresa. É um serviço pago, cobrado por chamada.</li>
            <li>Na área do cliente do Serpro, copie a <em>consumer key</em> e a <em>consumer secret</em>.</li>
            <li>Cole as duas abaixo. Elas ficam cifradas no servidor e não voltam a aparecer.</li>
          </ol>
          {!temCertificado && (
            <div className="mb-3">
              <Alerta tipo="info">Cadastre antes o certificado A1 em Configurações: o Serpro autentica com o mesmo e-CNPJ da contratação.</Alerta>
            </div>
          )}
          <form onSubmit={credenciais.handleSubmit(salvar)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo label="Consumer key" erro={credenciais.formState.errors.consumerKey?.message} obrigatorio>
              <Input type="password" autoComplete="off" {...credenciais.register('consumerKey')} />
            </Campo>
            <Campo label="Consumer secret" erro={credenciais.formState.errors.consumerSecret?.message} obrigatorio>
              <Input type="password" autoComplete="off" {...credenciais.register('consumerSecret')} />
            </Campo>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Botao type="submit" tamanho="sm" carregando={ocupado === 'salvar'} disabled={!temCertificado}>
                <KeyRound className="h-3.5 w-3.5" /> Guardar credenciais
              </Botao>
              <Botao type="button" tamanho="sm" variante="secundario" carregando={ocupado === 'testar'} onClick={() => void testar()}>
                <PlugZap className="h-3.5 w-3.5" /> Testar com a demonstração do Serpro
              </Botao>
            </div>
          </form>
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Contratante: {config?.serpro?.contratante ? formatCpfCnpj(config.serpro.contratante) : '—'}. Cada guia gerada é uma chamada cobrada pelo Serpro.
          </p>
          <form onSubmit={das.handleSubmit(gerarDas)} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-6">
            <Campo label="DAS — competência" className="sm:col-span-2" erro={das.formState.errors.periodo?.message}>
              <Input type="month" {...das.register('periodo')} />
            </Campo>
            <div className="flex flex-wrap gap-2 sm:col-span-4">
              <Botao type="submit" tamanho="sm" carregando={ocupado === 'das'}>
                <Landmark className="h-3.5 w-3.5" /> Gerar DAS
              </Botao>
              <Botao type="button" tamanho="sm" variante="secundario" carregando={ocupado === 'declaracao'} onClick={() => void verDeclaracao()}>
                <FileCheck2 className="h-3.5 w-3.5" /> Recibo da declaração
              </Botao>
            </div>
          </form>
          <form onSubmit={darf.handleSubmit(gerarDarf)} className="mt-3 grid grid-cols-1 items-end gap-3 border-t border-slate-200 pt-3 sm:grid-cols-6">
            <Campo label="DARF (DCTFWeb) — competência" className="sm:col-span-2" erro={darf.formState.errors.periodo?.message}>
              <Input type="month" {...darf.register('periodo')} />
            </Campo>
            <Campo label="Nº do recibo" className="sm:col-span-2" erro={darf.formState.errors.numeroRecibo?.message} dica="Em branco: declaração em andamento">
              <Input inputMode="numeric" {...darf.register('numeroRecibo')} />
            </Campo>
            <div className="sm:col-span-2">
              <Botao type="submit" tamanho="sm" carregando={ocupado === 'darf'}>
                <Landmark className="h-3.5 w-3.5" /> Gerar DARF
              </Botao>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <Botao tamanho="sm" variante="secundario" carregando={ocupado === 'testar'} onClick={() => void testar()}>
              <PlugZap className="h-3.5 w-3.5" /> Testar
            </Botao>
            <Botao tamanho="sm" variante="fantasma" carregando={ocupado === 'remover'} onClick={() => void remover()}>
              <Trash2 className="h-3.5 w-3.5" /> Remover credenciais
            </Botao>
          </div>
        </>
      )}
    </Card>
  )
}
