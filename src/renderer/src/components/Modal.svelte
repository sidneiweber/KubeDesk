<script lang="ts">
  import type { Snippet } from 'svelte'

  // <dialog> nativo com showModal(): foco preso dentro do modal, Esc fecha e o
  // resto da página fica inerte, sem código nosso para isso.

  let { title, onclose, children, footer }: {
    title: string
    onclose: () => void
    children: Snippet
    footer: Snippet
  } = $props()

  let dialog: HTMLDialogElement

  $effect(() => {
    dialog.showModal()
    return () => dialog.close()
  })
</script>

<dialog bind:this={dialog} aria-labelledby="modal-title" onclose={onclose}
        onclick={(e) => e.target === dialog && onclose()}>
  <div class="box">
    <h2 id="modal-title">{title}</h2>
    <div class="body">{@render children()}</div>
    <div class="footer">{@render footer()}</div>
  </div>
</dialog>

<style>
  dialog {
    margin: auto; padding: 0; border: 0; border-radius: 12px;
    background: var(--branco); color: var(--text);
    width: min(480px, calc(100% - 32px));
    box-shadow: 0 24px 60px rgba(11, 42, 91, .28);
  }
  dialog::backdrop { background: rgba(10, 20, 36, .55); }
  .box { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  /* Título 2 do kit */
  h2 { font-size: 20px; line-height: 1.4; font-weight: 600; color: var(--ink); }
  .body { display: flex; flex-direction: column; gap: 12px; line-height: 1.5; color: var(--text-2); }
  .footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
