<script lang="ts">
  import type { PodBatch, PodRow } from '@shared/api'
  import { formatAge } from '../../lib/formatAge'
  import { nextSort, readyFraction, sortRows, type Accessors, type SortState } from '../../lib/sort'

  let { namespace, selected, onlogs }: {
    namespace: string
    selected?: string
    onlogs: (p: PodRow) => void
  } = $props()

  // $state.raw: o Map é trocado inteiro a cada lote, sem proxy em cada pod
  let pods = $state.raw(new Map<string, PodRow>())
  let loading = $state(true)
  let error = $state('')
  let filter = $state('')
  let sort = $state<SortState | null>({ column: 'name', direction: 'asc' })
  let now = $state(Date.now())

  // A idade anda sozinha, sem pedir nada ao cluster
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })

  $effect(() => {
    loading = true
    error = ''
    pods = new Map()

    return window.kube.watchPods(
      namespace,
      (b: PodBatch) => {
        const next = b.reset ? new Map<string, PodRow>() : new Map(pods)
        for (const uid of b.deleted) next.delete(uid)
        for (const p of b.upsert) next.set(p.uid, p)
        pods = next
        loading = false
        error = ''
      },
      (msg) => {
        error = msg
        loading = false
      },
    )
  })

  const accessors: Accessors<PodRow> = {
    name: (p) => p.name,
    namespace: (p) => p.namespace,
    status: (p) => p.status,
    ready: (p) => readyFraction(p.ready),
    restarts: (p) => p.restarts,
    node: (p) => p.node,
    // Idade crescente = mais novo primeiro
    age: (p) => (p.created ? -p.created : null),
  }

  const columns = $derived([
    { key: 'name', label: 'Nome' },
    ...(namespace === '' ? [{ key: 'namespace', label: 'Namespace' }] : []),
    { key: 'status', label: 'Status' },
    { key: 'ready', label: 'Ready' },
    { key: 'restarts', label: 'Restarts' },
    { key: 'node', label: 'Node' },
    { key: 'age', label: 'Idade' },
  ])

  // A busca é local: filtra o que já está em memória, sem ir ao cluster
  const rows = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    const all = [...pods.values()]
    const matched = q
      ? all.filter((p) => p.name.toLowerCase().includes(q) || p.status.toLowerCase().includes(q) || p.node.toLowerCase().includes(q))
      : all
    return sortRows(matched, accessors, sort)
  })

  function ariaSort(key: string) {
    if (sort?.column !== key) return 'none'
    return sort.direction === 'asc' ? 'ascending' : 'descending'
  }
</script>

<section>
  <div class="toolbar">
    <input type="search" placeholder="Filtrar por nome, status ou node" bind:value={filter} aria-label="Filtrar pods" />
    <span class="count" aria-live="polite">
      {#if loading}
        Carregando…
      {:else}
        {rows.length}{rows.length !== pods.size ? ` de ${pods.size}` : ''} pods
      {/if}
    </span>
  </div>

  {#if error}
    <div class="error-box" role="alert">{error}</div>
  {/if}

  <div class="scroll">
    <table>
      <thead>
        <tr>
          {#each columns as c (c.key)}
            <th aria-sort={ariaSort(c.key)}>
              <button onclick={() => (sort = nextSort(sort, c.key))}>
                {c.label}<span class="arrow">{sort?.column === c.key ? (sort.direction === 'asc' ? '▲' : '▼') : ''}</span>
              </button>
            </th>
          {/each}
          <th><span class="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as p (p.uid)}
          <tr class:selected={p.uid === selected} ondblclick={() => onlogs(p)}>
            <td class="name">{p.name}</td>
            {#if namespace === ''}<td>{p.namespace}</td>{/if}
            <td><span class="pill {p.statusClass}">{p.status}</span></td>
            <td class="mono">{p.ready}</td>
            <td class="mono" class:warn={p.restarts > 0}>{p.restarts}</td>
            <td class="muted">{p.node || '-'}</td>
            <td class="mono">{formatAge(p.created, now)}</td>
            <td class="actions"><button onclick={() => onlogs(p)} aria-label="Logs de {p.name}">Logs</button></td>
          </tr>
        {:else}
          {#if !loading && !error}
            <tr><td class="empty" colspan={columns.length + 1}>{filter ? 'Nenhum pod corresponde ao filtro' : 'Nenhum pod neste namespace'}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; }
  .toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .toolbar input { width: 320px; }
  .count { color: var(--muted); }
  .error-box { margin: 0 16px 10px; }

  .scroll { flex: 1; min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--surface); border-bottom: 1px solid var(--border); text-align: left; }
  th button { all: unset; display: flex; gap: 4px; padding: 8px 12px; cursor: pointer; font-weight: 500; color: var(--muted); }
  th button:hover, th[aria-sort='ascending'] button, th[aria-sort='descending'] button { color: var(--text); }
  th button:focus-visible { outline: 2px solid var(--accent); }
  .arrow { font-size: 9px; align-self: center; }

  td { padding: 6px 12px; border-bottom: 1px solid var(--border-subtle); white-space: nowrap; }
  tbody tr:hover { background: #222; }
  tr.selected, tr.selected:hover { background: rgba(74, 158, 255, .12); }
  .name { user-select: text; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .muted { color: var(--muted); }
  .warn { color: var(--warn); }
  .empty { text-align: center; color: var(--muted); padding: 32px; }
  .actions { text-align: right; }
  .actions button { padding: 2px 10px; font-size: 12px; }

  .pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .pill.running { background: rgba(74, 222, 128, .15); color: var(--ok); }
  .pill.succeeded { background: rgba(167, 139, 250, .15); color: var(--done); }
  .pill.pending { background: rgba(251, 191, 36, .15); color: var(--warn); }
  .pill.failed { background: rgba(239, 68, 68, .15); color: var(--err); }
  .pill.unknown { background: var(--surface-2); color: var(--muted); }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
