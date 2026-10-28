import type { PodUsage } from '@shared/api'

/**
 * Uso de CPU/memória dos pods de um namespace, atualizado a cada leitura do
 * metrics-server. Criar durante a inicialização de um componente, como a
 * LiveList.
 */
export class PodMetrics {
  usage = $state.raw(new Map<string, PodUsage>())
  /** null até a primeira resposta. */
  available = $state<boolean | null>(null)
  reason = $state('')

  constructor(namespace: () => string) {
    $effect(() => {
      const ns = namespace()
      this.usage = new Map()
      this.available = null
      return window.kube.watchPodMetrics(ns, (u) => {
        this.available = u.available
        this.reason = u.reason
        this.usage = new Map(u.items.map((i) => [i.key, i]))
      })
    })
  }

  of(namespace: string, name: string): PodUsage | undefined {
    return this.usage.get(`${namespace}/${name}`)
  }
}
