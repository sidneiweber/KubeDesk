<script lang="ts">
  import type { DeploymentRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import type { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { deployments, namespace, onopen, onscale, onrestart }: {
    deployments: LiveList<'deployments'>
    namespace: string
    onopen: (d: DeploymentRow) => void
    onscale: (d: DeploymentRow) => void
    onrestart: (d: DeploymentRow) => void
  } = $props()

  const menu = (d: DeploymentRow) => [
    { label: 'Detalhes', action: () => onopen(d) },
    { label: 'Escalar…', action: () => onscale(d) },
    { label: 'Reiniciar…', action: () => onrestart(d) },
    { label: 'YAML', action: () => openYaml('deployments', d.namespace, d.name) },
  ]

  const columns: Column<DeploymentRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (d) => d.name, text: (d) => d.name },
    ...(namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (d: DeploymentRow) => d.namespace, text: (d: DeploymentRow) => d.namespace }]
      : []),
    { key: 'status', label: 'Status', sort: (d) => d.status, cell: status },
    // Fração de prontos, como o Ready dos pods; desired 0 fica no fim
    { key: 'ready', label: 'Ready', sort: (d) => (d.desired ? d.ready / d.desired : null), text: (d) => `${d.ready}/${d.desired}` },
    { key: 'upToDate', label: 'Up-to-date', sort: (d) => d.upToDate, text: (d) => String(d.upToDate) },
    { key: 'available', label: 'Available', sort: (d) => d.available, text: (d) => String(d.available) },
    { key: 'age', label: 'Idade', sort: (d) => (d.created ? -d.created : null), text: (d) => formatAge(d.created, now.value) },
    { key: 'images', label: 'Imagens', sort: (d) => d.images.join(','), cell: images },
  ])
</script>

{#snippet status(d: DeploymentRow)}<StatusPill status={d.status} statusClass={d.statusClass} />{/snippet}
{#snippet images(d: DeploymentRow)}
  <span class="images" title={d.images.join('\n')}>
    {d.images[0] ?? '-'}{#if d.images.length > 1}<span class="more"> +{d.images.length - 1}</span>{/if}
  </span>
{/snippet}

<ResourceTable
  id="deployments"
  {menu}
  rows={deployments.rows}
  {columns}
  search={(d) => `${d.name} ${d.status} ${d.images.join(' ')}`}
  loading={deployments.loading}
  error={deployments.error}
  noun="deployments"
  emptyText="Nenhum deployment neste namespace"
  onactivate={onopen}
>
  {#snippet actions(d)}
    <button onclick={() => onopen(d)} aria-label="Detalhes de {d.name}">Detalhes</button>
    <button onclick={() => onscale(d)} aria-label="Escalar {d.name}">Escalar</button>
    <button onclick={() => onrestart(d)} aria-label="Reiniciar {d.name}">Reiniciar</button>
    <button onclick={() => openYaml('deployments', d.namespace, d.name)} aria-label="YAML de {d.name}">YAML</button>
  {/snippet}
</ResourceTable>

<style>
  .images { font-family: var(--mono); font-size: 12px; color: var(--muted); display: inline-block; max-width: 360px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .more { color: var(--accent); }
</style>
