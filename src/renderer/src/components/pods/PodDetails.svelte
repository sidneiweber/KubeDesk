<script lang="ts">
  import { tick } from 'svelte'
  import type { ContainerDetail, PodDetail } from '@shared/api'
  import { containerState } from '../../lib/containerState'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { PodMetrics } from '../../lib/podMetrics.svelte'
  import { formatCpu, formatMemory } from '../../lib/usage'
  import { openYaml } from '../../lib/yaml.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import UsageCell from '../table/UsageCell.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Section from '../detail/Section.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import LogViewer from '../logs/LogViewer.svelte'
  import DeletePodDialog from './DeletePodDialog.svelte'

  // O pod é observado pelo nome (e não pelo uid): um pod de StatefulSet
  // apagado volta com o mesmo nome, e a página continua valendo.

  let { namespace, name, onback }: { namespace: string; name: string; onback: () => void } = $props()

  const pods = new LiveList('poddetails', () => ({ namespace, fieldSelector: `metadata.name=${name}` }))
  const pod = $derived<PodDetail | undefined>(pods.rows[0])

  const uid = $derived(pod?.uid)
  const events = new LiveList('events', () => (uid ? { namespace, fieldSelector: `involvedObject.uid=${uid}` } : null))
  const sortedEvents = $derived([...events.rows].sort((a, b) => b.last - a.last))

  const metrics = new PodMetrics(() => namespace)
  const usage = $derived(metrics.of(namespace, name))
  const unavailable = $derived(metrics.available === false ? metrics.reason : '')

  let showLogs = $state(false)
  let deleting = $state(false)
  let logsEl = $state<HTMLElement>()

  async function openLogs() {
    showLogs = true
    await tick()
    logsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const cpu = (n: number | null) => (n === null ? '-' : formatCpu(n))
  const mem = (n: number | null) => (n === null ? '-' : formatMemory(n))
  const ago = (ms: number) => (ms ? formatAge(ms, now.value) : '-')
  const annotations = $derived(Object.entries(pod?.annotations ?? {}))
</script>

{#snippet container(c: ContainerDetail, init: boolean)}
  {@const st = containerState(c)}
  {@const used = init ? undefined : usage?.containers.find((u) => u.name === c.name)}
  <div class="container">
    <div class="head">
      <strong>{c.name}</strong>
      <StatusPill status={st.status} statusClass={st.statusClass} />
      {#if c.since}<span class="muted">há {ago(c.since)}</span>{/if}
    </div>
    {#if c.message}<p class="message">{c.message}</p>{/if}
    <Fields fields={[
      { label: 'Imagem', value: c.image, code: true },
      { label: 'Reinícios', value: String(c.restarts) + (c.lastTermination ? ` · último: ${c.lastTermination}` : '') },
      { label: 'Portas', value: c.ports.join(', '), code: true },
      { label: 'CPU (request / limit)', value: `${cpu(c.cpuRequest)} / ${cpu(c.cpuLimit)}`, code: true },
      { label: 'Memória (request / limit)', value: `${mem(c.memoryRequest)} / ${mem(c.memoryLimit)}`, code: true },
    ]} />
    {#if !init && c.state === 'Running'}
      <dl class="cusage">
        <div><dt>Uso de CPU</dt><dd><UsageCell used={used?.cpu} request={c.cpuRequest} limit={c.cpuLimit} format={formatCpu} {unavailable} /></dd></div>
        <div><dt>Uso de memória</dt><dd><UsageCell used={used?.memory} request={c.memoryRequest} limit={c.memoryLimit} format={formatMemory} {unavailable} /></dd></div>
      </dl>
    {/if}
  </div>
{/snippet}

<DetailPage back="Pods" {onback} title={pod?.name ?? name} found={!!pod} loading={pods.loading}>
  {#snippet after()}
    {#if pod}<StatusPill status={pod.status} statusClass={pod.statusClass} />{/if}
  {/snippet}
  {#snippet actions()}
    {#if pod}
      <button onclick={openLogs}>Logs</button>
      <button onclick={() => openYaml('pods', pod.namespace, pod.name)}>YAML</button>
      <button class="danger" onclick={() => (deleting = true)}>Apagar…</button>
    {/if}
  {/snippet}

  {#if pod}
    {#if pods.error}<div class="error-box" role="alert">{pods.error}</div>{/if}

    <Fields fields={[
      { label: 'Namespace', value: pod.namespace },
      { label: 'Node', value: pod.node },
      { label: 'IP do pod', value: pod.podIPs.join(', ') || pod.ip, code: true },
      { label: 'IP do node', value: pod.hostIP, code: true },
      { label: 'Controlado por', value: pod.owner || 'nenhum (pod avulso)' },
      { label: 'Containers prontos', value: `${pod.ready} · ${pod.restarts} reinícios` },
      { label: 'QoS', value: pod.qosClass },
      { label: 'Conta de serviço', value: pod.serviceAccount },
      { label: 'Restart policy', value: pod.restartPolicy },
      ...(pod.priorityClass ? [{ label: 'Priority class', value: pod.priorityClass }] : []),
      { label: 'Criado', value: `${formatDateTime(pod.created)} (${ago(pod.created)})` },
      { label: 'Iniciado', value: pod.startTime ? `${formatDateTime(pod.startTime)} (${ago(pod.startTime)})` : '-' },
    ]} />

    <div class="usage total">
      <span class="muted">Uso do pod</span>
      <UsageCell used={usage?.cpu} request={pod.cpuRequest} limit={pod.cpuLimit} format={formatCpu} {unavailable} />
      <UsageCell used={usage?.memory} request={pod.memoryRequest} limit={pod.memoryLimit} format={formatMemory} {unavailable} />
    </div>

    {#if pod.initContainers.length > 0}
      <Section title="Init containers">
        <div class="containers">
          {#each pod.initContainers as c (c.name)}{@render container(c, true)}{/each}
        </div>
      </Section>
    {/if}

    <Section title="Containers">
      <div class="containers">
        {#each pod.containerDetails as c (c.name)}{@render container(c, false)}{/each}
      </div>
    </Section>

    <Section title="Eventos">
      {#if events.error}
        <p class="muted">Não foi possível ler os eventos: {events.error}</p>
      {:else if sortedEvents.length === 0}
        <p class="muted">{events.loading ? 'Carregando…' : 'Nenhum evento recente (o cluster costuma guardar só a última hora).'}</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Tipo</th><th>Motivo</th><th>Mensagem</th><th>Vezes</th><th>Última</th><th>Origem</th></tr></thead>
          <tbody>
            {#each sortedEvents as e (e.uid)}
              <tr>
                <td class:bad={e.type === 'Warning'}>{e.type}</td>
                <td>{e.reason}</td>
                <td class="text">{e.message}</td>
                <td class="mono">{e.count}</td>
                <td class="mono" title={formatDateTime(e.last)}>{ago(e.last)}</td>
                <td>{e.source || '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Section>

    <Section title="Condições">
      {#if pod.conditions.length === 0}
        <p class="muted">Nenhuma condição reportada.</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Tipo</th><th>Status</th><th>Motivo</th><th>Mensagem</th><th>Desde</th></tr></thead>
          <tbody>
            {#each pod.conditions as c (c.type)}
              <tr>
                <td>{c.type}</td>
                <td class:ok={c.status === 'True'} class:bad={c.status === 'False'}>{c.status}</td>
                <td class="text">{c.reason || '-'}</td>
                <td class="text">{c.message || '-'}</td>
                <td class="mono">{ago(c.lastTransition)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Section>

    {#if pod.volumes.length > 0}
      <Section title="Volumes">
        <table class="detail-table">
          <thead><tr><th>Nome</th><th>Tipo</th><th>Origem</th></tr></thead>
          <tbody>
            {#each pod.volumes as v (v.name)}
              <tr><td>{v.name}</td><td>{v.kind}</td><td class="mono">{v.source || '-'}</td></tr>
            {/each}
          </tbody>
        </table>
      </Section>
    {/if}

    <Labels labels={pod.labels} />

    {#if annotations.length > 0}
      <Section title="Annotations">
        <table class="detail-table">
          <tbody>
            {#each annotations as [k, v] (k)}
              <tr><td class="mono">{k}</td><td class="mono text"><div class="clamp">{v}</div></td></tr>
            {/each}
          </tbody>
        </table>
      </Section>
    {/if}

    {#if showLogs}
      <div bind:this={logsEl}>
        <Section title="Logs">
          <div class="logs">
            {#key pod.uid}
              <LogViewer {pod} onclose={() => (showLogs = false)} />
            {/key}
          </div>
        </Section>
      </div>
    {/if}
  {/if}
</DetailPage>

{#if deleting && pod}
  <DeletePodDialog {pod} onclose={() => (deleting = false)} />
{/if}

<style>
  .muted { color: var(--muted); }
  .containers { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .container { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); min-width: 0; }
  .container :global(dl) { grid-template-columns: 1fr; gap: 8px; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .head .muted { font-size: 12px; }
  .message { font-size: 12px; color: var(--fail); user-select: text; overflow-wrap: anywhere; }
  .usage { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-family: var(--mono); font-size: 12px; }
  .usage > .muted { font-family: inherit; font-size: 11px; min-width: 70px; }
  .usage.total > .muted { font-family: var(--sans, inherit); }
  .container dl.cusage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cusage div { display: flex; flex-direction: column; gap: 3px; }
  .cusage dt { font-size: 11px; color: var(--muted); }
  .cusage dd { font-family: var(--mono); font-size: 12px; }
  .clamp { max-height: 6em; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .logs { height: 420px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .logs > :global(section) { flex: 1; border-top: 0; }
</style>
