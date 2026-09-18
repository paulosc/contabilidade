import { useState, type ComponentProps } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import { FileSignature } from 'lucide-react'
import { functions } from '../../lib/firebase'
import { useAuth } from '../../auth/AuthProvider'
import { useDocumento } from '../../services/firestore'
import { Alerta, Botao, CabecalhoPagina, Campo, Card, Input, Select, Textarea } from '../../components/ui'
import { formatCpfCnpj } from '../../lib/utils'
import { baixarPdf } from '../../lib/compartilhar'
import { numero } from '../../lib/escritorio'
import type { ConfiguracaoHonorarios } from '../../types'

const SERVICOS = {
  contabil: 'Escrituração contábil, balancetes e demonstrações',
  fiscal: 'Escrituração fiscal, apuração de tributos e guias',
  acessorias: 'Obrigações acessórias federais, estaduais e municipais',
  pessoal: 'Departamento pessoal (folha, pró-labore, eSocial, FGTS)',
  societario: 'Alterações contratuais e cadastrais (eventual)',
  irpf: 'Imposto de Renda dos sócios (eventual)',
} as const

const parte = { nome: z.string().trim().min(3, 'Informe o nome'), documento: z.string().trim().min(11, 'Informe o CPF ou CNPJ'), endereco: z.string().trim(), representante: z.string().trim(), documentoRepresentante: z.string().trim() }

const esquema = z.object({
  contratada: z.object({ ...parte, crc: z.string().trim() }),
  contratante: z.object(parte),
  servicos: z.array(z.string()).min(1, 'Escolha ao menos um serviço'),
  outrosServicos: z.string().trim().max(300),
  obrigacoesDoContratante: z.string().trim().max(400),
  diaEntregaDocumentos: z.string().refine((v) => Number(v) >= 1 && Number(v) <= 31, 'Dia de 1 a 31'),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data'),
  duracaoMeses: z.string().refine((v) => !v || (Number(v) >= 1 && Number(v) <= 120), 'De 1 a 120 meses'),
  honorarioMensal: z.string().refine((v) => numero(v) > 0, 'Informe o valor'),
  diaVencimento: z.string().refine((v) => Number(v) >= 1 && Number(v) <= 31, 'Dia de 1 a 31'),
  decimoTerceiroHonorario: z.boolean(),
  indiceReajuste: z.enum(['ipca', 'inpc', 'igpm']),
  avisoPrevioDias: z.string().refine((v) => Number(v) >= 1 && Number(v) <= 180, 'De 1 a 180 dias'),
  foro: z.string().trim().min(3, 'Informe a comarca'),
  cidadeAssinatura: z.string().trim().min(2, 'Informe a cidade'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data'),
})
type Form = z.infer<typeof esquema>

type ContratoGuardado = Omit<Form, 'diaEntregaDocumentos' | 'duracaoMeses' | 'honorarioMensal' | 'diaVencimento' | 'avisoPrevioDias'> & {
  diaEntregaDocumentos: number
  duracaoMeses?: number
  honorarioMensal: number
  diaVencimento: number
  avisoPrevioDias: number
}

const Marcador = ({ rotulo, ...props }: { rotulo: string } & ComponentProps<'input'>) => (
  <label className="flex items-start gap-2 text-sm text-slate-700">
    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" {...props} /> {rotulo}
  </label>
)

const hoje = () => new Date().toLocaleDateString('en-CA')
const brl = (v?: number | null) => (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')

/** Minuta do contrato de prestação de serviços contábeis, com o conteúdo mínimo da Resolução CFC 1.590/2020. */
export function Contrato() {
  const { empresa, membro } = useAuth()
  const { dado: honorarios } = useDocumento<ConfiguracaoHonorarios>('configuracoes', 'honorarios')
  const { dado: anterior, carregando } = useDocumento<ContratoGuardado>('configuracoes', 'contrato')
  const [gerando, setGerando] = useState(false)
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null)

  const form = useForm<Form>({
    resolver: zodResolver(esquema),
    values: {
      contratada: {
        nome: anterior?.contratada.nome ?? honorarios?.emitente?.nome ?? '',
        documento: anterior?.contratada.documento ?? honorarios?.emitente?.documento ?? '',
        crc: anterior?.contratada.crc ?? honorarios?.emitente?.crc ?? '',
        endereco: anterior?.contratada.endereco ?? '',
        representante: anterior?.contratada.representante ?? '',
        documentoRepresentante: anterior?.contratada.documentoRepresentante ?? '',
      },
      contratante: {
        nome: anterior?.contratante.nome ?? empresa?.nome ?? '',
        documento: anterior?.contratante.documento ?? (empresa?.cnpj ? formatCpfCnpj(empresa.cnpj) : ''),
        endereco: anterior?.contratante.endereco ?? [empresa?.endereco?.logradouro, empresa?.endereco?.numero, empresa?.endereco?.bairro, empresa?.endereco?.cidade && `${empresa.endereco.cidade}/${empresa.endereco.uf ?? ''}`].filter(Boolean).join(', '),
        representante: anterior?.contratante.representante ?? '',
        documentoRepresentante: anterior?.contratante.documentoRepresentante ?? '',
      },
      servicos: anterior?.servicos ?? ['contabil', 'fiscal', 'acessorias'],
      outrosServicos: anterior?.outrosServicos ?? '',
      obrigacoesDoContratante: anterior?.obrigacoesDoContratante ?? '',
      diaEntregaDocumentos: String(anterior?.diaEntregaDocumentos ?? 5),
      inicio: anterior?.inicio ?? hoje(),
      duracaoMeses: anterior?.duracaoMeses ? String(anterior.duracaoMeses) : '',
      honorarioMensal: brl(anterior?.honorarioMensal ?? honorarios?.valorMensal),
      diaVencimento: String(anterior?.diaVencimento ?? honorarios?.diaVencimento ?? 10),
      decimoTerceiroHonorario: anterior?.decimoTerceiroHonorario ?? false,
      indiceReajuste: anterior?.indiceReajuste ?? 'ipca',
      avisoPrevioDias: String(anterior?.avisoPrevioDias ?? 30),
      foro: anterior?.foro ?? '',
      cidadeAssinatura: anterior?.cidadeAssinatura ?? '',
      data: hoje(),
    },
  })
  const erros = form.formState.errors

  async function gerar(v: Form) {
    setGerando(true)
    setMsg(null)
    try {
      const contrato = {
        ...v,
        diaEntregaDocumentos: Number(v.diaEntregaDocumentos),
        duracaoMeses: v.duracaoMeses ? Number(v.duracaoMeses) : undefined,
        honorarioMensal: numero(v.honorarioMensal),
        diaVencimento: Number(v.diaVencimento),
        avisoPrevioDias: Number(v.avisoPrevioDias),
      }
      const r = await httpsCallable<unknown, { pdfBase64: string; nomeArquivo: string }>(functions, 'gerarContratoDeServicos')({ contrato })
      baixarPdf(r.data.pdfBase64, r.data.nomeArquivo)
      setMsg({ texto: 'Minuta gerada e baixada. Ela também ficou guardada em Documentos, na categoria Contrato. Revise, imprima em duas vias e colha as assinaturas — depois envie a via assinada para o arquivo.' })
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : 'Não foi possível gerar o contrato.', erro: true })
    } finally {
      setGerando(false)
    }
  }

  if (membro?.papel !== 'admin') return <Alerta tipo="info">Só administradores geram o contrato de prestação de serviços.</Alerta>
  if (carregando) return null

  const Parte = ({ qual, titulo }: { qual: 'contratada' | 'contratante'; titulo: string }) => (
    <>
      <p className="text-sm font-semibold text-slate-800 sm:col-span-6">{titulo}</p>
      <Campo label="Nome ou razão social" className="sm:col-span-4" erro={erros[qual]?.nome?.message} obrigatorio>
        <Input {...form.register(`${qual}.nome`)} />
      </Campo>
      <Campo label="CPF ou CNPJ" className="sm:col-span-2" erro={erros[qual]?.documento?.message} obrigatorio>
        <Input {...form.register(`${qual}.documento`)} />
      </Campo>
      <Campo label="Endereço completo" className="sm:col-span-6">
        <Input {...form.register(`${qual}.endereco`)} />
      </Campo>
      <Campo label="Representante legal" className="sm:col-span-3">
        <Input {...form.register(`${qual}.representante`)} />
      </Campo>
      <Campo label="CPF do representante" className={qual === 'contratada' ? 'sm:col-span-2' : 'sm:col-span-3'}>
        <Input {...form.register(`${qual}.documentoRepresentante`)} />
      </Campo>
    </>
  )

  return (
    <>
      <CabecalhoPagina
        titulo="Contrato de prestação de serviços"
        descricao={`Minuta para ${empresa?.nome ?? 'o cliente'}, com o conteúdo mínimo do art. 2º da Resolução CFC 1.590/2020. É ponto de partida: revise antes de assinar.`}
        acoes={
          <Link to="/documentos">
            <Botao variante="secundario">Voltar a Documentos</Botao>
          </Link>
        }
      />

      {msg && (
        <div className="mb-4">
          <Alerta tipo={msg.erro ? 'erro' : 'sucesso'}>{msg.texto}</Alerta>
        </div>
      )}

      <form onSubmit={form.handleSubmit(gerar)}>
        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            {Parte({ qual: 'contratada', titulo: 'Contratada (o escritório)' })}
            <Campo label="CRC" className="sm:col-span-1">
              <Input {...form.register('contratada.crc')} />
            </Campo>
            <div className="border-t border-slate-200 sm:col-span-6" />
            {Parte({ qual: 'contratante', titulo: 'Contratante (o cliente)' })}
          </div>
        </Card>

        <Card className="mb-4">
          <p className="mb-2 text-sm font-semibold text-slate-800">Serviços contratados</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(SERVICOS).map(([v, r]) => (
              <Marcador key={v} rotulo={r} value={v} {...form.register('servicos')} />
            ))}
          </div>
          {erros.servicos?.message && <p className="mt-1 text-xs text-red-600">{erros.servicos.message}</p>}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo label="Outro serviço permanente" className="sm:col-span-6" erro={erros.outrosServicos?.message}>
              <Input placeholder="Opcional" {...form.register('outrosServicos')} />
            </Campo>
            <Campo label="Algo mais a cargo do cliente" className="sm:col-span-5" dica="Já entram: emitir notas, controle financeiro, entregar documentos, pagar as guias, avisar admissões e alterações" erro={erros.obrigacoesDoContratante?.message}>
              <Textarea rows={2} placeholder="Opcional" {...form.register('obrigacoesDoContratante')} />
            </Campo>
            <Campo label="Documentos até o dia" className="sm:col-span-1" erro={erros.diaEntregaDocumentos?.message}>
              <Input inputMode="numeric" {...form.register('diaEntregaDocumentos')} />
            </Campo>
          </div>
        </Card>

        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo label="Honorário mensal (R$)" className="sm:col-span-2" erro={erros.honorarioMensal?.message} obrigatorio>
              <Input inputMode="decimal" {...form.register('honorarioMensal')} />
            </Campo>
            <Campo label="Vence no dia" className="sm:col-span-1" erro={erros.diaVencimento?.message}>
              <Input inputMode="numeric" {...form.register('diaVencimento')} />
            </Campo>
            <Campo label="Reajuste anual por" className="sm:col-span-3">
              <Select {...form.register('indiceReajuste')}>
                <option value="ipca">IPCA (IBGE)</option>
                <option value="inpc">INPC (IBGE)</option>
                <option value="igpm">IGP-M (FGV)</option>
              </Select>
            </Campo>
            <div className="sm:col-span-6">
              <Marcador rotulo="Cobrar um honorário adicional em dezembro (encerramento do exercício e rotinas anuais)" {...form.register('decimoTerceiroHonorario')} />
            </div>
            <Campo label="Início da vigência" className="sm:col-span-2" erro={erros.inicio?.message}>
              <Input type="date" {...form.register('inicio')} />
            </Campo>
            <Campo label="Duração (meses)" className="sm:col-span-2" dica="Em branco: prazo indeterminado" erro={erros.duracaoMeses?.message}>
              <Input inputMode="numeric" {...form.register('duracaoMeses')} />
            </Campo>
            <Campo label="Aviso prévio para rescindir (dias)" className="sm:col-span-2" erro={erros.avisoPrevioDias?.message}>
              <Input inputMode="numeric" {...form.register('avisoPrevioDias')} />
            </Campo>
            <Campo label="Foro (comarca)" className="sm:col-span-2" erro={erros.foro?.message} obrigatorio>
              <Input placeholder="Pouso Alegre/MG" {...form.register('foro')} />
            </Campo>
            <Campo label="Cidade da assinatura" className="sm:col-span-2" erro={erros.cidadeAssinatura?.message} obrigatorio>
              <Input {...form.register('cidadeAssinatura')} />
            </Campo>
            <Campo label="Data do contrato" className="sm:col-span-2" erro={erros.data?.message}>
              <Input type="date" {...form.register('data')} />
            </Campo>
          </div>
        </Card>

        <Botao type="submit" carregando={gerando}>
          <FileSignature className="h-4 w-4" /> Gerar a minuta em PDF
        </Botao>
        <p className="mt-2 text-xs text-slate-500">
          O texto cobre as alíneas "a" a "m" do art. 2º: partes, serviços, o que cabe ao cliente, duração, honorários, prazo, reajuste, responsabilidades, aditamento, Carta de Responsabilidade da Administração, ciência da Lei
          9.613/1998, rescisão com aviso prévio e foro — mais uma cláusula de LGPD. Não substitui a revisão de quem assina.
        </p>
      </form>
    </>
  )
}
