import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useAuth } from '../../auth/AuthProvider'
import { confirmar, perguntar } from '../../components/Dialogo'
import { Alerta, Botao, Card } from '../../components/ui'

/**
 * Desativar (reversível) ou excluir (só empresa vazia) a empresa aberta. Só administrador.
 * Excluir apaga de vez; por isso o backend recusa quando já existe nota, guia, documento,
 * lançamento, folha ou certificado — dado fiscal não se apaga por um botão.
 */
export function SituacaoEmpresaCard() {
  const { empresa, membro } = useAuth()
  const navegar = useNavigate()
  const [ocupado, setOcupado] = useState<'situacao' | 'excluir' | null>(null)
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null)
  if (!empresa || membro?.papel !== 'admin') return null
  const desativada = Boolean(empresa.desativada)

  async function alterarSituacao() {
    const pergunta = desativada
      ? `Reativar ${empresa!.nome}? A busca automática de notas e o honorário recorrente voltam como estavam antes.`
      : `Desativar ${empresa!.nome}? Os dados continuam guardados, mas a empresa sai da rotina: a busca automática de notas para, o honorário recorrente deixa de ser gerado e ela vai para o fim da carteira. Dá para reativar quando quiser.`
    if (!(await confirmar(pergunta, { titulo: desativada ? 'Reativar empresa' : 'Desativar empresa', textoConfirmar: desativada ? 'Reativar' : 'Desativar' }))) return
    setOcupado('situacao')
    setMsg(null)
    try {
      await httpsCallable(functions, 'alterarSituacaoEmpresa')({ ativar: desativada })
      setMsg({ texto: desativada ? 'Empresa reativada.' : 'Empresa desativada.' })
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : 'Não foi possível alterar a situação.', erro: true })
    } finally {
      setOcupado(null)
    }
  }

  async function excluir() {
    const resposta = await perguntar(
      `Excluir ${empresa!.nome} de vez? Isto só funciona para empresa sem dados — um cadastro duplicado ou feito por engano. Não há como desfazer. Digite EXCLUIR para confirmar.`,
      { titulo: 'Excluir empresa', textoConfirmar: 'Excluir', perigo: true },
    )
    if (resposta === null) return
    if (resposta.trim() !== 'EXCLUIR') {
      setMsg({ texto: 'Nada foi excluído: a confirmação precisa ser a palavra EXCLUIR.', erro: true })
      return
    }
    setOcupado('excluir')
    setMsg(null)
    try {
      await httpsCallable(functions, 'excluirEmpresaVazia')({ confirmacao: 'EXCLUIR' })
      // o backend já abriu outra empresa do usuário; a carteira mostra o que sobrou
      navegar('/carteira', { replace: true })
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : 'Não foi possível excluir.', erro: true })
      setOcupado(null)
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">Situação da empresa</h2>
      <p className="mb-4 text-sm text-slate-500">
        {desativada
          ? 'Esta empresa está desativada: os dados continuam aqui, mas ela está fora da rotina do escritório.'
          : 'Desative a empresa que deixou de ser atendida: os dados ficam guardados e dá para reativar. Excluir é só para cadastro duplicado ou feito por engano, sem nenhum dado.'}
      </p>
      {msg && (
        <div className="mb-3">
          <Alerta tipo={msg.erro ? 'erro' : 'sucesso'}>{msg.texto}</Alerta>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao variante="secundario" carregando={ocupado === 'situacao'} onClick={() => void alterarSituacao()}>
          {desativada ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} {desativada ? 'Reativar empresa' : 'Desativar empresa'}
        </Botao>
        <Botao variante="perigo" carregando={ocupado === 'excluir'} onClick={() => void excluir()}>
          <Trash2 className="h-4 w-4" /> Excluir empresa
        </Botao>
      </div>
    </Card>
  )
}
