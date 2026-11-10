<script lang="ts">
  import type { JobRow } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import WorkloadView from './WorkloadView.svelte'
  import WorkloadDetails from './WorkloadDetails.svelte'
  import { ageColumn, imagesColumn, nameColumn, statusColumn } from './cells.svelte'

  const completions = (j: JobRow) => `${j.succeeded}/${j.completions ?? '-'}`
  // Duração: do início até terminar (ou até agora, se ainda roda)
  const duration = (j: JobRow) => (j.startTime ? (j.completionTime || now.value) - j.startTime : null)
  const durationText = (j: JobRow) => (j.startTime ? formatAge(j.startTime, j.completionTime || now.value) : '-')

  const columns: Column<JobRow>[] = [
    nameColumn(),
    statusColumn(),
    { key: 'completions', label: 'Completions', sort: (j) => j.succeeded, text: completions, mono: true },
    { key: 'duration', label: 'Duração', sort: duration, text: durationText, mono: true },
    { key: 'owner', label: 'Controlado por', sort: (j) => j.owner?.name ?? '', text: (j) => (j.owner ? `${j.owner.kind}/${j.owner.name}` : '-'), muted: true },
    ageColumn(),
    imagesColumn(true),
  ]
</script>

<WorkloadView kind="jobs" {columns} search={(j) => `${j.name} ${j.status} ${j.owner?.name ?? ''} ${j.images.join(' ')}`}>
  {#snippet details({ row: j, loading, onback })}
    <WorkloadDetails kind="jobs" workload={j} {loading} {onback}
      fields={j ? [
        { label: 'Completions', value: `${j.succeeded} de ${j.completions ?? 'sem número fixo'} · paralelismo ${j.parallelism}` },
        { label: 'Pods', value: `${j.active} ativos · ${j.succeeded} com sucesso · ${j.failed} falharam (limite ${j.backoffLimit})` },
        { label: 'Início', value: j.startTime ? formatDateTime(j.startTime) : '' },
        { label: 'Fim', value: j.completionTime ? formatDateTime(j.completionTime) : '' },
        { label: 'Duração', value: durationText(j) },
        ...(j.suspended ? [{ label: 'Suspenso', value: 'sim' }] : []),
      ] : []} />
  {/snippet}
</WorkloadView>
