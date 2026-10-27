<script lang="ts">
  import type { ServiceRow } from '@shared/api'
  import { groupEndpointSlices } from '../../lib/endpoints'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import PodsWithLogs from '../detail/PodsWithLogs.svelte'
  import Section from '../detail/Section.svelte'
  import EndpointsTable from '../endpoints/EndpointsTable.svelte'

  let { service, loading, onback }: {
    service: ServiceRow | undefined
    loading: boolean
    onback: () => void
  } = $props()

  // Endpoints do service: os slices que o controller marca com o nome dele.
  // Só nome e namespace entram nas opções: o objeto `service` é trocado a cada
  // atualização da lista, e isso não deve reabrir o watch.
  const name = $derived(service?.name)
  const namespace = $derived(service?.namespace)
  const slices = new LiveList('endpointslices', () =>
    name && namespace ? { namespace, labelSelector: `kubernetes.io/service-name=${name}` } : null,
  )
  const endpoints = $derived(groupEndpointSlices(slices.rows)[0]?.endpoints ?? [])
</script>

<DetailPage back="Services" {onback} title={service?.name ?? 'Service'} namespace={service?.namespace} found={!!service} {loading}>
  {#if service}
    <Fields fields={[
      { label: 'Tipo', value: service.type },
      { label: 'Cluster IP', value: service.clusterIP, code: true },
      { label: 'External IP', value: service.externalIP, code: true },
      { label: 'Session affinity', value: service.sessionAffinity },
      { label: 'Seletor', value: service.selector, code: true },
      { label: 'Criado', value: `${formatDateTime(service.created)} (${formatAge(service.created, now.value)})` },
    ]} />

    <Section title="Portas">
      {#if service.portDetails.length === 0}
        <p class="muted">Nenhuma porta declarada.</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Nome</th><th>Porta</th><th>Target port</th><th>Node port</th><th>Protocolo</th></tr></thead>
          <tbody>
            {#each service.portDetails as p (`${p.port}/${p.protocol}`)}
              <tr><td>{p.name || '-'}</td><td>{p.port}</td><td>{p.targetPort}</td><td>{p.nodePort ?? '-'}</td><td>{p.protocol}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Section>

    <Section title="Endpoints">
      {#if slices.error}
        <div class="error-box" role="alert">{slices.error}</div>
      {:else if slices.loading}
        <p class="muted">Carregando…</p>
      {:else}
        <EndpointsTable {endpoints}
          emptyText={service.selector ? 'Nenhum endpoint: nenhum pod pronto casa com o seletor.' : 'Service sem seletor: os endpoints, se houver, são mantidos à mão.'} />
      {/if}
    </Section>

    <Labels labels={service.labels} />

    <PodsWithLogs namespace={service.namespace} selector={service.selector}
                  emptyText="Nenhum pod casa com o seletor deste service"
                  noSelectorText="Service sem seletor: ele não escolhe pods." />
  {/if}
</DetailPage>

<style>
  .muted { color: var(--muted); }
</style>
