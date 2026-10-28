<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { SearchAddon } from '@xterm/addon-search'
  import type { LogOptions, PodRow, Unsubscribe } from '@shared/api'

  let { pod, onclose }: { pod: PodRow; onclose: () => void } = $props()

  // O componente é recriado quando o pod muda ({#key} no pai), então o valor
  // inicial vir do pod é intencional
  // svelte-ignore state_referenced_locally
  let container = $state(pod.containers[0] ?? '')
  let tailLines = $state(500)
  let timestamps = $state(false)
  let follow = $state(true)
  let query = $state('')

  let ready = $state(false)
  let streaming = $state(false)
  let ended = $state('')
  let total = $state(0)
  let rate = $state(0)

  let el: HTMLDivElement
  let term: Terminal
  let search: SearchAddon
  let unsubscribe: Unsubscribe | null = null

  onMount(() => {
    let disposed = false
    let cleanup = () => {}

    // O xterm mede os caracteres ao abrir: com a fonte ainda carregando, o
    // espaçamento sai errado. Espera a JetBrains Mono (empacotada, é rápido)
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

    // Linhas por segundo, para ter um número ao comparar com o app antigo
    let last = 0
    const rateTimer = setInterval(() => {
      rate = total - last
      last = total
    }, 1000)

    ready = true
    return () => {
      clearInterval(rateTimer)
      ro.disconnect()
      stop()
      term.dispose()
    }
  }

  // Reabre o stream quando o container ou as opções mudam
  $effect(() => {
    if (!ready) return
    const opts: LogOptions = { namespace: pod.namespace, pod: pod.name, container, tailLines, timestamps, follow }
    untrack(() => start(opts))
  })

  function stop() {
    unsubscribe?.()
    unsubscribe = null
    streaming = false
  }

  function start(opts: LogOptions) {
    stop()
    term.reset()
    total = 0
    ended = ''
    streaming = true

    unsubscribe = window.kube.streamLogs(
      opts,
      (lines) => {
        // Um write por lote: o xterm agrupa o render, seja qual for o tamanho
        term.write(lines.join('\r\n') + '\r\n')
        total += lines.length
      },
      (error) => {
        unsubscribe = null
        streaming = false
        ended = error ? `Erro: ${error}` : 'Stream encerrado'
      },
    )
  }

  function reopen() {
    start({ namespace: pod.namespace, pod: pod.name, container, tailLines, timestamps, follow })
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !query) return
    if (e.shiftKey) search.findPrevious(query)
    else search.findNext(query)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={onKey} />

<section aria-label="Logs de {pod.name}">
  <div class="bar">
    <strong class="pod" title={pod.name}>{pod.name}</strong>

    <label>
      Container
      {#if pod.containers.length > 1}
        <select bind:value={container}>
          {#each pod.containers as c (c)}<option value={c}>{c}</option>{/each}
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
      {#if streaming}<span class="live" aria-hidden="true">●</span>{/if}
      {total.toLocaleString('pt-BR')} linhas · {rate.toLocaleString('pt-BR')}/s
      {#if ended}<span class:err={ended.startsWith('Erro')}>· {ended}</span>{/if}
    </span>

    {#if streaming}
      <button onclick={stop}>Parar</button>
    {:else}
      <button onclick={reopen}>Reabrir</button>
    {/if}
    <button onclick={() => term?.clear()}>Limpar</button>
    <button onclick={onclose} aria-label="Fechar logs" title="Fechar (Esc)">✕</button>
  </div>
  <div class="term" bind:this={el}></div>
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--border); background: var(--term-bg); }
  .bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .pod { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search { flex: 0 1 220px; min-width: 120px; }
  .value { color: var(--text); }
  .stats { margin-left: auto; color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .live { color: var(--ok); }
  .err { color: var(--fail-text); }
  .term { flex: 1; min-height: 0; padding: 4px 0 0 8px; }
</style>
