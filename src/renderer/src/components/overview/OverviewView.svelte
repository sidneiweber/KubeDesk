<script lang="ts">
  import type { StatusClass } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { nav, type Section } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { eventTarget, podClass, problems, tally, type Item, type Tally } from '../../lib/overview'
  import { PodMetrics } from '../../lib/podMetrics.svelte'
  import { session } from '../../lib/session.svelte'
  import { formatCpu, formatMemory } from '../../lib/usage'
  import StatusPill from '../table/StatusPill.svelte'

  // Visão geral do namespace escolhido (ou do cluster todo): um card por tipo
  // de recurso com a saúde na borda, o que precisa de atenção e os avisos
  // recentes. Tudo ao vivo, pelas mesmas listas das outras telas.

  const opts = () => ({ namespace: session.namespace })
  const pods = new LiveList('pods', opts)
  const deployments = new LiveList('deployments', opts)
  const statefulsets = new LiveList('statefulsets', opts)
  const daemonsets = new LiveList('daemonsets', opts)
  const jobs = new LiveList('jobs', opts)
  const cronjobs = new LiveList('cronjobs', opts)
  const services = new LiveList('services', opts)
  const pvcs = new LiveList('pvcs', opts)
  // Só avisos: os eventos Normal são a maioria e não dizem nada aqui
  const warnings = new LiveList('events', () => ({ namespace: session.namespace, fieldSelector: 'type=Warning' }))
  const metrics = new PodMetrics(() => session.namespace)

  // Pod rodando com container não pronto conta como pendente
  const podItems: Item[] = $derived(
    pods.rows.map((p) => {
      const statusClass = podClass(p)
      const status = statusClass !== p.statusClass ? `${p.status} (${p.ready} prontos)` : p.status
      return { uid: p.uid, namespace: p.namespace, name: p.name, status, statusClass }
    }),
  )
  // Service não tem status; LoadBalancer sem endereço é o único sinal de problema
  const serviceItems: Item[] = $derived(
    services.rows.map((s) => {
      const statusClass: StatusClass = s.externalIP === '<pending>' ? 'pending' : 'running'
      return { uid: s.uid, namespace: s.namespace, name: s.name, status: statusClass === 'pending' ? 'LoadBalancer <pending>' : s.type, statusClass }
    }),
  )

  interface Card {
    title: string
    kind: string
    section: Section
    list: { loading: boolean; error: string }
    items: readonly Item[]
    /** Nome do que não pesa na saúde ("concluídos", "suspensos"). */
    otherLabel: string
  }

  const cards: Card[] = $derived([
    { title: 'Pods', kind: 'Pod', section: 'pods', list: pods, items: podItems, otherLabel: 'concluídos' },
    { title: 'Deployments', kind: 'Deployment', section: 'deployments', list: deployments, items: deployments.rows, otherLabel: 'em 0 réplicas' },
    { title: 'StatefulSets', kind: 'StatefulSet', section: 'statefulsets', list: statefulsets, items: statefulsets.rows, otherLabel: 'em 0 réplicas' },
    { title: 'DaemonSets', kind: 'DaemonSet', section: 'daemonsets', list: daemonsets, items: daemonsets.rows, otherLabel: 'sem nodes' },
    { title: 'Jobs', kind: 'Job', section: 'jobs', list: jobs, items: jobs.rows, otherLabel: 'concluídos' },
    { title: 'CronJobs', kind: 'CronJob', section: 'cronjobs', list: cronjobs, items: cronjobs.rows, otherLabel: 'agendados/suspensos' },
    { title: 'Services', kind: 'Service', section: 'services', list: services, items: serviceItems, otherLabel: '' },
    { title: 'PVCs', kind: 'PersistentVolumeClaim', section: 'pvcs', list: pvcs, items: pvcs.rows, otherLabel: '' },
  ])

  const tallies = $derived(cards.map((c) => tally(c.items)))
  const attention = $derived(problems(cards.map((c) => ({ kind: c.kind, section: c.section, items: c.items }))))
  const ATTENTION_MAX = 15

  const recentWarnings = $derived([...warnings.rows].sort((a, b) => b.last - a.last).slice(0, 10))

  // Uso somado contra o que os pods reservam (requests)
  const usage = $derived.by(() => {
    let cpu = 0
    let memory = 0
    for (const u of metrics.usage.values()) {
      cpu += u.cpu
      memory += u.memory
    }
    let cpuReq = 0
    let memReq = 0
    for (const p of pods.rows) {
      // Pods terminados não ocupam nada no node
      if (p.statusClass === 'succeeded' || p.statusClass === 'failed') continue
      cpuReq += p.cpuRequest ?? 0
      memReq += p.memoryRequest ?? 0
    }
    return { cpu, memory, cpuReq, memReq }
  })

  function legend(t: Tally, otherLabel: string): string {
    const parts = [`${t.ok} ok`]
    if (t.pending) parts.push(`${t.pending} pendentes`)
    if (t.failed) parts.push(`${t.failed} com falha`)
    if (t.other) parts.push(`${t.other} ${otherLabel || 'outros'}`)
    return parts.join(' · ')
  }

  const pct = (n: number, t: Tally) => `${(n / t.total) * 100}%`
  const scope = $derived(session.namespace ? `namespace ${session.namespace}` : 'todos os namespaces')
</script>

<div class="page">
  <header>
    <h1>Overview</h1>
    <span class="scope">{session.context} · {scope}</span>
  </header>

  <div class="content">
    <div class="cards">
      {#each cards as c, i (c.section)}
        {@const t = tallies[i]}
        {@const loading = c.list.loading && t.total === 0}
        <button class="card {c.list.error ? 'empty' : loading ? 'empty' : t.health}" onclick={() => nav.go(c.section)}
                aria-label="{c.title}: {t.total}. {legend(t, c.otherLabel)}. Abrir lista">
          <span class="title">{c.title}</span>
          {#if c.list.error}
            <span class="count muted">–</span>
            <span class="legend" title={c.list.error}>Sem acesso</span>
          {:else if loading}
            <span class="count muted">…</span>
            <span class="legend">Carregando</span>
          {:else}
            <span class="count">{t.total}</span>
            {#if t.total > 0}
              <span class="bar" aria-hidden="true">
                <span class="seg ok" style:width={pct(t.ok, t)}></span>
                <span class="seg pend" style:width={pct(t.pending, t)}></span>
                <span class="seg fail" style:width={pct(t.failed, t)}></span>
                <span class="seg other" style:width={pct(t.other, t)}></span>
              </span>
              <span class="legend">{legend(t, c.otherLabel)}</span>
            {:else}
              <span class="legend">Nenhum</span>
            {/if}
          {/if}
        </button>
      {/each}
    </div>

    <section>
      <h2 class="eyebrow">Uso dos pods</h2>
      {#if metrics.available === false}
        <p class="muted">Métricas indisponíveis: {metrics.reason}</p>
      {:else if metrics.available === null}
        <p class="muted">Carregando…</p>
      {:else}
        <div class="usage">
          <div class="stat">
            <span class="label">CPU em uso</span>
            <span class="value">{formatCpu(usage.cpu)}</span>
            <span class="sub">requests somam {formatCpu(usage.cpuReq)}</span>
          </div>
          <div class="stat">
            <span class="label">Memória em uso</span>
            <span class="value">{formatMemory(usage.memory)}</span>
            <span class="sub">requests somam {formatMemory(usage.memReq)}</span>
          </div>
        </div>
      {/if}
    </section>

    <section>
      <h2 class="eyebrow">Precisa de atenção</h2>
      {#if attention.length === 0}
        <p class="good">Tudo certo: nenhum recurso com falha ou pendente.</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Tipo</th><th>Nome</th>{#if !session.namespace}<th>Namespace</th>{/if}<th>Status</th></tr></thead>
          <tbody>
            {#each attention.slice(0, ATTENTION_MAX) as p (p.uid)}
              <tr>
                <td>{p.kind}</td>
                <td><button class="link" onclick={() => nav.go(p.section, { namespace: p.namespace, name: p.name })}>{p.name}</button></td>
                {#if !session.namespace}<td>{p.namespace}</td>{/if}
                <td><StatusPill status={p.status} statusClass={p.statusClass} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if attention.length > ATTENTION_MAX}
          <p class="muted more">e mais {attention.length - ATTENTION_MAX}. Veja as listas de cada tipo.</p>
        {/if}
      {/if}
    </section>

    <section>
      <h2 class="eyebrow">Avisos recentes</h2>
      {#if warnings.error}
        <p class="muted">Não foi possível ler os eventos: {warnings.error}</p>
      {:else if warnings.loading}
        <p class="muted">Carregando…</p>
      {:else if recentWarnings.length === 0}
        <p class="good">Nenhum aviso recente (o cluster costuma guardar só a última hora).</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Quando</th><th>Objeto</th><th>Motivo</th><th>Mensagem</th><th>Vezes</th></tr></thead>
          <tbody>
            {#each recentWarnings as e (e.uid)}
              {@const target = eventTarget(e.object)}
              <tr>
                <!-- Relógio do cluster um pouco à frente: o aviso acabou de acontecer -->
                <td class="mono" title={formatDateTime(e.last)}>{formatAge(Math.min(e.last, now.value), now.value)}</td>
                <td>
                  {#if target}
                    <button class="link" onclick={() => nav.go(target.section, { namespace: e.namespace, name: target.name })}>{e.object}</button>
                  {:else}{e.object}{/if}
                </td>
                <td>{e.reason}</td>
                <td class="text">{e.message}</td>
                <td class="mono">{e.count}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  header { display: flex; align-items: baseline; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  h1 { font-size: 18px; font-weight: 600; }
  .scope { color: var(--muted); font-size: 12px; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 24px; }
  section { display: flex; flex-direction: column; }
  h2 { font-size: 13px; letter-spacing: .05em; margin-bottom: 10px; }
  .muted { color: var(--muted); }
  .good { color: var(--ok); }
  .more { margin-top: 8px; font-size: 12px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .card {
    all: unset; box-sizing: border-box; cursor: pointer;
    display: flex; flex-direction: column; gap: 8px; padding: 14px 16px;
    background: var(--surface); border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px;
  }
  .card:hover { background: var(--surface-2); }
  .card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .card.ok { border-color: var(--ok); }
  .card.warn { border-color: var(--pend); }
  .card.bad { border-color: var(--fail); }
  .title { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .count { font-size: 28px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
  .legend { font-size: 12px; color: var(--muted); }
  .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--surface-2); }
  .seg.ok { background: var(--ok); }
  .seg.pend { background: var(--pend); }
  .seg.fail { background: var(--fail); }
  .seg.other { background: var(--done); }

  .usage { display: flex; gap: 12px; flex-wrap: wrap; }
  .stat { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; min-width: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .label { font-size: 11px; color: var(--muted); }
  .value { font-size: 22px; font-weight: 600; font-family: var(--mono); }
  .sub { font-size: 12px; color: var(--muted); }

  .link { all: unset; cursor: pointer; color: var(--accent); }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--focus); }
</style>
