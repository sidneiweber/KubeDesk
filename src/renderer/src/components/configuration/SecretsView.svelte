<script lang="ts">
  import IconButton from '../IconButton.svelte'
  import type { SecretRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { followTarget } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { session } from '../../lib/session.svelte'
  import ListPage from '../ListPage.svelte'
  import ResourceTable, { type Column } from '../table/ResourceTable.svelte'
  import SecretDetails from './SecretDetails.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  const secrets = new LiveList('secrets', () => ({ namespace: session.namespace }))

  let openUid = $state<string | null>(null)
  const opened = $derived(secrets.get(openUid))
  // Pode chegar aberto vindo de outra tela (ex.: o TLS de um ingress)
  followTarget(secrets, (uid) => (openUid = uid))

  let lastNamespace = session.namespace
  $effect(() => {
    if (session.namespace !== lastNamespace) {
      lastNamespace = session.namespace
      openUid = null
    }
  })

  const menu = (s: SecretRow) => [
    { label: 'Detalhes', action: () => (openUid = s.uid) },
    { label: 'YAML', action: () => openYaml('secrets', s.namespace, s.name) },
  ]

  // Mesmas colunas do `kubectl get secrets`
  const columns: Column<SecretRow>[] = $derived([
    { key: 'name', label: 'Nome', sort: (s) => s.name, text: (s) => s.name, link: true },
    ...(session.namespace === ''
      ? [{ key: 'namespace', label: 'Namespace', sort: (s: SecretRow) => s.namespace, text: (s: SecretRow) => s.namespace }]
      : []),
    { key: 'type', label: 'Tipo', sort: (s) => s.type, text: (s) => s.type },
    { key: 'data', label: 'Chaves', sort: (s) => s.keys.length, text: (s) => String(s.keys.length), mono: true },
    { key: 'age', label: 'Idade', sort: (s) => (s.created ? -s.created : null), text: (s) => formatAge(s.created, now.value), mono: true },
  ])
</script>

{#if openUid}
  <SecretDetails secret={opened} loading={secrets.loading} onback={() => (openUid = null)} />
{:else}
  <ListPage>
    <ResourceTable
      id="secrets"
      {menu}
      rows={secrets.rows}
      {columns}
      search={(s) => `${s.name} ${s.type} ${s.keys.map((k) => k.key).join(' ')}`}
      loading={secrets.loading}
      error={secrets.error}
      noun="secrets"
      emptyText="Nenhum Secret neste namespace"
      onactivate={(s) => (openUid = s.uid)}
    >
      {#snippet actions(s)}
        <IconButton icon="details" label="Detalhes de {s.name}" onclick={() => (openUid = s.uid)} />
        <IconButton icon="yaml" label="YAML de {s.name}" onclick={() => openYaml('secrets', s.namespace, s.name)} />
      {/snippet}
    </ResourceTable>
  </ListPage>
{/if}
