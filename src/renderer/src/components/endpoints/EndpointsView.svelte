<script lang="ts">
  import { groupEndpointSlices, type ServiceEndpoints } from '../../lib/endpoints'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Section from '../detail/Section.svelte'
  import EndpointsTable from './EndpointsTable.svelte'

  // Lê EndpointSlices (o v1 Endpoints está deprecado desde o Kubernetes 1.33)
  // e mostra um item por service, como o `kubectl get endpoints` fazia.
  const slices = new LiveList('endpointslices', () => ({ namespace: session.namespace }))
  const groups = $derived(groupEndpointSlices(slices.rows))

  let openUid = $state<string | null>(null)
  const opened = $derived(groups.find((g) => g.uid === openUid))

  $effect(() => {
    void session.namespace
    openUid = null
  })

  const columns: Column<ServiceEndpoints>[] = $derived([
    { key: 'name', label: 'Service', sort: (g) => g.service, text: (g) => g.service },
    ...(session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (g: ServiceEndpoints) => g.namespace, text: (g: ServiceEndpoints) => g.namespace }]
      : []),
    { key: 'status', label: 'Status', sort: (g) => g.status, cell: status },
    { key: 'ready', label: 'Endpoints prontos', sort: (g) => g.ready.length, cell: ready, mono: true },
    { key: 'notReady', label: 'Não prontos', sort: (g) => g.notReady, cell: notReady, mono: true },
    { key: 'age', label: 'Idade', sort: (g) => (g.created ? -g.created : null), text: (g) => formatAge(g.created, now.value), mono: true },
  ])
</script>

{#snippet status(g: ServiceEndpoints)}<StatusPill status={g.status} statusClass={g.statusClass} />{/snippet}
{#snippet ready(g: ServiceEndpoints)}
  <span class="addrs" title={g.ready.join('\n')}>
    {g.ready.slice(0, 3).join(', ') || '-'}{#if g.ready.length > 3}<span class="more"> +{g.ready.length - 3}</span>{/if}
  </span>
{/snippet}
{#snippet notReady(g: ServiceEndpoints)}<span class:warn={g.notReady > 0}>{g.notReady}</span>{/snippet}

{#if openUid}
  <DetailPage back="Endpoints" onback={() => (openUid = null)} title={opened?.service ?? 'Endpoints'}
              found={!!opened} loading={slices.loading}>
    {#snippet after()}
      {#if opened}<StatusPill status={opened.status} statusClass={opened.statusClass} />{/if}
    {/snippet}
    {#if opened}
      <Fields fields={[
        { label: 'Prontos', value: String(opened.endpoints.length - opened.notReady) },
        { label: 'Não prontos', value: String(opened.notReady) },
        { label: 'EndpointSlices', value: String(opened.slices) },
        { label: 'Criado', value: formatAge(opened.created, now.value) },
      ]} />
      <Section title="Endpoints">
        <EndpointsTable endpoints={opened.endpoints} emptyText="Nenhum endpoint: o service não selecionou nenhum pod." />
      </Section>
    {/if}
  </DetailPage>
{:else}
  <ListPage>
    <ResourceTable
      id="endpoints"
      menu={(g) => [{ label: 'Detalhes', action: () => (openUid = g.uid) }]}
      rows={groups}
      {columns}
      search={(g) => `${g.service} ${g.status} ${g.ready.join(' ')}`}
      loading={slices.loading}
      error={slices.error}
      noun="services"
      emptyText="Nenhum endpoint neste namespace"
      onactivate={(g) => (openUid = g.uid)}
    >
      {#snippet actions(g)}
        <button onclick={() => (openUid = g.uid)} aria-label="Detalhes de {g.service}">Detalhes</button>
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}

<style>
  .addrs { display: inline-block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .more { color: var(--accent); }
  .warn { color: var(--pend); font-weight: 500; }
</style>
