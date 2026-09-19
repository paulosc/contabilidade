import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Briefcase, CircleCheck, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { Alerta, Badge, Botao, CabecalhoPagina, Card, EstadoVazio, Spinner } from '../../components/ui'
import { formatBRL, formatCpfCnpj } from '../../lib/utils'
import { REGIMES, buscarCarteira, dataBr, type ResumoDaEmpresa } from '../../lib/escritorio'

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: 'vermelho' | 'amarelo' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${tom === 'vermelho' ? 'text-red-700' : tom === 'amarelo' ? 'text-amber-700' : 'text-slate-900'}`}>{valor}</p>
    </Card>
  )
}

/**
 * Carteira de clientes: todas as empresas do usuário numa tela só, com quem tem pendência no topo.
 * O resumo é montado no backend, que confere o vínculo com cada empresa antes de ler qualquer dado.
 */
export function Carteira() {
  const { empresa, trocarEmpresa } = useAuth()
  const navegar = useNavigate()
  const [dados, setDados] = useState<{ hoje: string; empresas: ResumoDaEmpresa[] } | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [verDesativadas, setVerDesativadas] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setDados(await buscarCarteira())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a carteira.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function abrir(id: string, destino: string) {
    setAbrindo(id)
    try {
      if (empresa?.id !== id) await trocarEmpresa(id)
      navegar(destino)
    } finally {
      setAbrindo(null)
    }
  }

  const todas = dados?.empresas ?? []
  const desativadas = todas.filter((e) => e.desativada)
  // os números do topo contam só quem está na rotina
  const empresas = todas.filter((e) => !e.desativada)
  const listadas = verDesativadas ? todas : empresas
  const comPendencia = empresas.filter((e) => e.pendencias.length > 0).length
  const vencidas = empresas.reduce((s, e) => s + e.guias.vencidas, 0)
  const atrasadas = empresas.reduce((s, e) => s + (e.obrigacoes?.atrasadas ?? 0), 0)
  const emAberto = empresas.reduce((s, e) => s + e.guias.valorAberto, 0)
  const honorariosAtrasados = empresas.reduce((s, e) => s + (e.honorariosEmAtraso?.valor ?? 0), 0)
  // a declaração ao COAF é do próprio escritório, uma vez por ano: lembrar em dezembro e durante janeiro
  const mesDeHoje = Number((dados?.hoje ?? '').slice(5, 7))

  return (
    <>
      <CabecalhoPagina
        titulo="Carteira de clientes"
        descricao="Todas as empresas que você atende, com quem precisa de atenção primeiro."
        acoes={
          <>
            <Botao variante="secundario" carregando={carregando} onClick={() => void carregar()}>
              <RefreshCw className="h-4 w-4" /> Atualizar
            </Botao>
            <Link to="/empresas/nova">
              <Botao>
                <Plus className="h-4 w-4" /> Novo cliente
              </Botao>
            </Link>
          </>
        }
      />

      {erro && (
        <div className="mb-4">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {carregando && !dados ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : todas.length === 0 ? (
        <EstadoVazio icone={<Briefcase className="h-8 w-8" />} titulo="Nenhum cliente ainda" descricao="Cadastre a primeira empresa para começar." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero rotulo="Clientes" valor={String(empresas.length)} />
            <Numero rotulo="Com pendência" valor={String(comPendencia)} tom={comPendencia ? 'amarelo' : undefined} />
            <Numero rotulo="Guias vencidas · obrigações atrasadas" valor={`${vencidas} · ${atrasadas}`} tom={vencidas + atrasadas ? 'vermelho' : undefined} />
            <Numero rotulo={honorariosAtrasados ? 'Honorários em atraso' : 'Guias em aberto'} valor={formatBRL(honorariosAtrasados || emAberto)} tom={honorariosAtrasados ? 'vermelho' : undefined} />
          </div>

          {(mesDeHoje === 12 || mesDeHoje === 1) && (
            <div className="mb-4">
              <Alerta tipo="info">
                <strong>Declaração de não ocorrência ao COAF:</strong> {mesDeHoje === 1 ? 'o prazo está aberto — de 1º a 31 de janeiro' : 'o prazo abre em 1º de janeiro e vai até o dia 31'}, pelo Portal de Sistemas do CFC. É obrigação do
                responsável técnico e da organização contábil, referente ao ano anterior (Resolução CFC 1.721/2024). Se houve operação suspeita comunicada no ano, a declaração não se aplica.
              </Alerta>
            </div>
          )}

          {desativadas.length > 0 && (
            <div className="mb-3 text-right">
              <button type="button" className="text-sm text-slate-600 underline" onClick={() => setVerDesativadas((v) => !v)}>
                {verDesativadas ? 'Esconder as desativadas' : `Mostrar ${desativadas.length} desativada${desativadas.length > 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {listadas.map((e) => (
              <Card key={e.empresaId} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                      {e.nome}
                      {e.empresaId === empresa?.id && <Badge tom="azul">aberta agora</Badge>}
                      {e.desativada && <Badge>desativada</Badge>}
                      {e.regime && <Badge>{REGIMES[e.regime]}</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">{e.cnpj ? formatCpfCnpj(e.cnpj) : 'sem CNPJ'}</p>
                  </div>
                  <Botao tamanho="sm" variante="secundario" carregando={abrindo === e.empresaId} onClick={() => void abrir(e.empresaId, '/')}>
                    Abrir <ArrowRight className="h-3.5 w-3.5" />
                  </Botao>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <button type="button" onClick={() => void abrir(e.empresaId, '/guias')} className="rounded-lg bg-slate-50 px-3 py-2 text-left hover:bg-slate-100">
                    <p className="text-xs text-slate-500">Guias a pagar</p>
                    <p className="font-medium text-slate-800">
                      {e.guias.pendentes ? `${e.guias.pendentes} em aberto · ${formatBRL(e.guias.valorAberto)}` : 'Nenhuma em aberto'}
                    </p>
                    {e.guias.proximoVencimento && <p className="text-xs text-slate-500">próxima vence em {dataBr(e.guias.proximoVencimento)}</p>}
                  </button>
                  <button type="button" onClick={() => void abrir(e.empresaId, '/obrigacoes')} className="rounded-lg bg-slate-50 px-3 py-2 text-left hover:bg-slate-100">
                    <p className="text-xs text-slate-500">Obrigações</p>
                    <p className="font-medium text-slate-800">{e.obrigacoes ? `${e.obrigacoes.abertasNoMes} em aberto neste mês` : 'Perfil fiscal não cadastrado'}</p>
                    {e.obrigacoes?.proxima && (
                      <p className="truncate text-xs text-slate-500">
                        {dataBr(e.obrigacoes.proxima.vencimento)} — {e.obrigacoes.proxima.nome}
                      </p>
                    )}
                  </button>
                  <button type="button" onClick={() => void abrir(e.empresaId, '/configuracoes')} className="rounded-lg bg-slate-50 px-3 py-2 text-left hover:bg-slate-100">
                    <p className="text-xs text-slate-500">Certificado digital</p>
                    <p className="font-medium text-slate-800">{e.certificado ? `válido até ${dataBr(e.certificado.validoAte)}` : 'não enviado'}</p>
                    {e.certificado && <p className="text-xs text-slate-500">{e.certificado.dias >= 0 ? `faltam ${e.certificado.dias} dias` : `venceu há ${-e.certificado.dias} dias`}</p>}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {e.pendencias.length === 0 ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <CircleCheck className="h-4 w-4" /> Em dia
                    </span>
                  ) : (
                    <>
                      <TriangleAlert className="h-4 w-4 text-amber-600" />
                      {e.honorariosEmAtraso?.quantidade > 0 && (
                        <Badge tom="vermelho">
                          Honorários em atraso: {formatBRL(e.honorariosEmAtraso.valor)} ({e.honorariosEmAtraso.quantidade})
                        </Badge>
                      )}
                      {e.pendencias.map((p) => (
                        <Badge key={p} tom={/vencid|atrasad/.test(p) ? 'vermelho' : 'amarelo'}>
                          {p}
                        </Badge>
                      ))}
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}
