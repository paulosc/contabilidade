import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/firebase'
import { useColecao } from '../services/firestore'
import { Alerta, Botao, CabecalhoPagina, Campo, Card, Input, Select } from '../components/ui'
import { formatCpfCnpj, formatData, formatTelefone, somenteDigitos, validarCnpj } from '../lib/utils'
import { UFS } from '../lib/fiscal'
import { FiscalCard } from './configuracoes/FiscalCard'
import { ImportacaoMunicipalCard } from './configuracoes/ImportacaoMunicipalCard'
import { EquipeCard } from './configuracoes/EquipeCard'
import { CartaoCnpjUpload, cadastroDoCartao, type CartaoCnpj } from '../components/CartaoCnpjUpload'
import { OPERACOES_AUDITADAS, type RegistroAuditoria } from '../types'

const schema = z.object({
  nome: z.string().min(2, 'Informe o nome'),
  cnpj: z.string().refine((v) => validarCnpj(v), 'CNPJ inválido'),
  uf: z.enum(UFS, { message: 'Escolha a UF' }),
  inscricaoEstadual: z.string(),
  telefone: z.string(),
  email: z.string().email('E-mail inválido').or(z.literal('')),
})
type Form = z.infer<typeof schema>

export function Configuracoes() {
  const { empresa, membro } = useAuth()
  const ehAdmin = membro?.papel === 'admin'
  const auditoria = useColecao<RegistroAuditoria>('auditoriaFiscal')
  const [msg, setMsg] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!empresa) return
    reset({
      nome: empresa.nome,
      cnpj: empresa.cnpj ? formatCpfCnpj(empresa.cnpj) : '',
      uf: (empresa.uf as Form['uf']) ?? 'MG',
      inscricaoEstadual: empresa.inscricaoEstadual ?? '',
      telefone: empresa.telefone ? formatTelefone(empresa.telefone) : '',
      email: empresa.email ?? '',
    })
  }, [empresa, reset])

  async function salvar(dados: Form) {
    if (!empresa) return
    setMsg(null)
    try {
      await updateDoc(doc(db, 'empresas', empresa.id), {
        nome: dados.nome.trim(),
        cnpj: somenteDigitos(dados.cnpj),
        uf: dados.uf,
        inscricaoEstadual: dados.inscricaoEstadual.trim(),
        telefone: somenteDigitos(dados.telefone),
        email: dados.email.trim(),
        atualizadoEm: serverTimestamp(),
      })
      setMsg({ tipo: 'sucesso', texto: 'Dados da empresa salvos.' })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível salvar.' })
    }
  }

  /** Completa o cadastro com o comprovante do CNPJ — só se for o da própria empresa. */
  async function aplicarCartao(c: CartaoCnpj) {
    if (!empresa) return
    if (c.cnpj !== somenteDigitos(empresa.cnpj ?? '')) {
      setMsg({ tipo: 'erro', texto: `Este comprovante é do CNPJ ${formatCpfCnpj(c.cnpj)}, não o desta empresa (${formatCpfCnpj(empresa.cnpj ?? '')}). Nada foi alterado.` })
      return
    }
    try {
      await updateDoc(doc(db, 'empresas', empresa.id), {
        nome: c.razaoSocial,
        ...(c.nomeFantasia ? { nomeFantasia: c.nomeFantasia } : {}),
        ...(c.endereco.uf ? { uf: c.endereco.uf } : {}),
        ...(c.telefone ? { telefone: c.telefone } : {}),
        ...(c.email ? { email: c.email } : {}),
        endereco: c.endereco,
        cadastro: cadastroDoCartao(c),
        atualizadoEm: serverTimestamp(),
      })
      setMsg({ tipo: 'sucesso', texto: 'Cadastro atualizado com os dados do comprovante do CNPJ.' })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível atualizar.' })
    }
  }

  const registros = [...auditoria.dados]
    .sort((a, b) => (b.criadoEm?.toMillis?.() ?? 0) - (a.criadoEm?.toMillis?.() ?? 0))
    .slice(0, 15)

  return (
    <>
      <CabecalhoPagina titulo="Configurações" descricao="Dados da empresa, integração fiscal e equipe." />

      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-1 text-base font-semibold">Dados da empresa</h2>
          <p className="mb-4 text-sm text-slate-500">
            O CNPJ informado aqui é o que será consultado na SEFAZ. Ele precisa ter a mesma raiz do CNPJ do certificado digital.
          </p>
          {msg && (
            <div className="mb-3">
              <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>
            </div>
          )}
          <form onSubmit={handleSubmit(salvar)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <Campo label="Razão social" className="sm:col-span-4" erro={errors.nome?.message} obrigatorio>
              <Input {...register('nome')} disabled={!ehAdmin} />
            </Campo>
            <Campo label="UF" className="sm:col-span-2" erro={errors.uf?.message}>
              <Select {...register('uf')} disabled={!ehAdmin}>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo label="CNPJ" className="sm:col-span-3" erro={errors.cnpj?.message} obrigatorio>
              <Input
                inputMode="numeric"
                {...register('cnpj')}
                disabled={!ehAdmin}
                onChange={(e) => setValue('cnpj', formatCpfCnpj(e.target.value), { shouldValidate: true })}
              />
            </Campo>
            <Campo label="Inscrição estadual" className="sm:col-span-3" erro={errors.inscricaoEstadual?.message}>
              <Input {...register('inscricaoEstadual')} disabled={!ehAdmin} />
            </Campo>
            <Campo label="Telefone" className="sm:col-span-3" erro={errors.telefone?.message}>
              <Input
                {...register('telefone')}
                disabled={!ehAdmin}
                onChange={(e) => setValue('telefone', formatTelefone(e.target.value))}
              />
            </Campo>
            <Campo label="E-mail" className="sm:col-span-3" erro={errors.email?.message}>
              <Input type="email" {...register('email')} disabled={!ehAdmin} />
            </Campo>
            {ehAdmin && (
              <div className="flex flex-wrap gap-2 sm:col-span-6">
                <Botao type="submit" carregando={isSubmitting}>
                  Salvar dados
                </Botao>
                <CartaoCnpjUpload rotulo="Atualizar pelo cartão CNPJ (PDF)" aoLer={(c) => void aplicarCartao(c)} aoErro={(m) => setMsg(m ? { tipo: 'erro', texto: m } : null)} />
              </div>
            )}
          </form>

          {empresa?.cadastro ? (
            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-200 pt-4 text-sm sm:grid-cols-2">
              {empresa.nomeFantasia && (
                <div>
                  <dt className="text-xs text-slate-500">Nome de fantasia</dt>
                  <dd className="text-slate-900">{empresa.nomeFantasia}</dd>
                </div>
              )}
              {empresa.cadastro.dataAbertura && (
                <div>
                  <dt className="text-xs text-slate-500">Abertura · porte</dt>
                  <dd className="text-slate-900">
                    {empresa.cadastro.dataAbertura.split('-').reverse().join('/')}
                    {empresa.cadastro.porte ? ` · ${empresa.cadastro.porte}` : ''}
                  </dd>
                </div>
              )}
              {empresa.cadastro.naturezaJuridica && (
                <div>
                  <dt className="text-xs text-slate-500">Natureza jurídica</dt>
                  <dd className="text-slate-900">
                    {empresa.cadastro.naturezaJuridica.codigo} · {empresa.cadastro.naturezaJuridica.descricao}
                  </dd>
                </div>
              )}
              {empresa.cadastro.situacaoCadastral && (
                <div>
                  <dt className="text-xs text-slate-500">Situação cadastral</dt>
                  <dd className="text-slate-900">{empresa.cadastro.situacaoCadastral}</dd>
                </div>
              )}
              {empresa.endereco?.logradouro && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Endereço</dt>
                  <dd className="text-slate-900">
                    {[empresa.endereco.logradouro, empresa.endereco.numero, empresa.endereco.complemento, empresa.endereco.bairro, empresa.endereco.cidade && `${empresa.endereco.cidade}/${empresa.endereco.uf ?? ''}`, empresa.endereco.cep?.replace(/^(\d{5})(\d{3})$/, '$1-$2')]
                      .filter(Boolean)
                      .join(', ')}
                  </dd>
                </div>
              )}
              {empresa.cadastro.cnaePrincipal && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Atividade principal (CNAE)</dt>
                  <dd className="text-slate-900">
                    {empresa.cadastro.cnaePrincipal.codigo} · {empresa.cadastro.cnaePrincipal.descricao}
                  </dd>
                </div>
              )}
              {(empresa.cadastro.cnaesSecundarios?.length ?? 0) > 0 && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Atividades secundárias</dt>
                  <dd className="text-slate-700">
                    {empresa.cadastro.cnaesSecundarios!.map((a) => (
                      <span key={a.codigo} className="block">
                        {a.codigo} · {a.descricao}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              {empresa.cadastro.emitidoEm && <p className="text-xs text-slate-500 sm:col-span-2">Dados do comprovante do CNPJ emitido em {empresa.cadastro.emitidoEm.split('-').reverse().join('/')}.</p>}
            </dl>
          ) : (
            ehAdmin && <p className="mt-4 text-xs text-slate-500">Envie o cartão CNPJ em PDF (Comprovante de Inscrição e de Situação Cadastral, do site da Receita) para completar endereço, atividades (CNAE), natureza jurídica e data de abertura.</p>
          )}
        </Card>

        <FiscalCard />
        <ImportacaoMunicipalCard />

        <EquipeCard />

        {ehAdmin && (
          <Card>
            <h2 className="mb-1 text-base font-semibold">Auditoria fiscal</h2>
            <p className="mb-4 text-sm text-slate-500">
              Registro de quem mexeu no certificado, testou a conexão, sincronizou ou baixou XML.
            </p>
            {registros.length === 0 ? (
              <p className="text-sm text-slate-500">Nada registrado ainda.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {registros.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">{OPERACOES_AUDITADAS[r.operacao] ?? r.operacao}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.email ?? r.uid}
                        {r.detalhe ? ` · ${r.detalhe}` : ''}
                      </p>
                    </div>
                    <span className="text-xs whitespace-nowrap text-slate-500">{formatData(r.criadoEm)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  )
}
