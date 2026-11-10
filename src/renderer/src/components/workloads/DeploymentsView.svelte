<script lang="ts">
  import type { DeploymentRow } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import WorkloadView from './WorkloadView.svelte'
  import WorkloadDetails from './WorkloadDetails.svelte'
  import { ageColumn, imagesColumn, nameColumn, readyColumn, statusColumn } from './cells.svelte'

  const columns: Column<DeploymentRow>[] = [
    nameColumn(),
    statusColumn(),
    readyColumn((d) => d.ready, (d) => d.desired),
    { key: 'upToDate', label: 'Up-to-date', sort: (d) => d.upToDate, text: (d) => String(d.upToDate), mono: true },
    { key: 'available', label: 'Available', sort: (d) => d.available, text: (d) => String(d.available), mono: true },
    ageColumn(),
    imagesColumn(),
  ]
</script>

<WorkloadView kind="deployments" {columns} search={(d) => `${d.name} ${d.status} ${d.images.join(' ')}`}>
  {#snippet details({ row: d, loading, onback, onscale, onrestart })}
    <WorkloadDetails kind="deployments" workload={d} {loading} {onback} paused={d?.paused} strategy={d?.strategy}
      fields={d ? [
        { label: 'Réplicas', value: `${d.ready}/${d.desired} prontas · ${d.upToDate} atualizadas · ${d.available} disponíveis` },
        { label: 'Estratégia', value: d.strategy + (d.paused ? ' (pausado)' : '') },
        { label: 'Revisão', value: d.revision, code: true },
      ] : []}>
      {#snippet buttons()}
        <button onclick={onscale}>Escalar</button>
        <button onclick={onrestart}>Reiniciar</button>
      {/snippet}
    </WorkloadDetails>
  {/snippet}
</WorkloadView>
