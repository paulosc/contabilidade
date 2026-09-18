import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Plus, Save, UserRound, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { atualizarDoc, criarDoc } from '../../services/firestore'
import { Alerta, Badge, Botao, Campo, Card, Input, Select } from '../../components/ui'
import { formatBRL, formatCpfCnpj, somenteDigitos, validarCpf } from '../../lib/utils'
import { CATEGORIAS_ESOCIAL, TIPOS_TRABALHADOR, paraNumero } from '../../lib/folha'
import type { ComId, Funcionario } from '../../types'

const esquema = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo'),
  cpf: z.string().refine((v) => validarCpf(v), 'CPF inválido'),
  dataNascimento: z.string(),
  tipo: z.enum(['empregado', 'aprendiz', 'prolabore']),
  cargo: z.string().trim().min(2, 'Informe o cargo'),
  cbo: z.string().trim().regex(/^\d{0,6}$/, 'CBO tem 6 dígitos'),
  salarioBase: z.string().refine((v) => paraNumero(v) > 0, 'Informe o salário ou pró-labore'),
  dataAdmissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data'),
  dataDesligamento: z.string(),
  dependentesIrrf: z.string().regex(/^\d{1,2}$/, 'Número de dependentes'),
  matricula: z.string().trim().max(30),
  ativo: z.boolean(),
})
type Form = z.infer<typeof esquema>

const vazio: Form = {
  nome: '',
  cpf: '',
  dataNascimento: '',
  tipo: 'empregado',
  cargo: '',
  cbo: '',
  salarioBase: '',
  dataAdmissao: '',
  dataDesligamento: '',
  dependentesIrrf: '0',
  matricula: '',
  ativo: true,
}

export function FuncionariosCard({ funcionarios }: { funcionarios: ComId<Funcionario>[] }) {
  const { empresa } = useAuth()
  const [editando, setEditando] = useState<string | 'novo' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(esquema), defaultValues: vazio })
  const tipo = watch('tipo')

  function abrir(f?: ComId<Funcionario>) {
    setErro(null)
    setEditando(f ? f.id : 'novo')
    reset(
      f
        ? {
            nome: f.nome,
            cpf: formatCpfCnpj(f.cpf),
            dataNascimento: f.dataNascimento ?? '',
            tipo: f.tipo,
            cargo: f.cargo,
            cbo: f.cbo ?? '',
            salarioBase: f.salarioBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
            dataAdmissao: f.dataAdmissao,
            dataDesligamento: f.dataDesligamento ?? '',
            dependentesIrrf: String(f.dependentesIrrf ?? 0),
            matricula: f.matricula ?? '',
            ativo: f.ativo !== false,
          }
        : vazio,
    )
  }

  async function salvar(v: Form) {
    if (!empresa) return
    setErro(null)
    const dados = {
      nome: v.nome,
      cpf: somenteDigitos(v.cpf),
      dataNascimento: v.dataNascimento || null,
      tipo: v.tipo,
      cargo: v.cargo,
      cbo: v.cbo || null,
      salarioBase: paraNumero(v.salarioBase),
      dataAdmissao: v.dataAdmissao,
      dataDesligamento: v.dataDesligamento || null,
      dependentesIrrf: Number(v.dependentesIrrf),
      matricula: v.matricula || null,
      // categoria do eSocial acompanha o tipo; o contador pode refinar depois
      categoriaEsocial: v.tipo === 'aprendiz' ? 103 : v.tipo === 'prolabore' ? 723 : 101,
      ativo: v.ativo,
    }
    try {
      if (editando === 'novo') await criarDoc(empresa.id, 'funcionarios', dados)
      else if (editando) await atualizarDoc(empresa.id, 'funcionarios', editando, dados)
      setEditando(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <UserRound className="h-4 w-4" /> Funcionários e sócios
        </h2>
        {!editando && (
          <Botao tamanho="sm" onClick={() => abrir()}>
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Botao>
        )}
      </div>

      {erro && (
        <div className="mb-3">
          <Alerta tipo="erro">{erro}</Alerta>
        </div>
      )}

      {editando ? (
        <form onSubmit={handleSubmit(salvar)} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <Campo label="Nome completo" className="sm:col-span-4" erro={errors.nome?.message} obrigatorio>
            <Input {...register('nome')} />
          </Campo>
          <Campo label="CPF" className="sm:col-span-2" erro={errors.cpf?.message} obrigatorio>
            <Input inputMode="numeric" {...register('cpf')} onChange={(e) => setValue('cpf', formatCpfCnpj(e.target.value), { shouldValidate: true })} />
          </Campo>
          <Campo label="Vínculo" className="sm:col-span-2" dica={`eSocial: ${CATEGORIAS_ESOCIAL[tipo]}`}>
            <Select {...register('tipo')}>
              {Object.entries(TIPOS_TRABALHADOR).map(([c, t]) => (
                <option key={c} value={c}>
                  {t}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo label="Cargo" className="sm:col-span-3" erro={errors.cargo?.message} obrigatorio>
            <Input {...register('cargo')} />
          </Campo>
          <Campo label="CBO" className="sm:col-span-1" erro={errors.cbo?.message}>
            <Input inputMode="numeric" {...register('cbo')} />
          </Campo>
          <Campo label={tipo === 'prolabore' ? 'Pró-labore (R$)' : 'Salário base (R$)'} className="sm:col-span-2" erro={errors.salarioBase?.message} obrigatorio>
            <Input inputMode="decimal" placeholder="3.000,00" {...register('salarioBase')} />
          </Campo>
          <Campo label="Admissão" className="sm:col-span-2" erro={errors.dataAdmissao?.message} obrigatorio>
            <Input type="date" {...register('dataAdmissao')} />
          </Campo>
          <Campo label="Desligamento" className="sm:col-span-2">
            <Input type="date" {...register('dataDesligamento')} />
          </Campo>
          <Campo label="Nascimento" className="sm:col-span-2">
            <Input type="date" {...register('dataNascimento')} />
          </Campo>
          <Campo label="Dependentes (IRRF)" className="sm:col-span-2" erro={errors.dependentesIrrf?.message}>
            <Input inputMode="numeric" {...register('dependentesIrrf')} />
          </Campo>
          <Campo label="Matrícula no eSocial" className="sm:col-span-2" dica="A mesma já enviada ao eSocial, se houver">
            <Input {...register('matricula')} />
          </Campo>
          <div className="flex items-center gap-2 sm:col-span-6">
            <input id="ativo" type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register('ativo')} />
            <label htmlFor="ativo" className="text-sm text-slate-700">
              Ativo (entra no cálculo da folha)
            </label>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-6">
            <Botao type="submit" tamanho="sm" carregando={isSubmitting}>
              <Save className="h-3.5 w-3.5" /> Salvar
            </Botao>
            <Botao type="button" tamanho="sm" variante="secundario" onClick={() => setEditando(null)}>
              <X className="h-3.5 w-3.5" /> Cancelar
            </Botao>
          </div>
        </form>
      ) : funcionarios.length === 0 ? (
        <p className="text-sm text-slate-500">Cadastre os funcionários e os sócios com pró-labore para calcular a folha.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {funcionarios.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{f.nome}</p>
                <p className="truncate text-xs text-slate-500">
                  {f.cargo} · {formatCpfCnpj(f.cpf)} · admissão {f.dataAdmissao.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tom={f.tipo === 'prolabore' ? 'roxo' : f.tipo === 'aprendiz' ? 'azul' : 'neutro'}>{TIPOS_TRABALHADOR[f.tipo]}</Badge>
                {f.ativo === false && <Badge tom="amarelo">Inativo</Badge>}
                <span className="text-sm font-medium whitespace-nowrap">{formatBRL(f.salarioBase)}</span>
                <button onClick={() => abrir(f)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Editar">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
