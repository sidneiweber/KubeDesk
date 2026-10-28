export type Section = 'pods' | 'deployments' | 'namespaces' | 'services' | 'ingresses' | 'endpoints'

// Seção aberta. Fica fora do App para que uma tela possa levar a outra
// (ex.: abrir um namespace leva aos pods dele).
class Nav {
  section = $state<Section>('pods')
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
