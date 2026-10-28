export type Section = 'pods' | 'deployments' | 'namespaces' | 'services' | 'ingresses' | 'endpoints'

// Seção aberta. Fica fora do App para que uma tela possa levar a outra
// (ex.: abrir um namespace leva aos pods dele).
class Nav {
  section = $state<Section>('pods')
  /** Muda a cada entrada numa seção; o App recria a tela quando muda. */
  visit = $state(0)

  /**
   * Entra numa seção. Clicar de novo na seção que já está aberta também
   * conta: volta para a lista, saindo dos detalhes.
   */
  go(section: Section): void {
    this.section = section
    this.visit++
  }
}

export const nav = new Nav()
