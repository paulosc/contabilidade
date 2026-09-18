import { useState } from 'react'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../auth/AuthProvider'
import { Alerta, Botao, Campo, Input, Select } from '../components/ui'
import { formatCpfCnpj, formatTelefone, somenteDigitos, validarCnpj } from '../lib/utils'
import { UFS } from '../lib/fiscal'
import { AuthLayout } from './auth/AuthLayout'
import { db } from '../lib/firebase'
import { CartaoCnpjUpload, cadastroDoCartao, type CartaoCnpj } from '../components/CartaoCnpjUpload'

const schema = z.object({
  nome: z.string().min(2, 'Informe o nome da empresa'),
  // o CNPJ é o que será consultado na SEFAZ, então aqui ele é obrigatório
  cnpj: z.string().refine((v) => validarCnpj(v), 'CNPJ inválido'),
  uf: z.enum(UFS, { message: 'Escolha a UF' }),
  inscricaoEstadual: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
})
type Form = z.infer<typeof schema>

export function Onboarding({ adicional = false }: { adicional?: boolean } = {}) {
  const { criarEmpresa, user, sair } = useAuth()
  const navigate = useNavigate()
  const [erro, setErro] = useState<string | null>(null)
  const [cartao, setCartao] = useState<CartaoCnpj | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: user?.email ?? '', uf: 'MG' },
  })

  /** Preenche o formulário com o que o comprovante do CNPJ traz; a pessoa ainda confere antes de criar. */
  function aplicarCartao(c: CartaoCnpj) {
    setCartao(c)
    setValue('nome', c.razaoSocial, { shouldValidate: true })
    setValue('cnpj', formatCpfCnpj(c.cnpj), { shouldValidate: true })
    if (c.endereco.uf && (UFS as readonly string[]).includes(c.endereco.uf)) setValue('uf', c.endereco.uf as Form['uf'], { shouldValidate: true })
    if (c.telefone) setValue('telefone', formatTelefone(c.telefone))
    if (c.email) setValue('email', c.email, { shouldValidate: true })
  }

  async function onSubmit(dados: Form) {
    setErro(null)
    try {
      // os dados do comprovante só valem se o CNPJ do formulário ainda for o dele
      const doCartao = cartao && cartao.cnpj === somenteDigitos(dados.cnpj) ? cartao : null
      const empresaId = await criarEmpresa({
        ...(doCartao ? { ...(doCartao.nomeFantasia ? { nomeFantasia: doCartao.nomeFantasia } : {}), endereco: doCartao.endereco, cadastro: cadastroDoCartao(doCartao) } : {}),
        nome: dados.nome.trim(),
        cnpj: somenteDigitos(dados.cnpj),
        uf: dados.uf,
        inscricaoEstadual: dados.inscricaoEstadual?.trim() || undefined,
        telefone: dados.telefone ? somenteDigitos(dados.telefone) : undefined,
        email: dados.email?.trim() || undefined,
      })
      // o início de atividade já adianta o perfil fiscal (é o que decide a proporcionalização do Simples)
      if (doCartao?.dataAbertura) {
        await setDoc(doc(db, 'empresas', empresaId, 'configuracoes', 'perfilFiscal'), { inicioAtividade: doCartao.dataAbertura.slice(0, 7), atualizadoEm: serverTimestamp() }, { merge: true }).catch(() => undefined)
      }
      navigate('/', { replace: true })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar a empresa.')
    }
  }

  return (
    <AuthLayout
      titulo={adicional ? 'Adicionar empresa' : 'Cadastre sua empresa'}
      subtitulo={adicional ? 'O escritório passa a administrar mais esta empresa' : 'É o CNPJ dela que será consultado na SEFAZ'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {erro && <Alerta>{erro}</Alerta>}

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <p className="mb-2 text-sm text-slate-600">
            Tem o <strong>cartão CNPJ</strong> em PDF (Comprovante de Inscrição e de Situação Cadastral, do site da Receita)? Envie e o cadastro se preenche sozinho.
          </p>
          <CartaoCnpjUpload aoLer={aplicarCartao} aoErro={setErro} />
          {cartao && (
            <p className="mt-2 text-xs text-emerald-700">
              Lido: {cartao.razaoSocial}
              {cartao.cnaePrincipal ? ` · ${cartao.cnaePrincipal.codigo} ${cartao.cnaePrincipal.descricao}` : ''}
              {cartao.endereco.cidade ? ` · ${cartao.endereco.cidade}/${cartao.endereco.uf ?? ''}` : ''}
              {cartao.situacaoCadastral ? ` · situação ${cartao.situacaoCadastral.toLowerCase()}` : ''}. Confira abaixo antes de criar.
            </p>
          )}
        </div>

        <Campo label="Razão social" erro={errors.nome?.message} obrigatorio>
          <Input autoFocus placeholder="Minha Empresa Ltda" {...register('nome')} />
        </Campo>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo label="CNPJ" erro={errors.cnpj?.message} className="sm:col-span-2" obrigatorio>
            <Input
              inputMode="numeric"
              placeholder="00.000.000/0001-00"
              {...register('cnpj')}
              onChange={(e) => setValue('cnpj', formatCpfCnpj(e.target.value), { shouldValidate: true })}
            />
          </Campo>
          <Campo label="UF" erro={errors.uf?.message}>
            <Select {...register('uf')}>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Campo>
        </div>

        <Campo label="Inscrição estadual" erro={errors.inscricaoEstadual?.message} dica="Opcional">
          <Input {...register('inscricaoEstadual')} />
        </Campo>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Telefone" erro={errors.telefone?.message}>
            <Input
              inputMode="tel"
              placeholder="(31) 99999-9999"
              {...register('telefone')}
              onChange={(e) => setValue('telefone', formatTelefone(e.target.value))}
            />
          </Campo>
          <Campo label="E-mail" erro={errors.email?.message}>
            <Input type="email" {...register('email')} />
          </Campo>
        </div>

        <Botao type="submit" carregando={isSubmitting} className="mt-2 w-full">
          {adicional ? 'Adicionar empresa' : 'Criar empresa e entrar'}
        </Botao>

        {adicional ? (
          <button type="button" onClick={() => navigate('/', { replace: true })} className="text-center text-sm text-slate-500 hover:underline">
            Cancelar
          </button>
        ) : (
          <button type="button" onClick={() => void sair()} className="text-center text-sm text-slate-500 hover:underline">
            Sair desta conta
          </button>
        )}
      </form>
    </AuthLayout>
  )
}
