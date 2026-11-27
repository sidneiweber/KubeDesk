<script lang="ts" module>
  export interface ResourceDetails<Row> {
    /** undefined = removido do cluster (ou ainda carregando). */
    row: Row | undefined
    loading: boolean
    onback: () => void
  }
</script>

<script lang="ts" generics="K extends StorageKind">
  import type { Snippet } from 'svelte'
  import type { StorageKind, WatchRows } from '@shared/api'
  import IconButton from './IconButton.svelte'
  import ListPage from './ListPage.svelte'
  import ResourceTable, { type Column } from './table/ResourceTable.svelte'
  import { formatAge } from '../lib/formatAge'
  import { LiveList } from '../lib/liveList.svelte'
  import { followTarget } from '../lib/nav.svelte'
  import { now } from '../lib/now.svelte'
  import { session } from '../lib/session.svelte'
  import { openYaml } from '../lib/yaml.svelte'

  // Tela de um recurso sem ações próprias: tabela ao vivo com nome,
  // namespace (quando cabe) e idade, mais a página de detalhe. As colunas
  // específicas vêm de fora.

  type R = WatchRows[K]

  let { kind, clusterScoped = false, columns, search, noun, emptyText, details }: {
    kind: K
    /** Recurso do cluster: ignora o namespace escolhido. */
    clusterScoped?: boolean
    /** Colunas entre o nome (e namespace) e a idade. */
    columns: Column<R>[]
    search: (row: R) => string
    noun: string
    emptyText: string
    details: Snippet<[ResourceDetails<R>]>
  } = $props()

  // svelte-ignore state_referenced_locally
  const list = new LiveList(kind, () => ({ namespace: clusterScoped ? '' : session.namespace }))

  let openUid = $state<string | null>(null)
  const opened = $derived(list.get(openUid))
  // Pode chegar aberto vindo de outra tela (ex.: o PV de um PVC)
  followTarget(list, (uid) => (openUid = uid))

  // Trocar de namespace volta para a lista (só onde o namespace importa)
  let lastNamespace = session.namespace
  $effect(() => {
    if (session.namespace !== lastNamespace) {
      lastNamespace = session.namespace
      if (!clusterScoped) openUid = null
    }
  })

  const menu = (r: R) => [
    { label: 'Detalhes', action: () => (openUid = r.uid) },
    { label: 'YAML', action: () => openYaml(kind, r.namespace, r.name) },
  ]

  const allColumns: Column<R>[] = $derived([
    { key: 'name', label: 'Nome', sort: (r) => r.name, text: (r) => r.name, link: true },
    ...(!clusterScoped && session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (r: R) => r.namespace, text: (r: R) => r.namespace }]
      : []),
    ...columns,
    { key: 'age', label: 'Idade', sort: (r) => (r.created ? -r.created : null), text: (r) => formatAge(r.created, now.value), mono: true },
  ])
</script>

{#if openUid}
  {@render details({ row: opened, loading: list.loading, onback: () => (openUid = null) })}
{:else}
  <ListPage>
    <ResourceTable
      id={kind}
      {menu}
      rows={list.rows}
      columns={allColumns}
      {search}
      loading={list.loading}
      error={list.error}
      {noun}
      {emptyText}
      onactivate={(r) => (openUid = r.uid)}
    >
      {#snippet actions(r)}
        <IconButton icon="details" label="Detalhes de {r.name}" onclick={() => (openUid = r.uid)} />
        <IconButton icon="yaml" label="YAML de {r.name}" onclick={() => openYaml(kind, r.namespace, r.name)} />
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}
