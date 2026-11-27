<script lang="ts">
  import type { PvRow } from '@shared/api'
  import { nav } from '../../lib/nav.svelte'
  import { openYaml } from '../../lib/yaml.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import ResourceView from '../ResourceView.svelte'
  import type { Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { createdText } from './common'

  const claimText = (p: PvRow) => (p.claim ? `${p.claim.namespace}/${p.claim.name}` : '')

  // Colunas do `kubectl get pv`
  const columns: Column<PvRow>[] = [
    { key: 'status', label: 'Status', sort: (p) => p.status, cell: status },
    { key: 'capacity', label: 'Capacidade', sort: (p) => p.capacityBytes, text: (p) => p.capacity, mono: true },
    { key: 'access', label: 'Acesso', sort: (p) => p.accessModes, text: (p) => p.accessModes, mono: true },
    { key: 'reclaim', label: 'Reclaim', sort: (p) => p.reclaimPolicy, text: (p) => p.reclaimPolicy },
    { key: 'claim', label: 'Claim', sort: claimText, text: (p) => claimText(p) || '-' },
    { key: 'class', label: 'StorageClass', sort: (p) => p.storageClass, text: (p) => p.storageClass || '-' },
    { key: 'source', label: 'Origem', sort: (p) => p.kind, text: (p) => p.kind, hidden: true },
    { key: 'reason', label: 'Motivo', sort: (p) => p.reason, text: (p) => p.reason, hidden: true },
  ]
</script>

{#snippet status(p: PvRow)}<StatusPill status={p.status} statusClass={p.statusClass} />{/snippet}

<ResourceView kind="pvs" clusterScoped {columns} noun="volumes" emptyText="Nenhum PersistentVolume no cluster"
  search={(p) => `${p.name} ${p.status} ${claimText(p)} ${p.storageClass} ${p.kind} ${p.source}`}>
  {#snippet details({ row: pv, loading, onback })}
    <DetailPage back="PersistentVolumes" {onback} title={pv?.name ?? 'PersistentVolume'} found={!!pv} {loading}>
      {#snippet after()}{#if pv}<StatusPill status={pv.status} statusClass={pv.statusClass} />{/if}{/snippet}
      {#snippet actions()}{#if pv}<button onclick={() => openYaml('pvs', '', pv.name)}>YAML</button>{/if}{/snippet}
      {#if pv}
        {@const claim = pv.claim}
        <Fields fields={[
          { label: 'Capacidade', value: pv.capacity, code: true },
          { label: 'Modos de acesso', value: pv.accessModes, code: true },
          { label: 'Reclaim policy', value: pv.reclaimPolicy },
          { label: 'Volume mode', value: pv.volumeMode },
          {
            label: 'Claim', value: claimText(pv),
            onclick: claim ? () => nav.go('pvcs', { namespace: claim.namespace, name: claim.name }) : undefined,
          },
          {
            label: 'StorageClass', value: pv.storageClass,
            onclick: pv.storageClass ? () => nav.go('storageclasses', { namespace: '', name: pv.storageClass }) : undefined,
          },
          { label: 'Origem', value: pv.source ? `${pv.kind}: ${pv.source}` : pv.kind, code: true },
          { label: 'Afinidade de node', value: pv.nodeAffinity, code: true },
          { label: 'Mount options', value: pv.mountOptions.join(', '), code: true },
          { label: 'Criado', value: createdText(pv.created) },
          ...(pv.reason || pv.message ? [{ label: 'Motivo', value: [pv.reason, pv.message].filter(Boolean).join(': ') }] : []),
        ]} />
        <Labels labels={pv.labels} />
      {/if}
    </DetailPage>
  {/snippet}
</ResourceView>
