<script lang="ts" module>
  export interface DataEntry {
    key: string
    /** null = não mostrar (binário ou secret oculto); `hidden` diz o texto no lugar. */
    value: string | null
    size: number
    hidden?: string
  }
</script>

<script lang="ts">
  import { formatBytes } from '../../lib/size'
  import { toasts } from '../../lib/toasts.svelte'

  // Chaves de um ConfigMap ou Secret, cada uma com o valor num bloco próprio.
  // Valores longos rolam dentro do bloco, sem esticar a página.

  let { entries, emptyText, oncopy }: {
    entries: DataEntry[]
    emptyText: string
    /** Valor a copiar; padrão = o valor mostrado. Secrets buscam na hora. */
    oncopy?: (key: string) => Promise<string | null>
  } = $props()

  async function copy(e: DataEntry) {
    try {
      const text = oncopy ? await oncopy(e.key) : e.value
      if (text === null) return
      await navigator.clipboard.writeText(text)
      toasts.success(`${e.key} copiado`)
    } catch (err) {
      toasts.error((err as Error).message)
    }
  }
</script>

{#if entries.length === 0}
  <p class="muted">{emptyText}</p>
{:else}
  <div class="entries">
    {#each entries as e (e.key)}
      <div class="entry">
        <div class="head">
          <code class="key">{e.key}</code>
          <span class="size">{formatBytes(e.size)}</span>
          {#if e.value !== null || oncopy}
            <button class="copy" onclick={() => copy(e)}>Copiar</button>
          {/if}
        </div>
        {#if e.value !== null}
          <pre>{e.value}</pre>
        {:else}
          <p class="hidden">{e.hidden ?? 'Conteúdo binário'}</p>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .muted { color: var(--muted); }
  .entries { display: flex; flex-direction: column; gap: 10px; }
  .entry { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); overflow: hidden; }
  .head { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--border); }
  .key { font-weight: 600; user-select: text; overflow-wrap: anywhere; }
  .size { font-size: 11px; color: var(--muted); }
  .copy { margin-left: auto; font-size: 12px; padding: 2px 8px; }
  pre {
    margin: 0; padding: 10px; max-height: 320px; overflow: auto;
    font-family: var(--mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere;
    background: var(--surface-sunken); user-select: text;
  }
  .hidden { padding: 10px; color: var(--muted); font-size: 12px; letter-spacing: .1em; }
</style>
