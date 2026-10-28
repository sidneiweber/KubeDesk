<script lang="ts" module>
  export interface MenuItem {
    label: string
    action: () => void
    /** Ação destrutiva: aparece separada e em vermelho. */
    danger?: boolean
  }
</script>

<script lang="ts">
  import { tick } from 'svelte'

  // Menu de contexto das linhas. Abre na posição do mouse (ou da linha, pelo
  // teclado), foca o primeiro item, navega com setas, fecha com Esc ou clique
  // fora e devolve o foco a quem abriu.

  let { x, y, items, label, onclose }: {
    x: number
    y: number
    items: MenuItem[]
    label: string
    onclose: () => void
  } = $props()

  let menu: HTMLDivElement
  let left = $state(0)
  let top = $state(0)
  const opener = document.activeElement as HTMLElement | null

  // Mantém o menu dentro da janela
  $effect(() => {
    const r = menu.getBoundingClientRect()
    left = Math.min(x, window.innerWidth - r.width - 8)
    top = Math.min(y, window.innerHeight - r.height - 8)
    void tick().then(() => menu.querySelector<HTMLButtonElement>('button')?.focus())
  })

  function close() {
    onclose()
    opener?.focus()
  }

  function run(item: MenuItem) {
    close()
    item.action()
  }

  function onKey(e: KeyboardEvent) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus()
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    else if (e.key === 'Home') buttons[0]?.focus()
    else if (e.key === 'End') buttons.at(-1)?.focus()
    else if (e.key === 'Escape' || e.key === 'Tab') close()
    else return
    e.preventDefault()
  }

  const safe = $derived(items.filter((i) => !i.danger))
  const danger = $derived(items.filter((i) => i.danger))
</script>

<svelte:window onmousedown={(e) => !menu.contains(e.target as Node) && close()} onblur={close} onresize={close} />

<div class="menu" role="menu" aria-label={label} bind:this={menu} style:left="{left}px" style:top="{top}px" tabindex="-1" onkeydown={onKey}>
  {#each safe as item (item.label)}
    <button role="menuitem" onclick={() => run(item)}>{item.label}</button>
  {/each}
  {#if danger.length && safe.length}<div class="sep" role="separator"></div>{/if}
  {#each danger as item (item.label)}
    <button role="menuitem" class="danger" onclick={() => run(item)}>{item.label}</button>
  {/each}
</div>

<style>
  .menu {
    position: fixed; z-index: 50; min-width: 180px; padding: 6px;
    display: flex; flex-direction: column;
    background: var(--branco); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 12px 32px rgba(11, 42, 91, .2);
  }
  .menu:focus { outline: none; }
  button {
    all: unset; box-sizing: border-box; padding: 8px 12px; border-radius: 6px; cursor: pointer;
    font-size: 14px; color: var(--text);
  }
  button:hover, button:focus { background: var(--row-selected); color: var(--navy); }
  .danger { color: var(--fail); }
  .danger:hover, .danger:focus { background: var(--fail-bg); color: var(--fail); }
  .sep { height: 1px; background: var(--border); margin: 6px 4px; }
</style>
