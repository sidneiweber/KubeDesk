<script lang="ts">
  import { toasts } from '../lib/toasts.svelte'
</script>

<!-- Região sempre presente: leitores de tela só anunciam mudanças em regiões que já existiam -->
<div class="toasts" role="status" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast {t.kind}">
      <span>{t.text}</span>
      <button onclick={() => toasts.dismiss(t.id)} aria-label="Fechar aviso">✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; right: 16px; bottom: 16px; z-index: 100; display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
  .toast {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px; border-radius: 8px;
    background: var(--branco); border: 1px solid var(--border); border-left-width: 4px;
    box-shadow: 0 12px 32px rgba(11, 42, 91, .18);
    user-select: text;
  }
  .toast span { flex: 1; }
  .success { border-left-color: var(--ok); }
  .error { border-left-color: var(--fail); }
  button { all: unset; cursor: pointer; color: var(--muted); padding: 0 2px; }
  button:hover { color: var(--azul); }
  button:focus-visible { outline: 2px solid var(--accent); }
</style>
