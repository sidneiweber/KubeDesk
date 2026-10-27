<script lang="ts">
  import type { DeploymentRow, PodRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import PageHeader from '../PageHeader.svelte'
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
  <div class="head">
    <button class="back" onclick={onback}>← Deployments</button>
    <PageHeader title={deployment?.name ?? 'Deployment'} namespace={deployment?.namespace}>
      {#snippet after()}
        {#if deployment}<StatusPill status={deployment.status} statusClass={deployment.statusClass} />{/if}
      {/snippet}
      {#snippet actions()}
        {#if deployment}
          <button onclick={() => onscale(deployment)}>Escalar</button>
          <button onclick={() => onrestart(deployment)}>Reiniciar</button>
        {/if}
      {/snippet}
    </PageHeader>
  </div>

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
        <h2 class="eyebrow">Condições</h2>
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
        <h2 class="eyebrow">Containers</h2>
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
          <h2 class="eyebrow">Labels</h2>
          <div class="labels">
            {#each Object.entries(deployment.labels) as [k, v] (k)}
              <code class="label">{k}={v}</code>
            {/each}
          </div>
        </section>
      {/if}

      <section class="pods">
        <h2 class="eyebrow">Pods</h2>
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
  .head { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px 32px 18px; border-bottom: 1px solid var(--border); }
  .head > :global(header) { align-self: stretch; }
  .back { height: 28px; padding: 0 10px; font-size: 12px; }
  .gone { padding: 40px; color: var(--muted); text-align: center; }

  .content { flex: 1; min-height: 0; overflow: auto; padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 28px; }
  h2 { margin-bottom: 12px; }

  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px 28px;
    padding: 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--head-bg);
  }
  .grid > div, .container > div { display: flex; flex-direction: column; gap: 3px; user-select: text; color: var(--text-2); }
  .k { font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .muted { color: var(--muted); }
  .mono, code { font-family: var(--mono); font-size: 13px; }
  code { word-break: break-all; color: var(--navy); }

  table.small { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .small tbody tr:last-child td { border-bottom: 0; }
  .small th {
    text-align: left; padding: 10px 16px; background: var(--head-bg); border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
  }
  .small td { padding: 9px 16px; border-bottom: 1px solid var(--border); vertical-align: top; user-select: text; color: var(--text-2); }
  .small td:first-child { color: var(--navy); font-weight: 500; font-family: var(--mono); font-size: 13px; }
  .small .msg { white-space: normal; max-width: 520px; }
  .small td.ok { color: var(--ok); font-weight: 500; }
  .small td.bad { color: var(--fail); font-weight: 500; }

  .containers { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  .container { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; }
  .container strong { font-family: var(--mono); font-size: 14px; color: var(--navy); }

  .labels { display: flex; flex-wrap: wrap; gap: 6px; }
  .label { padding: 3px 10px; border-radius: 999px; background: var(--gelo); border: 1px solid var(--border); font-size: 12px; }

  .pods { display: flex; flex-direction: column; }
  .pods-table { height: 300px; display: flex; flex-direction: column; }
  .pods-table > :global(section) { flex: 1; }
  .logs { height: 380px; display: flex; flex-direction: column; margin-top: 16px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .logs > :global(section) { flex: 1; border-top: 0; }
</style>
