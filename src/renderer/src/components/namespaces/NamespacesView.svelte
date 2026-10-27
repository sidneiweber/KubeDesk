<script lang="ts">
  import type { NamespaceRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { nav } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'

  // Namespaces não têm namespace: a lista é sempre do cluster inteiro
  const namespaces = new LiveList('namespaces', () => ({ namespace: '' }))

  const current = $derived(namespaces.rows.find((n) => n.name === session.namespace)?.uid)

  function open(n: NamespaceRow) {
    session.namespace = n.name
    nav.section = 'pods'
  }

  const columns: Column<NamespaceRow>[] = [
    { key: 'name', label: 'Nome', sort: (n) => n.name, text: (n) => n.name },
    { key: 'status', label: 'Status', sort: (n) => n.status, cell: status },
    { key: 'labels', label: 'Labels', sort: (n) => Object.keys(n.labels).length, cell: labels },
    { key: 'age', label: 'Idade', sort: (n) => (n.created ? -n.created : null), text: (n) => formatAge(n.created, now.value) },
  ]
</script>

{#snippet status(n: NamespaceRow)}<StatusPill status={n.status} statusClass={n.statusClass} />{/snippet}
{#snippet labels(n: NamespaceRow)}
  {@const entries = Object.entries(n.labels)}
  <span class="labels" title={entries.map(([k, v]) => `${k}=${v}`).join('\n')}>
    {entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : '-'}
  </span>
{/snippet}

<ListPage title="Namespaces" namespace="">
  <ResourceTable
    rows={namespaces.rows}
    {columns}
    search={(n) => `${n.name} ${n.status} ${Object.entries(n.labels).flat().join(' ')}`}
    loading={namespaces.loading}
    error={namespaces.error}
    noun="namespaces"
    emptyText="Nenhum namespace visível"
    selected={current}
    onactivate={open}
  >
    {#snippet actions(n)}
      <button onclick={() => open(n)} aria-label="Ver pods de {n.name}">Ver pods</button>
    {/snippet}
  </ResourceTable>
</ListPage>

<style>
  .labels { color: var(--muted); display: inline-block; max-width: 520px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
</style>
