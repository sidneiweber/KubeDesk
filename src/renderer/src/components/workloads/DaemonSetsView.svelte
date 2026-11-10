<script lang="ts">
  import type { DaemonSetRow } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import WorkloadView from './WorkloadView.svelte'
  import WorkloadDetails from './WorkloadDetails.svelte'
  import { ageColumn, imagesColumn, nameColumn, readyColumn, statusColumn } from './cells.svelte'

  const columns: Column<DaemonSetRow>[] = [
    nameColumn(),
    statusColumn(),
    { key: 'desired', label: 'Desejado', sort: (d) => d.desired, text: (d) => String(d.desired), mono: true },
    { key: 'current', label: 'Atual', sort: (d) => d.current, text: (d) => String(d.current), mono: true },
    readyColumn((d) => d.ready, (d) => d.desired),
    { key: 'upToDate', label: 'Up-to-date', sort: (d) => d.upToDate, text: (d) => String(d.upToDate), mono: true },
    { key: 'available', label: 'Available', sort: (d) => d.available, text: (d) => String(d.available), mono: true },
    { key: 'nodeSelector', label: 'Node selector', sort: (d) => d.nodeSelector.join(','), text: (d) => d.nodeSelector.join(', ') || '-', muted: true, mono: true },
    ageColumn(),
    imagesColumn(true),
  ]
</script>

<WorkloadView kind="daemonsets" {columns} search={(d) => `${d.name} ${d.status} ${d.images.join(' ')}`}>
  {#snippet details({ row: d, loading, onback, onrestart })}
    <WorkloadDetails kind="daemonsets" workload={d} {loading} {onback} strategy={d?.strategy}
      fields={d ? [
        { label: 'Pods', value: `${d.ready}/${d.desired} prontos · ${d.upToDate} atualizados · ${d.available} disponíveis` },
        { label: 'Estratégia', value: d.strategy },
        { label: 'Node selector', value: d.nodeSelector.join(', '), code: true },
      ] : []}>
      {#snippet buttons()}
        <button onclick={onrestart}>Reiniciar</button>
      {/snippet}
    </WorkloadDetails>
  {/snippet}
</WorkloadView>
