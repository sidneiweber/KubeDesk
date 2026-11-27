<script lang="ts">
  import type { PvcRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { nav } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { openYaml } from '../../lib/yaml.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import ResourceView from '../ResourceView.svelte'
  import type { Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { createdText } from './common'

  // Colunas do `kubectl get pvc`
  const columns: Column<PvcRow>[] = [
    { key: 'status', label: 'Status', sort: (p) => p.status, cell: status },
    { key: 'volume', label: 'Volume', sort: (p) => p.volume, text: (p) => p.volume || '-' },
    { key: 'capacity', label: 'Capacidade', sort: (p) => p.capacityBytes, text: (p) => p.capacity || '-', mono: true },
    { key: 'access', label: 'Acesso', sort: (p) => p.accessModes, text: (p) => p.accessModes, mono: true },
    { key: 'class', label: 'StorageClass', sort: (p) => p.storageClass, text: (p) => p.storageClass || '-' },
    { key: 'mode', label: 'Volume mode', sort: (p) => p.volumeMode, text: (p) => p.volumeMode, hidden: true },
  ]
</script>

{#snippet status(p: PvcRow)}<StatusPill status={p.status} statusClass={p.statusClass} />{/snippet}

<ResourceView kind="pvcs" {columns} noun="claims" emptyText="Nenhum PersistentVolumeClaim neste namespace"
  search={(p) => `${p.name} ${p.status} ${p.volume} ${p.storageClass}`}>
  {#snippet details({ row: pvc, loading, onback })}
    <DetailPage back="PersistentVolumeClaims" {onback} title={pvc?.name ?? 'PersistentVolumeClaim'} found={!!pvc} {loading}>
      {#snippet after()}{#if pvc}<StatusPill status={pvc.status} statusClass={pvc.statusClass} />{/if}{/snippet}
      {#snippet actions()}{#if pvc}<button onclick={() => openYaml('pvcs', pvc.namespace, pvc.name)}>YAML</button>{/if}{/snippet}
      {#if pvc}
        <Fields fields={[
          { label: 'Namespace', value: pvc.namespace },
          {
            label: 'Volume', value: pvc.volume,
            onclick: pvc.volume ? () => nav.go('pvs', { namespace: '', name: pvc.volume }) : undefined,
          },
          { label: 'Capacidade', value: pvc.capacity, code: true },
          { label: 'Pedido', value: pvc.requested, code: true },
          { label: 'Modos de acesso', value: pvc.accessModes, code: true },
          { label: 'Volume mode', value: pvc.volumeMode },
          {
            label: 'StorageClass', value: pvc.storageClass,
            onclick: pvc.storageClass ? () => nav.go('storageclasses', { namespace: '', name: pvc.storageClass }) : undefined,
          },
          ...(pvc.selector ? [{ label: 'Seletor', value: pvc.selector, code: true }] : []),
          { label: 'Criado', value: createdText(pvc.created) },
        ]} />

        {#if pvc.conditions.length > 0}
          <Section title="Condições">
            <table class="detail-table">
              <thead><tr><th>Tipo</th><th>Status</th><th>Motivo</th><th>Mensagem</th><th>Desde</th></tr></thead>
              <tbody>
                {#each pvc.conditions as c (c.type)}
                  <tr>
                    <td>{c.type}</td><td>{c.status}</td>
                    <td class="text">{c.reason || '-'}</td><td class="text">{c.message || '-'}</td>
                    <td class="mono">{c.lastTransition ? formatAge(c.lastTransition, now.value) : '-'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </Section>
        {/if}

        <Labels labels={pvc.labels} />
      {/if}
    </DetailPage>
  {/snippet}
</ResourceView>
