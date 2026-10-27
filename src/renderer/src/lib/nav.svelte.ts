export type Section = 'pods' | 'deployments' | 'namespaces' | 'services' | 'ingresses' | 'endpoints'

// Seção aberta. Fica fora do App para que uma tela possa levar a outra
// (ex.: abrir um namespace leva aos pods dele).
class Nav {
  section = $state<Section>('pods')
}

export const nav = new Nav()
