<script lang="ts">
  import type { DeploymentRow } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Section from '../detail/Section.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import PodsWithLogs from '../detail/PodsWithLogs.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { deployment, loading, onback, onscale, onrestart }: {
    /** undefined = removido do cluster (ou ainda carregando). */
    deployment: DeploymentRow | undefined
    loading: boolean
    onback: () => void
    onscale: (d: DeploymentRow) => void
    onrestart: (d: DeploymentRow) => void
  } = $props()

  const resources = (r: Record<string, string>) =>
    Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'
</script>

<DetailPage back="Deployments" {onback} title={deployment?.name ?? 'Deployment'} namespace={deployment?.namespace} found={!!deployment} {loading}>
  {#snippet after()}
    {#if deployment}<StatusPill status={deployment.status} statusClass={deployment.statusClass} />{/if}
  {/snippet}
  {#snippet actions()}
    {#if deployment}
      <button onclick={() => onscale(deployment)}>Escalar</button>
      <button onclick={() => onrestart(deployment)}>Reiniciar</button>
      <button onclick={() => openYaml('deployments', deployment.namespace, deployment.name)}>YAML</button>
    {/if}
  {/snippet}

  {#if deployment}
    <Fields fields={[
      { label: 'Namespace', value: deployment.namespace },
      { label: 'Réplicas', value: `${deployment.ready}/${deployment.desired} prontas · ${deployment.upToDate} atualizadas · ${deployment.available} disponíveis` },
      { label: 'Estratégia', value: deployment.strategy + (deployment.paused ? ' (pausado)' : '') },
      { label: 'Revisão', value: deployment.revision, code: true },
      { label: 'Criado', value: `${formatDateTime(deployment.created)} (${formatAge(deployment.created, now.value)})` },
      { label: 'Seletor', value: deployment.selector, code: true },
    ]} />

    <Section title="Condições">
      {#if deployment.conditions.length === 0}
        <p class="muted">Nenhuma condição reportada.</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Tipo</th><th>Status</th><th>Motivo</th><th>Mensagem</th><th>Desde</th></tr></thead>
          <tbody>
            {#each deployment.conditions as c (c.type)}
              <tr>
                <td>{c.type}</td>
                <td class:ok={c.status === 'True'} class:bad={c.status === 'False'}>{c.status}</td>
                <td class="text">{c.reason || '-'}</td>
                <td class="text">{c.message || '-'}</td>
                <td>{c.lastTransition ? formatAge(c.lastTransition, now.value) : '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Section>

    <Section title="Containers">
      <div class="containers">
        {#each deployment.containers as c (c.name)}
          <div class="container">
            <strong>{c.name}</strong>
            <Fields fields={[
              { label: 'Imagem', value: c.image, code: true },
              { label: 'Portas', value: c.ports.join(', '), code: true },
              { label: 'Requests', value: resources(c.requests), code: true },
              { label: 'Limits', value: resources(c.limits), code: true },
            ]} />
          </div>
        {/each}
      </div>
    </Section>

    <Labels labels={deployment.labels} />

    <PodsWithLogs namespace={deployment.namespace} selector={deployment.selector}
                  emptyText="Nenhum pod deste deployment"
                  noSelectorText="Deployment sem seletor: não há como saber quais pods são dele." />
  {/if}
</DetailPage>

<style>
  .muted { color: var(--muted); }
  .containers { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .container { display: flex; flex-direction: column; gap: 10px; }
  .container strong { font-family: var(--mono); font-size: 14px; color: var(--navy); }
  .container :global(dl) { grid-template-columns: 1fr 1fr; padding: 16px; }
</style>
