import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/firebase'
import { useColecao } from '../services/firestore'
import { Alerta, Badge, Botao, CabecalhoPagina, Campo, Card, Input, Select } from '../components/ui'
import { formatCpfCnpj, formatData, formatTelefone, somenteDigitos, validarCnpj } from '../lib/utils'
import { UFS } from '../lib/fiscal'
import { FiscalCard } from './configuracoes/FiscalCard'
import { OPERACOES_AUDITADAS, PAPEIS, type Membro, type RegistroAuditoria } from '../types'

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
  const membros = useColecao<Membro>('membros')
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
              <div className="sm:col-span-6">
                <Botao type="submit" carregando={isSubmitting}>
                  Salvar dados
                </Botao>
              </div>
            )}
          </form>
        </Card>

        <FiscalCard />

        <Card>
          <h2 className="mb-1 text-base font-semibold">Equipe</h2>
          <p className="mb-4 text-sm text-slate-500">Quem tem acesso aos dados desta empresa.</p>
          <ul className="divide-y divide-slate-100">
            {membros.dados.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{m.nome}</p>
                  <p className="truncate text-xs text-slate-500">{m.email}</p>
                </div>
                <Badge tom={m.papel === 'admin' ? 'roxo' : 'neutro'}>{PAPEIS[m.papel]}</Badge>
              </li>
            ))}
          </ul>
        </Card>

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
