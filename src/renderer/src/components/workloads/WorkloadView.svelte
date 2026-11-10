<script lang="ts" module>
  export interface DetailsContext<Row> {
    /** undefined = removido do cluster (ou ainda carregando). */
    row: Row | undefined
    loading: boolean
    onback: () => void
    onscale: () => void
    onrestart: () => void
  }
</script>

<script lang="ts" generics="K extends WorkloadKind">
  import type { Snippet } from 'svelte'
  import type { WatchRows, WorkloadKind } from '@shared/api'
  import IconButton from '../IconButton.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import type { MenuItem } from '../table/ContextMenu.svelte'
  import { LiveList } from '../../lib/liveList.svelte'
  import { nav } from '../../lib/nav.svelte'
  import { session } from '../../lib/session.svelte'
  import { openYaml } from '../../lib/yaml.svelte'
  import { isRollout, isScalable, WORKLOADS } from '../../lib/workloads'
  import ScaleDialog from './ScaleDialog.svelte'
  import RestartDialog from './RestartDialog.svelte'

  // Tela de um tipo de workload: tabela, página de detalhe e os diálogos de
  // escalar/reiniciar. Uma lista só, compartilhada por tabela e detalhes: os
  // detalhes ficam ao vivo sem abrir outro watch.

  type R = WatchRows[K]

  let { kind, columns, search, details, menu: extraMenu, rowActions }: {
    kind: K
    columns: Column<R>[]
    search: (row: R) => string
    details: Snippet<[DetailsContext<R>]>
    /** Itens a mais no menu de contexto. */
    menu?: (row: R) => MenuItem[]
    /** Botões a mais na linha. */
    rowActions?: Snippet<[R]>
  } = $props()

  // svelte-ignore state_referenced_locally
  const meta = WORKLOADS[kind]
  // svelte-ignore state_referenced_locally
  const list = new LiveList(kind, () => ({ namespace: session.namespace }))

  let detailsUid = $state<string | null>(null)
  let dialog = $state<{ kind: 'scale' | 'restart'; uid: string } | null>(null)

  // Pode chegar aberto vindo de outra tela (ex.: o dono de um ReplicaSet)
  let pending = $state(nav.takeTarget())
  $effect(() => {
    if (!pending) return
    const found = list.rows.find((r) => r.namespace === pending!.namespace && r.name === pending!.name)
    if (found) {
      detailsUid = found.uid
      pending = null
    } else if (!list.loading) {
      pending = null
    }
  })

  // Trocar de namespace volta para a lista
  let lastNamespace = session.namespace
  $effect(() => {
    const ns = session.namespace
    if (ns !== lastNamespace) {
      lastNamespace = ns
      detailsUid = null
    }
  })

  const details_ = $derived(list.get(detailsUid))
  const dialogTarget = $derived(list.get(dialog?.uid))

  const open = (r: R) => (detailsUid = r.uid)
  const scale = (r: R) => (dialog = { kind: 'scale', uid: r.uid })
  const restart = (r: R) => (dialog = { kind: 'restart', uid: r.uid })

  const menu = (r: R): MenuItem[] => [
    { label: 'Detalhes', action: () => open(r) },
    ...(meta.scalable ? [{ label: 'Escalar…', action: () => scale(r) }] : []),
    ...(meta.rollout ? [{ label: 'Reiniciar…', action: () => restart(r) }] : []),
    ...(extraMenu?.(r) ?? []),
    { label: 'YAML', action: () => openYaml(kind, r.namespace, r.name) },
  ]

  // Coluna de namespace só quando a lista mistura namespaces
  const allColumns = $derived<Column<R>[]>(
    session.namespace === ''
      ? [columns[0], { key: 'namespace', label: 'Namespace', sort: (r: R) => r.namespace, text: (r: R) => r.namespace }, ...columns.slice(1)]
      : columns,
  )
</script>

{#if detailsUid}
  {@render details({
    row: details_,
    loading: list.loading,
    onback: () => (detailsUid = null),
    onscale: () => details_ && scale(details_),
    onrestart: () => details_ && restart(details_),
  })}
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
      noun={meta.plural}
      emptyText="Nenhum {meta.label} neste namespace"
      onactivate={open}
    >
      {#snippet actions(r)}
        <IconButton icon="details" label="Detalhes de {r.name}" onclick={() => open(r)} />
        {#if meta.scalable}<IconButton icon="scale" label="Escalar {r.name}" onclick={() => scale(r)} />{/if}
        {#if meta.rollout}<IconButton icon="restart" label="Reiniciar {r.name}" onclick={() => restart(r)} />{/if}
        {@render rowActions?.(r)}
        <IconButton icon="yaml" label="YAML de {r.name}" onclick={() => openYaml(kind, r.namespace, r.name)} />
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}

{#if dialog && dialogTarget}
  {#if dialog.kind === 'scale' && isScalable(kind)}
    <ScaleDialog {kind} deployment={dialogTarget as unknown as WatchRows['deployments']} onclose={() => (dialog = null)} />
  {:else if dialog.kind === 'restart' && isRollout(kind)}
    <RestartDialog {kind} deployment={dialogTarget as unknown as WatchRows['deployments']} onclose={() => (dialog = null)} />
  {/if}
{/if}
