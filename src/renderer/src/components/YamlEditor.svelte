<script lang="ts">
  import { untrack } from 'svelte'
  import Prism from 'prismjs'
  import 'prismjs/components/prism-yaml'
  import type { WatchKind } from '@shared/api'
  import { toasts } from '../lib/toasts.svelte'

  // YAML editável no lugar, como o `kubectl edit`. Um <textarea> transparente
  // fica por cima do código realçado: o texto é o mesmo, então os dois
  // precisam ter exatamente a mesma fonte, margem e quebra de linha.
  //
  // O texto é um retrato de quando foi lido. "Aplicar" manda o resourceVersion
  // junto, então uma mudança feita por outro no meio dá conflito em vez de ser
  // sobrescrita.

  let { kind, namespace, name, dirty = $bindable(false) }: {
    kind: WatchKind
    namespace: string
    name: string
    /** true enquanto há edição não aplicada. */
    dirty?: boolean
  } = $props()

  let original = $state('')
  let text = $state('')
  let loading = $state(true)
  let applying = $state(false)
  let error = $state('')
  let loadedAt = $state(0)

  let textarea = $state<HTMLTextAreaElement>()
  let highlightEl = $state<HTMLElement>()
  let gutterEl = $state<HTMLElement>()

  // Prism devolve HTML com o texto escapado: seguro para {@html}. A linha
  // extra no fim evita que a última linha vazia do textarea fique sem par.
  const highlighted = $derived(Prism.highlight(text + '\n', Prism.languages.yaml, 'yaml'))
  const lineCount = $derived(text.split('\n').length)

  $effect(() => {
    dirty = text !== original
  })

  $effect(() => {
    void [kind, namespace, name]
    untrack(() => void load())
  })

  async function load() {
    loading = true
    error = ''
    try {
      const yaml = await window.kube.getYaml(kind, namespace, name)
      original = yaml
      text = yaml
      loadedAt = Date.now()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function apply() {
    applying = true
    error = ''
    try {
      await window.kube.applyYaml(kind, namespace, name, text)
      toasts.success(`${name}: alterações aplicadas`)
      await load()
    } catch (e) {
      error = (e as Error).message
    } finally {
      applying = false
    }
  }

  function discard() {
    text = original
    error = ''
  }

  function syncScroll() {
    if (!textarea) return
    if (highlightEl) {
      highlightEl.scrollTop = textarea.scrollTop
      highlightEl.scrollLeft = textarea.scrollLeft
    }
    if (gutterEl) gutterEl.scrollTop = textarea.scrollTop
  }

  function onKey(e: KeyboardEvent) {
    // Ctrl/Cmd+S aplica
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      if (dirty && !applying) void apply()
      return
    }
    // Tab indenta com dois espaços em vez de tirar o foco
    if (e.key === 'Tab' && !e.shiftKey && textarea) {
      e.preventDefault()
      const { selectionStart: a, selectionEnd: b } = textarea
      text = text.slice(0, a) + '  ' + text.slice(b)
      const pos = a + 2
      requestAnimationFrame(() => textarea?.setSelectionRange(pos, pos))
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toasts.success('YAML copiado')
    } catch (e) {
      toasts.error(`Não foi possível copiar: ${(e as Error).message}`)
    }
  }

  async function save() {
    try {
      const path = await window.kube.saveFile(`${name}.yaml`, text)
      if (path) toasts.success(`Salvo em ${path}`)
    } catch (e) {
      toasts.error((e as Error).message)
    }
  }
</script>

<div class="editor">
  <div class="toolbar">
    <span class="when">
      {#if loading}Carregando…
      {:else if dirty}<span class="dirty">● Alterações não aplicadas</span>
      {:else if loadedAt}Lido às {new Date(loadedAt).toLocaleTimeString('pt-BR')}{/if}
    </span>
    <button onclick={copy} disabled={!text}>Copiar</button>
    <button onclick={save} disabled={!text}>Salvar…</button>
    <button onclick={load} disabled={loading || applying} title={dirty ? 'Descarta a edição e lê de novo do cluster' : 'Ler de novo do cluster'}>Recarregar</button>
    <button onclick={discard} disabled={!dirty || applying}>Descartar</button>
    <button class="primary" onclick={apply} disabled={!dirty || applying || loading} title="Aplicar (Ctrl+S)">
      {applying ? 'Aplicando…' : 'Aplicar'}
    </button>
  </div>

  {#if error}<div class="error-box" role="alert">{error}</div>{/if}

  <div class="code" aria-busy={loading}>
    <pre class="gutter" aria-hidden="true" bind:this={gutterEl}>{#each { length: lineCount } as _, i (i)}{i + 1}{'\n'}{/each}</pre>
    <div class="area">
      <pre class="highlight" aria-hidden="true" bind:this={highlightEl}><code>{@html highlighted}</code></pre>
      <textarea
        bind:this={textarea}
        bind:value={text}
        onscroll={syncScroll}
        onkeydown={onKey}
        spellcheck="false"
        autocomplete="off"
        wrap="off"
        disabled={loading}
        aria-label="YAML de {name}"
      ></textarea>
    </div>
  </div>
</div>

<style>
  .editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--border); }
  .when { margin-right: auto; color: var(--muted); font-size: 12px; }
  .dirty { color: var(--pend); }
  .error-box { margin: 12px 16px 0; white-space: pre-wrap; }

  .code { flex: 1; min-height: 0; display: flex; background: var(--term-bg); margin-top: 0; }
  pre, textarea {
    margin: 0; font-family: var(--mono); font-size: 12px; line-height: 1.6;
    tab-size: 2; letter-spacing: 0; font-variant-ligatures: none;
  }
  .gutter {
    flex-shrink: 0; overflow: hidden; padding: 12px 10px 12px 14px; text-align: right;
    padding-bottom: 40px;
    color: #5c5c5c; background: #1b1b1b; border-right: 1px solid var(--border-subtle); user-select: none;
  }
  .area { position: relative; flex: 1; min-width: 0; }
  .highlight, textarea {
    position: absolute; inset: 0; padding: 12px 20px 12px 14px;
    white-space: pre; overflow: auto; border: 0; border-radius: 0;
  }
  .highlight { padding-bottom: 40px; pointer-events: none; color: #e5e5e5; scrollbar-width: none; }
  .highlight::-webkit-scrollbar { display: none; }
  textarea {
    resize: none; background: transparent; color: transparent; caret-color: #fff;
    outline: none;
  }
  textarea::selection { background: rgba(74, 158, 255, .35); color: transparent; }
  .area:focus-within { box-shadow: inset 0 0 0 1px var(--focus); }

  /* Cores de sintaxe iguais às do visualizador de YAML */
  .highlight :global(.token.key), .highlight :global(.token.atrule) { color: #81a2be; }
  .highlight :global(.token.string) { color: #b5bd68; }
  .highlight :global(.token.number), .highlight :global(.token.datetime) { color: #de935f; }
  .highlight :global(.token.boolean), .highlight :global(.token.null), .highlight :global(.token.important) { color: #b294bb; }
  .highlight :global(.token.punctuation) { color: #969896; }
  .highlight :global(.token.comment) { color: #969896; font-style: italic; }
</style>
