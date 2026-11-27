<script lang="ts">
  import type { CsiDriverRow } from '@shared/api'
  import { openYaml } from '../../lib/yaml.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import ResourceView from '../ResourceView.svelte'
  import type { Column } from '../table/ResourceTable.svelte'
  import { createdText, yesNo } from './common'

  const flag = (key: string, label: string, get: (d: CsiDriverRow) => boolean, hidden = false): Column<CsiDriverRow> => ({
    key, label, sort: (d) => (get(d) ? 0 : 1), text: (d) => yesNo(get(d)), hidden,
  })

  // Colunas do `kubectl get csidrivers`
  const columns: Column<CsiDriverRow>[] = [
    flag('attach', 'Attach', (d) => d.attachRequired),
    flag('podInfo', 'Pod info', (d) => d.podInfoOnMount),
    flag('capacity', 'Capacidade', (d) => d.storageCapacity),
    { key: 'tokens', label: 'Tokens', sort: (d) => d.tokenRequests.join(','), text: (d) => d.tokenRequests.join(', ') || '-', hidden: true },
    flag('republish', 'Republish', (d) => d.requiresRepublish, true),
    { key: 'modes', label: 'Modos', sort: (d) => d.modes.join(','), text: (d) => d.modes.join(', ') },
  ]
</script>

<ResourceView kind="csidrivers" clusterScoped {columns} noun="drivers" emptyText="Nenhum CSIDriver registrado no cluster"
  search={(d) => `${d.name} ${d.modes.join(' ')}`}>
  {#snippet details({ row: d, loading, onback })}
    <DetailPage back="CSIDrivers" {onback} title={d?.name ?? 'CSIDriver'} found={!!d} {loading}>
      {#snippet actions()}{#if d}<button onclick={() => openYaml('csidrivers', '', d.name)}>YAML</button>{/if}{/snippet}
      {#if d}
        <Fields fields={[
          { label: 'Exige attach', value: yesNo(d.attachRequired) },
          { label: 'Pod info no mount', value: yesNo(d.podInfoOnMount) },
          { label: 'Informa capacidade', value: yesNo(d.storageCapacity) },
          { label: 'Exige republish', value: yesNo(d.requiresRepublish) },
          { label: 'Modos de ciclo de vida', value: d.modes.join(', ') },
          { label: 'fsGroup policy', value: d.fsGroupPolicy },
          { label: 'SELinux mount', value: yesNo(d.seLinuxMount) },
          { label: 'Token requests', value: d.tokenRequests.join(', '), code: true },
          { label: 'Criado', value: createdText(d.created) },
        ]} />
        <Labels labels={d.labels} />
      {/if}
    </DetailPage>
  {/snippet}
</ResourceView>
