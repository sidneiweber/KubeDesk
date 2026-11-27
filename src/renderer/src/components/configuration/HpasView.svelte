<script lang="ts">
  import IconButton from '../IconButton.svelte'
  import type { HpaRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { followTarget } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import HpaDetails from './HpaDetails.svelte'
  import { metricsText } from './hpa'
  import { openYaml } from '../../lib/yaml.svelte'

  const hpas = new LiveList('hpas', () => ({ namespace: session.namespace }))

  let openUid = $state<string | null>(null)
  const opened = $derived(hpas.get(openUid))
  followTarget(hpas, (uid) => (openUid = uid))

  let lastNamespace = session.namespace
  $effect(() => {
    if (session.namespace !== lastNamespace) {
      lastNamespace = session.namespace
      openUid = null
    }
  })

  const menu = (h: HpaRow) => [
    { label: 'Detalhes', action: () => (openUid = h.uid) },
    { label: 'YAML', action: () => openYaml('hpas', h.namespace, h.name) },
  ]

  // Colunas do `kubectl get hpa`, mais o status
  const columns: Column<HpaRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (h) => h.name, text: (h) => h.name, link: true },
    ...(session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (h: HpaRow) => h.namespace, text: (h: HpaRow) => h.namespace }]
      : []),
    { key: 'status', label: 'Status', sort: (h) => h.status, cell: status },
    { key: 'target', label: 'Alvo', sort: (h) => `${h.target.kind}/${h.target.name}`, text: (h) => `${h.target.kind}/${h.target.name}` },
    { key: 'metrics', label: 'Métricas', sort: (h) => metricsText(h), cell: metrics, mono: true },
    { key: 'min', label: 'Mín', sort: (h) => h.minReplicas, text: (h) => String(h.minReplicas), mono: true },
    { key: 'max', label: 'Máx', sort: (h) => h.maxReplicas, text: (h) => String(h.maxReplicas), mono: true },
    { key: 'replicas', label: 'Réplicas', sort: (h) => h.currentReplicas, text: (h) => String(h.currentReplicas), mono: true },
    { key: 'age', label: 'Idade', sort: (h) => (h.created ? -h.created : null), text: (h) => formatAge(h.created, now.value), mono: true },
  ])
</script>

{#snippet status(h: HpaRow)}
  <StatusPill status={h.status} statusClass={h.statusClass} />
{/snippet}
{#snippet metrics(h: HpaRow)}
  {@const text = metricsText(h)}
  <span class="clip" title={text}>{text}</span>
{/snippet}

{#if openUid}
  <HpaDetails hpa={opened} loading={hpas.loading} onback={() => (openUid = null)} />
{:else}
  <ListPage>
    <ResourceTable
      id="hpas"
      {menu}
      rows={hpas.rows}
      {columns}
      search={(h) => `${h.name} ${h.status} ${h.target.kind} ${h.target.name} ${h.metrics.map((m) => m.name).join(' ')}`}
      loading={hpas.loading}
      error={hpas.error}
      noun="HPAs"
      emptyText="Nenhum HorizontalPodAutoscaler neste namespace"
      onactivate={(h) => (openUid = h.uid)}
    >
      {#snippet actions(h)}
        <IconButton icon="details" label="Detalhes de {h.name}" onclick={() => (openUid = h.uid)} />
        <IconButton icon="yaml" label="YAML de {h.name}" onclick={() => openYaml('hpas', h.namespace, h.name)} />
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}

<style>
  .clip { display: inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
</style>
