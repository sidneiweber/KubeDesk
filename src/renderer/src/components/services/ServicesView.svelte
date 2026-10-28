<script lang="ts">
  import IconButton from '../IconButton.svelte'
  import type { ServiceRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import ServiceDetails from './ServiceDetails.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  const services = new LiveList('services', () => ({ namespace: session.namespace }))

  let openUid = $state<string | null>(null)
  const opened = $derived(services.get(openUid))

  $effect(() => {
    void session.namespace
    openUid = null
  })

  const menu = (s: ServiceRow) => [
    { label: 'Detalhes', action: () => (openUid = s.uid) },
    { label: 'YAML', action: () => openYaml('services', s.namespace, s.name) },
  ]

  // Mesmas colunas e formatos do `kubectl get services`
  const columns: Column<ServiceRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (s) => s.name, text: (s) => s.name, link: true },
    ...(session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (s: ServiceRow) => s.namespace, text: (s: ServiceRow) => s.namespace }]
      : []),
    { key: 'type', label: 'Tipo', sort: (s) => s.type, text: (s) => s.type },
    { key: 'clusterIP', label: 'Cluster IP', sort: (s) => s.clusterIP, text: (s) => s.clusterIP, mono: true },
    { key: 'externalIP', label: 'External IP', sort: (s) => s.externalIP, cell: external, mono: true },
    { key: 'ports', label: 'Portas', sort: (s) => s.ports.join(','), text: (s) => s.ports.join(',') || '<none>', mono: true },
    { key: 'age', label: 'Idade', sort: (s) => (s.created ? -s.created : null), text: (s) => formatAge(s.created, now.value), mono: true },
  ])
</script>

{#snippet external(s: ServiceRow)}
  <span class:muted={s.externalIP === '<none>'} class:pending={s.externalIP === '<pending>'}>{s.externalIP}</span>
{/snippet}

{#if openUid}
  <ServiceDetails service={opened} loading={services.loading} onback={() => (openUid = null)} />
{:else}
  <ListPage>
    <ResourceTable
      id="services"
      {menu}
      rows={services.rows}
      {columns}
      search={(s) => `${s.name} ${s.type} ${s.clusterIP} ${s.externalIP} ${s.ports.join(' ')}`}
      loading={services.loading}
      error={services.error}
      noun="services"
      emptyText="Nenhum service neste namespace"
      onactivate={(s) => (openUid = s.uid)}
    >
      {#snippet actions(s)}
        <IconButton icon="details" label="Detalhes de {s.name}" onclick={() => (openUid = s.uid)} />
        <IconButton icon="yaml" label="YAML de {s.name}" onclick={() => openYaml('services', s.namespace, s.name)} />
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}

<style>
  .muted { color: var(--muted); }
  .pending { color: var(--pend); }
</style>
