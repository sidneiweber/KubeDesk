<script lang="ts">
  import type { PodRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { readyFraction } from '../../lib/sort'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { namespace, labelSelector, selected, onlogs, emptyText = 'Nenhum pod neste namespace' }: {
    namespace: string
    /** Só os pods que casam com o seletor (ex.: os de um deployment). */
    labelSelector?: string
    selected?: string | null
    onlogs: (p: PodRow) => void
    emptyText?: string
  } = $props()

  const pods = new LiveList('pods', () => ({ namespace, labelSelector }))

  const columns: Column<PodRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (p) => p.name, text: (p) => p.name },
    ...(namespace === '' ? [{ key: 'namespace', label: 'Namespace', sort: (p: PodRow) => p.namespace, text: (p: PodRow) => p.namespace }] : []),
    { key: 'status', label: 'Status', sort: (p) => p.status, cell: status },
    { key: 'ready', label: 'Ready', sort: (p) => readyFraction(p.ready), text: (p) => p.ready },
    { key: 'restarts', label: 'Restarts', sort: (p) => p.restarts, cell: restarts },
    { key: 'node', label: 'Node', sort: (p) => p.node, text: (p) => p.node || '-', muted: true },
    // Idade crescente = mais novo primeiro
    { key: 'age', label: 'Idade', sort: (p) => (p.created ? -p.created : null), text: (p) => formatAge(p.created, now.value) },
  ])
</script>

{#snippet status(p: PodRow)}<StatusPill status={p.status} statusClass={p.statusClass} />{/snippet}
{#snippet restarts(p: PodRow)}<span class:warn={p.restarts > 0}>{p.restarts}</span>{/snippet}

<ResourceTable
  rows={pods.rows}
  {columns}
  search={(p) => `${p.name} ${p.status} ${p.node}`}
  loading={pods.loading}
  error={pods.error}
  noun="pods"
  {emptyText}
  {selected}
  onactivate={onlogs}
>
  {#snippet actions(p)}
    <button onclick={() => onlogs(p)} aria-label="Logs de {p.name}">Logs</button>
    <button onclick={() => openYaml('pods', p.namespace, p.name)} aria-label="YAML de {p.name}">YAML</button>
  {/snippet}
</ResourceTable>

<style>
  .warn { color: var(--pend); font-weight: 500; }
</style>
