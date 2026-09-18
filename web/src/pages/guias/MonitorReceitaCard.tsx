import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import type { Timestamp } from 'firebase/firestore'
import { BadgeCheck, Download, FileSearch, Inbox, Radar, ShieldAlert } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useDocumento } from '../../services/firestore'
import { Alerta, Badge, Botao, Card } from '../../components/ui'
import { formatBRL, formatData } from '../../lib/utils'
import { baixarPdf } from '../../lib/compartilhar'
import { dataBr } from '../../lib/escritorio'
import type { ConfiguracaoFiscal } from '../../types'

interface MensagemCaixaPostal {
  isn: string
  assunto: string
  enviadaEm?: string
  lida: boolean
  cienciaEm?: string
  relevante: boolean
  origem?: string
}

interface CaixaPostalGuardada {
  consultadoEm?: Timestamp
  naoLidas: number
  relevantesNaoLidas: number
  temMaisPaginas: boolean
  mensagens: MensagemCaixaPostal[]
}

interface SituacaoFiscalGuardada {
  emitidoEm?: Timestamp
  semPendencias: boolean
  certidao?: string
  certidaoValidaAte?: string
}

interface ResultadoPagamentos {
  consultadas: number
  baixadas: Array<{ guiaId: string; tipo: string; valor?: number; pagaEm: string }>
  semPagamento: number
}

const mensagemDeErro = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao)

/**
 * Acompanhamento da empresa na Receita pelo Integra Contador. Cada botão é uma requisição
 * tarifada, por isso nada consulta sozinho: o último resultado fica guardado e aparece aqui.
 */
export function MonitorReceitaCard() {
  const { dado: config } = useDocumento<ConfiguracaoFiscal>('configuracoes', 'fiscal')
  const { dado: caixa } = useDocumento<CaixaPostalGuardada>('receita', 'caixaPostal')
  const { dado: situacao } = useDocumento<SituacaoFiscalGuardada>('receita', 'situacaoFiscal')
  const [ocupado, setOcupado] = useState<'pagamentos' | 'caixa' | 'situacao' | 'pdf' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pagamentos, setPagamentos] = useState<ResultadoPagamentos | null>(null)
  const [todas, setTodas] = useState(false)

  if (!config?.serpro?.configurado) return null

  async function executar<T>(qual: NonNullable<typeof ocupado>, nome: string, depois?: (r: T) => void) {
    setOcupado(qual)
    setErro(null)
    try {
      const r = await httpsCallable<unknown, T>(functions, nome)({})
      depois?.(r.data)
    } catch (e) {
      setErro(mensagemDeErro(e, 'A Receita não respondeu como esperado.'))
    } finally {
      setOcupado(null)
    }
  }

  const naoLidas = (caixa?.mensagens ?? []).filter((m) => !m.lida)
  const visiveis = todas ? (caixa?.mensagens ?? []) : naoLidas

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Radar className="h-4 w-4" /> Acompanhamento na Receita Federal
      </h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Consultas feitas pelo Integra Contador. Cada clique é uma requisição tarifada (consulta ≈ R$ 0,24; relatório ≈ R$ 0,32), então nada aqui roda sozinho — o último resultado fica guardado.
      </p>

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* pagamentos */}
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BadgeCheck className="h-4 w-4 text-emerald-600" /> Pagamentos
          </p>
          <p className="mt-1 text-xs text-slate-500">Pergunta à Receita quais DAS e DARF em aberto já foram pagos e dá baixa com a data da arrecadação. Uma consulta cobre todas as guias.</p>
          <Botao className="mt-3" tamanho="sm" variante="secundario" carregando={ocupado === 'pagamentos'} onClick={() => void executar<ResultadoPagamentos>('pagamentos', 'conferirPagamentosReceita', setPagamentos)}>
            Conferir pagamentos
          </Botao>
          {pagamentos && (
            <div className="mt-3 text-xs text-slate-700">
              {pagamentos.consultadas === 0 ? (
                <p>Não há DAS nem DARF em aberto para conferir — nada foi consultado nem cobrado.</p>
              ) : (
                <>
                  <p>
                    <strong>{pagamentos.baixadas.length}</strong> de {pagamentos.consultadas} {pagamentos.consultadas === 1 ? 'guia consta' : 'guias constam'} como paga{pagamentos.baixadas.length === 1 ? '' : 's'} na Receita.
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {pagamentos.baixadas.map((b) => (
                      <li key={b.guiaId}>
                        {b.tipo.toUpperCase()} · {formatBRL(b.valor)} · paga em {dataBr(b.pagaEm)}
                      </li>
                    ))}
                  </ul>
                  {pagamentos.semPagamento > 0 && <p className="mt-1 text-slate-500">O banco leva até 2 dias úteis para repassar o pagamento à Receita.</p>}
                </>
              )}
            </div>
          )}
        </div>

        {/* caixa postal */}
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
            <Inbox className="h-4 w-4 text-sky-600" /> Caixa postal do e-CAC
            {caixa && <Badge tom={caixa.naoLidas ? 'vermelho' : 'verde'}>{caixa.naoLidas ? `${caixa.naoLidas} não lida${caixa.naoLidas > 1 ? 's' : ''}` : 'tudo lido'}</Badge>}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Mostra só os assuntos. O conteúdo é lido no e-CAC: abrir a mensagem por sistema vale como <strong>ciência da intimação</strong> e começa a contar prazo.
          </p>
          <Botao className="mt-3" tamanho="sm" variante="secundario" carregando={ocupado === 'caixa'} onClick={() => void executar('caixa', 'caixaPostalReceita')}>
            Consultar agora
          </Botao>
          {caixa && (
            <div className="mt-3">
              <p className="text-xs text-slate-500">Consultada em {formatData(caixa.consultadoEm)}</p>
              <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                {visiveis.map((m) => (
                  <li key={m.isn} className="text-xs">
                    <p className={m.lida ? 'text-slate-600' : 'font-medium text-slate-900'}>
                      {m.relevante && <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-amber-600" />}
                      {m.assunto}
                    </p>
                    <p className="text-slate-500">
                      {dataBr(m.enviadaEm)}
                      {m.origem ? ` · ${m.origem}` : ''}
                      {!m.lida && m.cienciaEm ? ` · ciência registrada em ${dataBr(m.cienciaEm)}` : ''}
                    </p>
                  </li>
                ))}
                {visiveis.length === 0 && <li className="text-xs text-slate-500">Nenhuma mensagem não lida.</li>}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {caixa.mensagens.length > naoLidas.length && (
                  <button type="button" className="text-slate-600 underline" onClick={() => setTodas((v) => !v)}>
                    {todas ? 'Só as não lidas' : `Ver as ${caixa.mensagens.length} mais recentes`}
                  </button>
                )}
                <a className="font-medium text-indigo-700 underline" href="https://cav.receita.fazenda.gov.br/" target="_blank" rel="noreferrer">
                  Abrir o e-CAC
                </a>
              </div>
            </div>
          )}
        </div>

        {/* situação fiscal */}
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
            <FileSearch className="h-4 w-4 text-violet-600" /> Situação fiscal
            {situacao && <Badge tom={situacao.semPendencias ? 'verde' : 'amarelo'}>{situacao.semPendencias ? 'sem pendências' : 'confira o relatório'}</Badge>}
          </p>
          <p className="mt-1 text-xs text-slate-500">Relatório oficial da Receita e da PGFN — o mesmo que sustenta a certidão negativa. Leva alguns segundos para ficar pronto.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Botao
              tamanho="sm"
              variante="secundario"
              carregando={ocupado === 'situacao'}
              onClick={() => void executar<{ pdfBase64: string }>('situacao', 'situacaoFiscalReceita', (r) => baixarPdf(r.pdfBase64, 'situacao-fiscal.pdf'))}
            >
              Emitir relatório
            </Botao>
            {situacao && (
              <Botao
                tamanho="sm"
                variante="fantasma"
                carregando={ocupado === 'pdf'}
                onClick={() => void executar<{ pdfBase64: string; nomeArquivo: string }>('pdf', 'pdfSituacaoFiscalGuardado', (r) => baixarPdf(r.pdfBase64, r.nomeArquivo))}
              >
                <Download className="h-3.5 w-3.5" /> Baixar o último
              </Botao>
            )}
          </div>
          {situacao && (
            <div className="mt-3 text-xs text-slate-700">
              <p className="text-slate-500">Emitido em {formatData(situacao.emitidoEm)}</p>
              {situacao.certidao && (
                <p className="mt-1">
                  {situacao.certidao}
                  {situacao.certidaoValidaAte ? ` · válida até ${dataBr(situacao.certidaoValidaAte)}` : ''}
                </p>
              )}
              {!situacao.semPendencias && <p className="mt-1 text-amber-800">O relatório não traz a frase de "não foram detectadas pendências": abra o PDF para ver o que a Receita aponta.</p>}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
