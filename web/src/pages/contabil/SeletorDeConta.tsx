import type { ComponentProps } from 'react'
import { Select } from '../../components/ui'
import type { Conta } from '../../lib/contabil'

/** Lista de contas analíticas agrupadas pelo grupo de primeiro nível do plano. */
export function SeletorDeConta({ contas, vazio = 'Escolha a conta…', filtro, ...props }: { contas: Conta[]; vazio?: string; filtro?: (c: Conta) => boolean } & ComponentProps<typeof Select>) {
  const raizes = contas.filter((c) => !c.codigo.includes('.'))
  const analiticas = contas.filter((c) => c.analitica && (!filtro || filtro(c)))
  return (
    <Select {...props}>
      <option value="">{vazio}</option>
      {raizes.map((r) => {
        const filhas = analiticas.filter((c) => c.codigo.startsWith(`${r.codigo}.`))
        if (!filhas.length) return null
        return (
          <optgroup key={r.codigo} label={r.nome}>
            {filhas.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.codigo} · {c.nome}
              </option>
            ))}
          </optgroup>
        )
      })}
    </Select>
  )
}
