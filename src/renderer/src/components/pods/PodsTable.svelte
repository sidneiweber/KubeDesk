<script lang="ts">
  import IconButton from '../IconButton.svelte'
  import type { PodRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { readyFraction } from '../../lib/sort'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import UsageCell from '../table/UsageCell.svelte'
  import { PodMetrics } from '../../lib/podMetrics.svelte'
  import { formatCpu, formatMemory } from '../../lib/usage'
  import DeletePodDialog from './DeletePodDialog.svelte'
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
  const metrics = new PodMetrics(() => namespace)
  // Motivo de não haver métricas; vazio enquanto não se sabe ou quando há
  const unavailable = $derived(metrics.available === false ? metrics.reason : '')

  let deleting = $state<PodRow | null>(null)

  const menu = (p: PodRow) => [
    { label: 'Logs', action: () => onlogs(p) },
    { label: 'YAML', action: () => openYaml('pods', p.namespace, p.name) },
    { label: 'Apagar pod…', action: () => (deleting = p), danger: true },
  ]

  const columns: Column<PodRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (p) => p.name, text: (p) => p.name },
    ...(namespace === '' ? [{ key: 'namespace', label: 'Namespace', sort: (p: PodRow) => p.namespace, text: (p: PodRow) => p.namespace }] : []),
    { key: 'status', label: 'Status', sort: (p) => p.status, cell: status },
    { key: 'ready', label: 'Ready', sort: (p) => readyFraction(p.ready), text: (p) => p.ready, mono: true },
    { key: 'restarts', label: 'Restarts', sort: (p) => p.restarts, cell: restarts, mono: true },
    { key: 'cpu', label: 'CPU', sort: (p) => metrics.of(p.namespace, p.name)?.cpu ?? null, cell: cpu, mono: true },
    { key: 'memory', label: 'Memória', sort: (p) => metrics.of(p.namespace, p.name)?.memory ?? null, cell: memory, mono: true },
    { key: 'node', label: 'Node', sort: (p) => p.node, text: (p) => p.node || '-', muted: true },
    { key: 'ip', label: 'IP', sort: (p) => p.ip, text: (p) => p.ip || '-', muted: true, hidden: true, mono: true },
    { key: 'owner', label: 'Controlado por', sort: (p) => p.owner, text: (p) => p.owner || '-', muted: true, hidden: true },
    // Idade crescente = mais novo primeiro
    { key: 'age', label: 'Idade', sort: (p) => (p.created ? -p.created : null), text: (p) => formatAge(p.created, now.value), mono: true },
  ])
</script>

{#snippet status(p: PodRow)}<StatusPill status={p.status} statusClass={p.statusClass} />{/snippet}
{#snippet restarts(p: PodRow)}<span class:warn={p.restarts > 0}>{p.restarts}</span>{/snippet}
{#snippet cpu(p: PodRow)}
  <UsageCell used={metrics.of(p.namespace, p.name)?.cpu} request={p.cpuRequest} limit={p.cpuLimit} format={formatCpu} {unavailable} />
{/snippet}
{#snippet memory(p: PodRow)}
  <UsageCell used={metrics.of(p.namespace, p.name)?.memory} request={p.memoryRequest} limit={p.memoryLimit} format={formatMemory} {unavailable} />
{/snippet}

<ResourceTable
  id="pods"
  {menu}
  rows={pods.rows}
  {columns}
  search={(p) => `${p.name} ${p.status} ${p.node} ${p.ip}`}
  loading={pods.loading}
  error={pods.error}
  noun="pods"
  {emptyText}
  {selected}
  onactivate={onlogs}
>
  {#snippet toolbar()}
    {#if unavailable}<span class="notice" title={unavailable}>Métricas indisponíveis: {unavailable}</span>{/if}
  {/snippet}
  {#snippet actions(p)}
    <IconButton icon="logs" label="Logs de {p.name}" onclick={() => onlogs(p)} />
    <IconButton icon="yaml" label="YAML de {p.name}" onclick={() => openYaml('pods', p.namespace, p.name)} />
  {/snippet}
</ResourceTable>

{#if deleting}
  <DeletePodDialog pod={deleting} onclose={() => (deleting = null)} />
{/if}

<style>
  .warn { color: var(--pend); font-weight: 500; }
  .notice { font-size: 12px; color: var(--unk); background: var(--unk-bg); border-radius: 999px; padding: 3px 10px; }
</style>
