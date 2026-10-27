<script lang="ts">
  import type { DeploymentRow, PodRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import PodsTable from '../pods/PodsTable.svelte'
  import LogViewer from '../logs/LogViewer.svelte'

  let { deployment, loading, onback, onscale, onrestart }: {
    /** undefined = removido do cluster (ou ainda carregando). */
    deployment: DeploymentRow | undefined
    loading: boolean
    onback: () => void
    onscale: (d: DeploymentRow) => void
    onrestart: (d: DeploymentRow) => void
  } = $props()

  let logPod = $state<PodRow | null>(null)

  const dateTime = (ms: number) => (ms ? new Date(ms).toLocaleString('pt-BR') : '-')
  const resources = (r: Record<string, string>) =>
    Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'
</script>

<div class="page">
  <header>
    <button class="back" onclick={onback}>← Deployments</button>
    {#if deployment}
      <h1>{deployment.name}</h1>
      <StatusPill status={deployment.status} statusClass={deployment.statusClass} />
      <div class="actions">
        <button onclick={() => onscale(deployment)}>Escalar</button>
        <button onclick={() => onrestart(deployment)}>Reiniciar</button>
      </div>
    {/if}
  </header>

  {#if !deployment}
    <p class="gone">{loading ? 'Carregando…' : 'Este deployment não existe mais no cluster.'}</p>
  {:else}
    <div class="content">
      <section class="grid">
        <div><span class="k">Namespace</span><span>{deployment.namespace}</span></div>
        <div>
          <span class="k">Réplicas</span>
          <span class="mono">{deployment.ready}/{deployment.desired} prontas · {deployment.upToDate} atualizadas · {deployment.available} disponíveis</span>
        </div>
        <div><span class="k">Estratégia</span><span>{deployment.strategy}{deployment.paused ? ' (pausado)' : ''}</span></div>
        <div><span class="k">Revisão</span><span class="mono">{deployment.revision || '-'}</span></div>
        <div><span class="k">Criado</span><span>{dateTime(deployment.created)} <span class="muted">({formatAge(deployment.created, now.value)})</span></span></div>
        <div><span class="k">Seletor</span><code>{deployment.selector || '-'}</code></div>
      </section>

      <section>
        <h2>Condições</h2>
        {#if deployment.conditions.length === 0}
          <p class="muted">Nenhuma condição reportada.</p>
        {:else}
          <table class="small">
            <thead><tr><th>Tipo</th><th>Status</th><th>Motivo</th><th>Mensagem</th><th>Desde</th></tr></thead>
            <tbody>
              {#each deployment.conditions as c (c.type)}
                <tr>
                  <td>{c.type}</td>
                  <td class:ok={c.status === 'True'} class:bad={c.status === 'False'}>{c.status}</td>
                  <td>{c.reason || '-'}</td>
                  <td class="msg">{c.message || '-'}</td>
                  <td class="mono">{c.lastTransition ? formatAge(c.lastTransition, now.value) : '-'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <section>
        <h2>Containers</h2>
        <div class="containers">
          {#each deployment.containers as c (c.name)}
            <div class="container">
              <strong>{c.name}</strong>
              <div><span class="k">Imagem</span><code>{c.image}</code></div>
              <div><span class="k">Portas</span><span class="mono">{c.ports.join(', ') || '-'}</span></div>
              <div><span class="k">Requests</span><span class="mono">{resources(c.requests)}</span></div>
              <div><span class="k">Limits</span><span class="mono">{resources(c.limits)}</span></div>
            </div>
          {/each}
        </div>
      </section>

      {#if Object.keys(deployment.labels).length > 0}
        <section>
          <h2>Labels</h2>
          <div class="labels">
            {#each Object.entries(deployment.labels) as [k, v] (k)}
              <code class="label">{k}={v}</code>
            {/each}
          </div>
        </section>
      {/if}

      <section class="pods">
        <h2>Pods</h2>
        {#if deployment.selector}
          <div class="pods-table">
            <PodsTable namespace={deployment.namespace} labelSelector={deployment.selector}
                       selected={logPod?.uid} onlogs={(p) => (logPod = p)}
                       emptyText="Nenhum pod deste deployment" />
          </div>
          {#if logPod}
            <div class="logs">
              {#key logPod.uid}
                <LogViewer pod={logPod} onclose={() => (logPod = null)} />
              {/key}
            </div>
          {/if}
        {:else}
          <p class="muted">Deployment sem seletor: não há como saber quais pods são dele.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  header {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .back { font-size: 12px; }
  h1 { font-size: 18px; font-weight: 600; user-select: text; }
  .actions { margin-left: auto; display: flex; gap: 8px; }
  .gone { padding: 32px; color: var(--muted); text-align: center; }

  .content { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 22px; }
  h2 { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 10px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px 24px; }
  .grid > div, .container > div { display: flex; flex-direction: column; gap: 3px; user-select: text; }
  .k { font-size: 11px; color: var(--muted); }
  .muted { color: var(--muted); }
  .mono, code { font-family: var(--mono); font-size: 12px; }
  code { word-break: break-all; }

  table.small { width: 100%; border-collapse: collapse; }
  .small th { text-align: left; font-weight: 500; color: var(--muted); padding: 6px 10px; border-bottom: 1px solid var(--border); }
  .small td { padding: 6px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; user-select: text; }
  .small .msg { white-space: normal; max-width: 520px; }
  .ok { color: var(--ok); }
  .bad { color: var(--err); }

  .containers { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  .container { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }

  .labels { display: flex; flex-wrap: wrap; gap: 6px; }
  .label { padding: 2px 8px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }

  .pods { display: flex; flex-direction: column; }
  .pods-table { height: 260px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .pods-table > :global(section) { flex: 1; }
  .logs { height: 380px; display: flex; flex-direction: column; margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .logs > :global(section) { flex: 1; border-top: 0; }
</style>
