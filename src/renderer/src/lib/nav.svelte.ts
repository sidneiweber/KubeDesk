import type { WorkloadKind } from '@shared/api'

export type Section = 'overview' | 'pods' | WorkloadKind | 'namespaces' | 'services' | 'ingresses' | 'endpoints' | 'configmaps' | 'secrets' | 'hpas'
  | 'pvs' | 'pvcs' | 'volumeattachments' | 'storageclasses' | 'csidrivers' | 'csinodes'

// Seção aberta. Fica fora do App para que uma tela possa levar a outra
// (ex.: abrir um namespace leva aos pods dele).
class Nav {
  section = $state<Section>('overview')
  /** Muda a cada entrada numa seção; o App recria a tela quando muda. */
  visit = $state(0)
  /** Recurso a abrir direto nos detalhes ao entrar na seção (lido uma vez pela tela). */
  target = $state<{ namespace: string; name: string } | null>(null)

  /**
   * Entra numa seção. Clicar de novo na seção que já está aberta também
   * conta: volta para a lista, saindo dos detalhes.
   */
  go(section: Section, target: { namespace: string; name: string } | null = null): void {
    this.target = target
    this.section = section
    this.visit++
  }

  /** Pega o alvo pendente (e limpa, para não reabrir ao voltar à lista). */
  takeTarget(): { namespace: string; name: string } | null {
    const t = this.target
    this.target = null
    return t
  }
}

export const nav = new Nav()

/**
 * Abre os detalhes do alvo pendente assim que ele aparece na lista (ex.: o
 * Deployment de um HPA). Chamar na inicialização do componente.
 */
export function followTarget<R extends { uid: string; namespace: string; name: string }>(
  list: { rows: R[]; loading: boolean },
  open: (uid: string) => void,
): void {
  let pending = $state(nav.takeTarget())
  $effect(() => {
    if (!pending) return
    const t = pending
    const found = list.rows.find((r) => r.namespace === t.namespace && r.name === t.name)
    if (found) {
      open(found.uid)
      pending = null
    } else if (!list.loading) {
      pending = null
    }
  })
}
