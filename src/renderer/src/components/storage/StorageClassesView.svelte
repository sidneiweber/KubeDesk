<script lang="ts">
  import type { StorageClassRow } from '@shared/api'
  import { nav } from '../../lib/nav.svelte'
  import { openYaml } from '../../lib/yaml.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import ClassVolumes from './ClassVolumes.svelte'
  import ResourceView from '../ResourceView.svelte'
  import type { Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { createdText, yesNo } from './common'

  // Colunas do `kubectl get storageclass`; "(default)" vira um selo
  const columns: Column<StorageClassRow>[] = [
    { key: 'default', label: 'Padrão', sort: (s) => (s.isDefault ? 0 : 1), cell: isDefault },
    { key: 'provisioner', label: 'Provisioner', sort: (s) => s.provisioner, text: (s) => s.provisioner },
    { key: 'reclaim', label: 'Reclaim', sort: (s) => s.reclaimPolicy, text: (s) => s.reclaimPolicy },
    { key: 'binding', label: 'Binding', sort: (s) => s.volumeBindingMode, text: (s) => s.volumeBindingMode },
    { key: 'expansion', label: 'Expansível', sort: (s) => (s.allowVolumeExpansion ? 0 : 1), text: (s) => yesNo(s.allowVolumeExpansion) },
  ]

</script>

{#snippet isDefault(s: StorageClassRow)}
  {#if s.isDefault}<StatusPill status="padrão" statusClass="running" />{/if}
{/snippet}

<ResourceView kind="storageclasses" clusterScoped {columns} noun="classes" emptyText="Nenhuma StorageClass no cluster"
  search={(s) => `${s.name} ${s.provisioner}`}>
  {#snippet details({ row: sc, loading, onback })}
    <DetailPage back="StorageClasses" {onback} title={sc?.name ?? 'StorageClass'} found={!!sc} {loading}>
      {#snippet after()}{#if sc?.isDefault}<StatusPill status="padrão" statusClass="running" />{/if}{/snippet}
      {#snippet actions()}{#if sc}<button onclick={() => openYaml('storageclasses', '', sc.name)}>YAML</button>{/if}{/snippet}
      {#if sc}
        <Fields fields={[
          { label: 'Provisioner', value: sc.provisioner, code: true, onclick: () => nav.go('csidrivers', { namespace: '', name: sc.provisioner }) },
          { label: 'Reclaim policy', value: sc.reclaimPolicy },
          { label: 'Volume binding mode', value: sc.volumeBindingMode },
          { label: 'Permite expandir', value: yesNo(sc.allowVolumeExpansion) },
          { label: 'Mount options', value: sc.mountOptions.join(', '), code: true },
          { label: 'Criado', value: createdText(sc.created) },
        ]} />

        <Section title="Parâmetros">
          {#if Object.keys(sc.parameters).length === 0}
            <p class="muted">Nenhum parâmetro.</p>
          {:else}
            <table class="detail-table">
              <tbody>
                {#each Object.entries(sc.parameters) as [k, v] (k)}
                  <tr><td class="mono">{k}</td><td class="mono">{v}</td></tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </Section>

        <ClassVolumes className={sc.name} />

        <Labels labels={sc.labels} />
      {/if}
    </DetailPage>
  {/snippet}
</ResourceView>

<style>
  .muted { color: var(--muted); }
</style>
