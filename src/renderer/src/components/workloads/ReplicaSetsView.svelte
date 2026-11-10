<script lang="ts">
  import type { ReplicaSetRow } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import WorkloadView from './WorkloadView.svelte'
  import WorkloadDetails from './WorkloadDetails.svelte'
  import { ageColumn, imagesColumn, nameColumn, readyColumn, statusColumn } from './cells.svelte'

  const columns: Column<ReplicaSetRow>[] = [
    nameColumn(),
    statusColumn(),
    { key: 'desired', label: 'Desejado', sort: (r) => r.desired, text: (r) => String(r.desired), mono: true },
    { key: 'current', label: 'Atual', sort: (r) => r.current, text: (r) => String(r.current), mono: true },
    readyColumn((r) => r.ready, (r) => r.desired),
    { key: 'owner', label: 'Controlado por', sort: (r) => r.owner?.name ?? '', text: (r) => (r.owner ? `${r.owner.kind}/${r.owner.name}` : '-'), muted: true },
    ageColumn(),
    imagesColumn(true),
  ]
</script>

<WorkloadView kind="replicasets" {columns} search={(r) => `${r.name} ${r.status} ${r.owner?.name ?? ''} ${r.images.join(' ')}`}>
  {#snippet details({ row: r, loading, onback, onscale })}
    <WorkloadDetails kind="replicasets" workload={r} {loading} {onback}
      fields={r ? [
        { label: 'Réplicas', value: `${r.ready}/${r.desired} prontas · ${r.current} atuais · ${r.available} disponíveis` },
        ...(r.revision ? [{ label: 'Revisão do deployment', value: String(r.revision), code: true }] : []),
      ] : []}>
      {#snippet buttons()}
        <button onclick={onscale}>Escalar</button>
      {/snippet}
    </WorkloadDetails>
  {/snippet}
</WorkloadView>
