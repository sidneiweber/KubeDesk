<script lang="ts">
  import type { CronJobRow } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import { toasts } from '../../lib/toasts.svelte'
  import Modal from '../Modal.svelte'
  import WorkloadView from './WorkloadView.svelte'
  import WorkloadDetails from './WorkloadDetails.svelte'
  import CronJobJobs from './CronJobJobs.svelte'
  import { ageColumn, imagesColumn, nameColumn, statusColumn } from './cells.svelte'

  const ago = (ms: number) => (ms ? formatAge(ms, now.value) : '-')

  const columns: Column<CronJobRow>[] = [
    nameColumn(),
    statusColumn(),
    { key: 'schedule', label: 'Agenda', sort: (c) => c.schedule, text: (c) => c.schedule + (c.timeZone ? ` (${c.timeZone})` : ''), mono: true },
    { key: 'active', label: 'Ativos', sort: (c) => c.active, text: (c) => String(c.active), mono: true },
    { key: 'last', label: 'Última execução', sort: (c) => (c.lastSchedule ? -c.lastSchedule : null), text: (c) => ago(c.lastSchedule), mono: true },
    ageColumn(),
    imagesColumn(true),
  ]

  let triggering = $state<CronJobRow | null>(null)
  let busy = $state(false)
  let error = $state('')

  async function trigger() {
    if (!triggering) return
    busy = true
    error = ''
    try {
      const job = await window.kube.triggerCronJob(triggering.namespace, triggering.name)
      toasts.success(`Job ${job} criado`)
      triggering = null
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  async function toggleSuspend(c: CronJobRow) {
    try {
      await window.kube.suspendCronJob(c.namespace, c.name, !c.suspended)
      toasts.success(`${c.name}: ${c.suspended ? 'retomado' : 'pausado'}`)
    } catch (e) {
      toasts.error((e as Error).message)
    }
  }

  const menu = (c: CronJobRow) => [
    { label: 'Disparar agora…', action: () => (triggering = c) },
    { label: c.suspended ? 'Retomar' : 'Pausar', action: () => toggleSuspend(c) },
  ]
</script>

<WorkloadView kind="cronjobs" {columns} {menu} search={(c) => `${c.name} ${c.status} ${c.schedule} ${c.images.join(' ')}`}>
  {#snippet details({ row: c, loading, onback })}
    <!-- Os pods do CronJob são os dos Jobs que ele criou -->
    <CronJobJobs cronjob={c}>
      {#snippet children(jobs, selector)}
        <WorkloadDetails kind="cronjobs" workload={c} {loading} {onback} podSelector={selector}
          noPodsText="Nenhum Job deste CronJob guardado agora."
          fields={c ? [
            { label: 'Agenda', value: c.schedule + (c.timeZone ? ` (${c.timeZone})` : ''), code: true },
            { label: 'Situação', value: c.suspended ? 'Pausado' : `${c.active} job${c.active === 1 ? '' : 's'} rodando` },
            { label: 'Última execução', value: c.lastSchedule ? `${formatDateTime(c.lastSchedule)} (${ago(c.lastSchedule)})` : '' },
            { label: 'Último sucesso', value: c.lastSuccessful ? `${formatDateTime(c.lastSuccessful)} (${ago(c.lastSuccessful)})` : '' },
            { label: 'Concorrência', value: c.concurrencyPolicy },
            { label: 'Histórico guardado', value: `${c.successfulJobsHistoryLimit} com sucesso · ${c.failedJobsHistoryLimit} com falha` },
          ] : []}>
          {#snippet buttons()}
            <button onclick={() => (triggering = c ?? null)}>Disparar agora</button>
            <button onclick={() => c && toggleSuspend(c)}>{c?.suspended ? 'Retomar' : 'Pausar'}</button>
          {/snippet}
          {#snippet overview()}{@render jobs()}{/snippet}
        </WorkloadDetails>
      {/snippet}
    </CronJobJobs>
  {/snippet}
</WorkloadView>

{#if triggering}
  <Modal title="Disparar {triggering.name} agora?" onclose={() => ((triggering = null), (error = ''))}>
    <p>Cria um Job agora com o template do CronJob, fora da agenda, como <code>kubectl create job --from=cronjob/{triggering.name}</code>.</p>
    {#if triggering.concurrencyPolicy === 'Forbid' && triggering.active > 0}
      <p class="warn">Já há {triggering.active} job rodando e a política é <strong>Forbid</strong>. Um disparo manual não respeita essa regra.</p>
    {/if}
    {#if error}<div class="error-box" role="alert">{error}</div>{/if}
    {#snippet footer()}
      <button onclick={() => ((triggering = null), (error = ''))}>Cancelar</button>
      <button class="primary" onclick={trigger} disabled={busy}>{busy ? 'Disparando…' : 'Disparar'}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  code { font-family: var(--mono); font-size: 12px; }
  .warn { color: var(--pend); font-weight: 500; }
</style>
