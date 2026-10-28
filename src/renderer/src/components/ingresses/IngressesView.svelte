<script lang="ts">
  import type { IngressRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import IngressDetails from './IngressDetails.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  const ingresses = new LiveList('ingresses', () => ({ namespace: session.namespace }))

  let openUid = $state<string | null>(null)
  const opened = $derived(ingresses.get(openUid))

  $effect(() => {
    void session.namespace
    openUid = null
  })

  const menu = (i: IngressRow) => [
    { label: 'Detalhes', action: () => (openUid = i.uid) },
    { label: 'YAML', action: () => openYaml('ingresses', i.namespace, i.name) },
  ]

  const columns: Column<IngressRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (i) => i.name, text: (i) => i.name },
    ...(session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (i: IngressRow) => i.namespace, text: (i: IngressRow) => i.namespace }]
      : []),
    { key: 'class', label: 'Classe', sort: (i) => i.className, text: (i) => i.className || '<none>' },
    { key: 'hosts', label: 'Hosts', sort: (i) => i.hosts.join(','), cell: hosts },
    { key: 'address', label: 'Endereço', sort: (i) => i.addresses.join(','), cell: address, mono: true },
    { key: 'ports', label: 'Portas', sort: (i) => i.ports, text: (i) => i.ports, mono: true },
    { key: 'age', label: 'Idade', sort: (i) => (i.created ? -i.created : null), text: (i) => formatAge(i.created, now.value), mono: true },
  ])
</script>

{#snippet hosts(i: IngressRow)}
  <span class="clip" title={i.hosts.join('\n')}>{i.hosts.join(', ') || '*'}</span>
{/snippet}
{#snippet address(i: IngressRow)}
  <!-- Vazio até o controller programar o ingress: costuma ser o sinal de que falta um controller -->
  {#if i.addresses.length}{i.addresses.join(', ')}{:else}<span class="muted">-</span>{/if}
{/snippet}

{#if openUid}
  <IngressDetails ingress={opened} loading={ingresses.loading} onback={() => (openUid = null)} />
{:else}
  <ListPage>
    <ResourceTable
      id="ingresses"
      {menu}
      rows={ingresses.rows}
      {columns}
      search={(i) => `${i.name} ${i.className} ${i.hosts.join(' ')} ${i.addresses.join(' ')}`}
      loading={ingresses.loading}
      error={ingresses.error}
      noun="ingresses"
      emptyText="Nenhum ingress neste namespace"
      onactivate={(i) => (openUid = i.uid)}
    >
      {#snippet actions(i)}
        <button onclick={() => (openUid = i.uid)} aria-label="Detalhes de {i.name}">Detalhes</button>
        <button onclick={() => openYaml('ingresses', i.namespace, i.name)} aria-label="YAML de {i.name}">YAML</button>
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}

<style>
  .clip { display: inline-block; max-width: 360px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .muted { color: var(--muted); }
</style>
