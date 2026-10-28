<script lang="ts">
  // Botão "Colunas" com a lista de colunas que podem ser escondidas.

  let { columns, hidden, onchange }: {
    columns: { key: string; label: string; fixed: boolean }[]
    hidden: ReadonlySet<string>
    onchange: (hidden: Set<string>) => void
  } = $props()

  let open = $state(false)
  let root: HTMLDivElement

  function toggle(key: string, show: boolean) {
    const next = new Set(hidden)
    if (show) next.delete(key)
    else next.add(key)
    onchange(next)
  }

  function onWindowClick(e: MouseEvent) {
    if (open && !root.contains(e.target as Node)) open = false
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false
      root.querySelector('button')?.focus()
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="picker" bind:this={root} onkeydown={onKey} role="presentation">
  <button aria-expanded={open} aria-haspopup="true" onclick={() => (open = !open)}>
    Colunas{hidden.size ? ` (${hidden.size} ocultas)` : ''}
  </button>
  {#if open}
    <div class="pop" role="group" aria-label="Colunas visíveis">
      {#each columns as c (c.key)}
        <label class:fixed={c.fixed}>
          <input type="checkbox" checked={c.fixed || !hidden.has(c.key)} disabled={c.fixed}
                 onchange={(e) => toggle(c.key, e.currentTarget.checked)} />
          {c.label}
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker { position: relative; }
  .pop {
    /* Abre para a esquerda: o botão fica na borda direita da barra */
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 200px;
    display: flex; flex-direction: column; padding: 8px;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, .45);
  }
  label { padding: 7px 8px; border-radius: 6px; color: var(--text); cursor: pointer; white-space: nowrap; }
  label:hover { background: rgba(74, 158, 255, .12); }
  label.fixed { color: var(--muted); cursor: default; }
</style>
