<script lang="ts">
  import type { StatefulSetRow } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import { nav } from '../../lib/nav.svelte'
  import WorkloadView from './WorkloadView.svelte'
  import WorkloadDetails from './WorkloadDetails.svelte'
  import { ageColumn, imagesColumn, nameColumn, readyColumn, statusColumn } from './cells.svelte'

  const columns: Column<StatefulSetRow>[] = [
    nameColumn(),
    statusColumn(),
    readyColumn((s) => s.ready, (s) => s.desired),
    { key: 'upToDate', label: 'Up-to-date', sort: (s) => s.upToDate, text: (s) => String(s.upToDate), mono: true },
    { key: 'service', label: 'Service', sort: (s) => s.serviceName, text: (s) => s.serviceName || '-', muted: true },
    ageColumn(),
    imagesColumn(),
  ]
</script>

<WorkloadView kind="statefulsets" {columns} search={(s) => `${s.name} ${s.status} ${s.serviceName} ${s.images.join(' ')}`}>
  {#snippet details({ row: s, loading, onback, onscale, onrestart })}
    <WorkloadDetails kind="statefulsets" workload={s} {loading} {onback} strategy={s?.strategy}
      fields={s ? [
        { label: 'Réplicas', value: `${s.ready}/${s.desired} prontas · ${s.upToDate} atualizadas · ${s.current} na revisão atual` },
        { label: 'Service', value: s.serviceName, onclick: s.serviceName ? () => nav.go('services', { namespace: s.namespace, name: s.serviceName }) : undefined },
        { label: 'Estratégia', value: s.strategy },
        { label: 'Criação de pods', value: s.podManagementPolicy },
        { label: 'Volume claims', value: s.volumeClaims.join(', '), code: true },
      ] : []}>
      {#snippet buttons()}
        <button onclick={onscale}>Escalar</button>
        <button onclick={onrestart}>Reiniciar</button>
      {/snippet}
    </WorkloadDetails>
  {/snippet}
</WorkloadView>
