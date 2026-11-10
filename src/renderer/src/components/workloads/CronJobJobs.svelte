<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { CronJobRow, JobRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { nav } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import Section from '../detail/Section.svelte'
  import StatusPill from '../table/StatusPill.svelte'

  // Jobs criados por um CronJob. Entrega ao filho a seção pronta e o
  // seletor dos pods desses jobs (label job-name), para os logs e a lista
  // de pods.

  let { cronjob, children }: {
    cronjob: CronJobRow | undefined
    children: Snippet<[Snippet, string]>
  } = $props()

  const jobs = new LiveList('jobs', () => (cronjob ? { namespace: cronjob.namespace } : null))
  const owned = $derived(
    jobs.rows.filter((j) => j.owner?.uid === cronjob?.uid).sort((a, b) => b.created - a.created),
  )
  const selector = $derived(owned.length ? `job-name in (${owned.map((j) => j.name).join(',')})` : '')

  const duration = (j: JobRow) => (j.startTime ? formatAge(j.startTime, j.completionTime || now.value) : '-')
</script>

{#snippet section()}
  <Section title="Jobs">
    {#if jobs.error}
      <div class="error-box" role="alert">{jobs.error}</div>
    {:else if owned.length === 0}
      <p class="muted">{jobs.loading ? 'Carregando…' : 'Nenhum Job guardado (o histórico é limpo conforme os limites do CronJob).'}</p>
    {:else}
      <table class="detail-table">
        <thead><tr><th>Nome</th><th>Status</th><th>Completions</th><th>Duração</th><th>Idade</th></tr></thead>
        <tbody>
          {#each owned as j (j.uid)}
            <tr>
              <td><button class="link" onclick={() => nav.go('jobs', { namespace: j.namespace, name: j.name })}>{j.name}</button></td>
              <td><StatusPill status={j.status} statusClass={j.statusClass} /></td>
              <td class="mono">{j.succeeded}/{j.completions ?? '-'}</td>
              <td class="mono">{duration(j)}</td>
              <td class="mono">{formatAge(j.created, now.value)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Section>
{/snippet}

{@render children(section, selector)}

<style>
  .muted { color: var(--muted); }
  .link { all: unset; cursor: pointer; color: var(--accent); font-weight: 500; }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--focus); }
</style>
