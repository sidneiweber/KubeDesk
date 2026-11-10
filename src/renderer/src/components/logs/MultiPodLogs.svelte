<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { SearchAddon } from '@xterm/addon-search'
  import type { PodRow, Unsubscribe } from '@shared/api'
  import { LiveList } from '../../lib/liveList.svelte'

  // Logs de todos os pods de um seletor (os de um deployment), juntos num
  // terminal só, como o `kubectl logs -l app=web --prefix`. Com mais de um pod
  // cada linha ganha uma coluna com o nome do pod, numa cor por pod.
  //
  // Pods que surgem depois (rollout, escala) entram sozinhos; um pod que ainda
  // não tinha container rodando é tentado de novo quando o status dele muda.

  let { namespace, selector, containers }: {
    namespace: string
    selector: string
    /** Containers do template, para escolher qual ler. */
    containers: string[]
  } = $props()

  const pods = new LiveList('pods', () => (selector ? { namespace, labelSelector: selector } : null))
  const sortedPods = $derived([...pods.rows].sort((a, b) => a.name.localeCompare(b.name)))

  // svelte-ignore state_referenced_locally
  let container = $state(containers[0] ?? '')
  /** '' = todos os pods. */
  let podFilter = $state('')
  let tailLines = $state(500)
  let timestamps = $state(false)
  let follow = $state(true)
  let query = $state('')

  let ready = $state(false)
  let total = $state(0)
  let active = $state(0)

  const targets = $derived(
    sortedPods.filter((p) => (podFilter === '' || p.name === podFilter) && (container === '' || p.containers.includes(container))),
  )
  const showPod = $derived(targets.length > 1)

  interface Stream {
    stop: Unsubscribe
    /** Status do pod quando o stream abriu. */
    status: string
    /** Erro que encerrou o stream; null = ainda aberto ou terminou sem erro. */
    failed: string | null
    done: boolean
  }
  let streams = new Map<string, Stream>()
  const colors = new Map<string, number>()
  let podWidth = 0

  // Cores ANSI legíveis em fundo escuro
  const PALETTE = [36, 32, 33, 35, 94, 96, 92, 93, 95, 91]

  let el: HTMLDivElement
  let term: Terminal
  let search: SearchAddon

  onMount(() => {
    let disposed = false
    let cleanup = () => {}
    void document.fonts.load("400 12px 'JetBrains Mono'").finally(() => {
      if (disposed) return
      cleanup = openTerminal()
    })
    return () => {
      disposed = true
      cleanup()
    }
  })

  function openTerminal(): () => void {
    term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      scrollback: 100_000,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      theme: { background: '#141414', foreground: '#e5e5e5', selectionBackground: '#4a9eff55', cursor: '#141414' },
    })
    const fit = new FitAddon()
    search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(el)
    fit.fit()
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(el)
    ready = true
    return () => {
      ro.disconnect()
      stopAll()
      term.dispose()
    }
  }

  function stopAll() {
    for (const s of streams.values()) s.stop()
    streams = new Map()
    active = 0
  }

  function prefix(pod: string): string {
    if (!showPod) return ''
    let c = colors.get(pod)
    if (c === undefined) {
      c = PALETTE[colors.size % PALETTE.length]
      colors.set(pod, c)
    }
    return `\x1b[${c}m${pod.padEnd(podWidth)}\x1b[0m \x1b[90m│\x1b[0m `
  }

  function note(pod: string, text: string) {
    term.write(`${prefix(pod)}\x1b[2m${text}\x1b[0m\r\n`)
  }

  function open(p: PodRow) {
    const entry: Stream = { stop: () => {}, status: p.status, failed: null, done: false }
    streams.set(p.uid, entry)
    active++
    entry.stop = window.kube.streamLogs(
      { namespace: p.namespace, pod: p.name, container: container || p.containers[0], tailLines, timestamps, follow },
      (lines) => {
        const pre = prefix(p.name)
        term.write(lines.map((l) => pre + l).join('\r\n') + '\r\n')
        total += lines.length
      },
      (error) => {
        entry.done = true
        entry.failed = error
        active--
        if (error) note(p.name, `sem logs: ${error}`)
      },
    )
  }

  // Opções mudaram: recomeça do zero
  $effect(() => {
    if (!ready) return
    void [container, podFilter, tailLines, timestamps, follow]
    untrack(() => {
      stopAll()
      term.reset()
      total = 0
      sync(targets)
    })
  })

  // Pods mudaram: abre os novos, reabre os que falharam e mudaram de status
  $effect(() => {
    if (!ready) return
    const list = targets
    untrack(() => sync(list))
  })

  function sync(list: PodRow[]) {
    podWidth = Math.max(podWidth, ...list.map((p) => p.name.length))
    const wanted = new Set(list.map((p) => p.uid))
    for (const [uid, s] of streams) {
      if (!wanted.has(uid)) {
        if (!s.done) active--
        s.stop()
        streams.delete(uid)
      }
    }
    for (const p of list) {
      const s = streams.get(p.uid)
      if (!s) open(p)
      else if (s.done && s.failed && s.status !== p.status) open(p)
    }
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !query) return
    if (e.shiftKey) search.findPrevious(query)
    else search.findNext(query)
  }
</script>

<section aria-label="Logs dos pods">
  <div class="bar">
    <label>
      Pod
      <select bind:value={podFilter}>
        <option value="">Todos ({sortedPods.length})</option>
        {#each sortedPods as p (p.uid)}<option value={p.name}>{p.name}</option>{/each}
      </select>
    </label>

    <label>
      Container
      {#if containers.length > 1}
        <select bind:value={container}>
          {#each containers as c (c)}<option value={c}>{c}</option>{/each}
        </select>
      {:else}
        <span class="value">{container}</span>
      {/if}
    </label>

    <label>
      Últimas
      <select bind:value={tailLines}>
        <option value={100}>100</option>
        <option value={500}>500</option>
        <option value={5000}>5.000</option>
        <option value={0}>todas</option>
      </select>
    </label>
    <label><input type="checkbox" bind:checked={timestamps} /> Timestamps</label>
    <label><input type="checkbox" bind:checked={follow} /> Seguir</label>

    <input type="search" class="search" placeholder="Buscar (Enter / Shift+Enter)" bind:value={query} onkeydown={onSearchKey} aria-label="Buscar no log" />

    <span class="stats" aria-live="polite">
      {#if active > 0}<span class="live" aria-hidden="true">●</span>{/if}
      {total.toLocaleString('pt-BR')} linhas · {active}/{targets.length} pods
    </span>
    <button onclick={() => term?.clear()}>Limpar</button>
  </div>

  {#if pods.error}<div class="error-box" role="alert">{pods.error}</div>{/if}
  {#if !pods.loading && sortedPods.length === 0}
    <p class="empty">Nenhum pod rodando agora.</p>
  {/if}
  <div class="term" bind:this={el}></div>
</section>

<style>
  section { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--term-bg); }
  .bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .bar select { max-width: 280px; }
  .search { flex: 0 1 220px; min-width: 120px; }
  .value { color: var(--text); }
  .stats { margin-left: auto; color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .live { color: var(--ok); }
  .error-box { margin: 12px 16px 0; }
  .empty { padding: 12px 16px 0; color: var(--muted); }
  .term { flex: 1; min-height: 0; padding: 4px 0 0 8px; }
</style>
