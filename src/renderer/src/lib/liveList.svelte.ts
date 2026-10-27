import type { WatchKind, WatchOptions, WatchRows } from '@shared/api'

/**
 * Lista de recursos acompanhando o cluster. Criar durante a inicialização de
 * um componente: o watch reabre quando as opções mudam e fecha quando o
 * componente sai da tela.
 *
 *   const pods = new LiveList('pods', () => ({ namespace }))
 */
export class LiveList<K extends WatchKind> {
  // $state.raw: o Map é trocado inteiro a cada lote, sem proxy em cada item
  items = $state.raw(new Map<string, WatchRows[K]>())
  rows = $derived([...this.items.values()])
  loading = $state(true)
  error = $state('')

  constructor(kind: K, options: () => WatchOptions | null) {
    $effect(() => {
      const opts = options()
      this.items = new Map()
      this.error = ''
      // null = nada a observar (ex.: seletor vazio)
      if (!opts) {
        this.loading = false
        return
      }
      this.loading = true

      return window.kube.watch(
        kind,
        opts,
        (b) => {
          const next = b.reset ? new Map<string, WatchRows[K]>() : new Map(this.items)
          for (const uid of b.deleted) next.delete(uid)
          for (const item of b.upsert) next.set(item.uid, item)
          this.items = next
          this.loading = false
          this.error = ''
        },
        (msg) => {
          this.error = msg
          this.loading = false
        },
      )
    })
  }

  get(uid: string | null | undefined): WatchRows[K] | undefined {
    return uid ? this.items.get(uid) : undefined
  }
}
