<script lang="ts">
  import IconButton from '../IconButton.svelte'
  import type { ConfigMapRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { followTarget } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import ConfigMapDetails from './ConfigMapDetails.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  const configMaps = new LiveList('configmaps', () => ({ namespace: session.namespace }))

  let openUid = $state<string | null>(null)
  const opened = $derived(configMaps.get(openUid))
  // Pode chegar aberto vindo de outra tela (ex.: um volume do pod)
  followTarget(configMaps, (uid) => (openUid = uid))

  let lastNamespace = session.namespace
  $effect(() => {
    if (session.namespace !== lastNamespace) {
      lastNamespace = session.namespace
      openUid = null
    }
  })

  const menu = (c: ConfigMapRow) => [
    { label: 'Detalhes', action: () => (openUid = c.uid) },
    { label: 'YAML', action: () => openYaml('configmaps', c.namespace, c.name) },
  ]

  // Mesmas colunas do `kubectl get configmaps`
  const columns: Column<ConfigMapRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (c) => c.name, text: (c) => c.name, link: true },
    ...(session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (c: ConfigMapRow) => c.namespace, text: (c: ConfigMapRow) => c.namespace }]
      : []),
    { key: 'data', label: 'Chaves', sort: (c) => c.entries.length, text: (c) => String(c.entries.length), mono: true },
    { key: 'keys', label: 'Nomes das chaves', sort: (c) => c.entries.map((e) => e.key).join(','), cell: keys, hidden: true },
    { key: 'age', label: 'Idade', sort: (c) => (c.created ? -c.created : null), text: (c) => formatAge(c.created, now.value), mono: true },
  ])
</script>

{#snippet keys(c: ConfigMapRow)}
  {@const names = c.entries.map((e) => e.key).join(', ')}
  <span class="clip" title={names}>{names || '-'}</span>
{/snippet}

{#if openUid}
  <ConfigMapDetails configMap={opened} loading={configMaps.loading} onback={() => (openUid = null)} />
{:else}
  <ListPage>
    <ResourceTable
      id="configmaps"
      {menu}
      rows={configMaps.rows}
      {columns}
      search={(c) => `${c.name} ${c.entries.map((e) => e.key).join(' ')}`}
      loading={configMaps.loading}
      error={configMaps.error}
      noun="configmaps"
      emptyText="Nenhum ConfigMap neste namespace"
      onactivate={(c) => (openUid = c.uid)}
    >
      {#snippet actions(c)}
        <IconButton icon="details" label="Detalhes de {c.name}" onclick={() => (openUid = c.uid)} />
        <IconButton icon="yaml" label="YAML de {c.name}" onclick={() => openYaml('configmaps', c.namespace, c.name)} />
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}

<style>
  .clip { display: inline-block; max-width: 360px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
</style>
