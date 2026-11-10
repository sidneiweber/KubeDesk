<script lang="ts">
  import type { Snippet } from 'svelte'

  // Moldura das páginas de detalhe: voltar, nome, status e ações numa linha,
  // e o conteúdo rolável. O recurso vem da lista ao vivo; se sumir do
  // cluster, a página avisa.

  let { back, onback, title, found, loading, after, actions, tabs, tab = $bindable(), fill = false, children }: {
    /** Texto do botão de voltar, ex.: "Deployments". */
    back: string
    onback: () => void
    title: string
    /** false = o recurso não está (mais) na lista. */
    found: boolean
    loading: boolean
    after?: Snippet
    actions?: Snippet
    /** Abas abaixo do título; a ativa fica em `tab`. */
    tabs?: { id: string; label: string }[]
    tab?: string
    /** Conteúdo ocupa a área toda, sem rolagem nem margem (logs, editor). */
    fill?: boolean
    children: Snippet
  } = $props()
</script>

<div class="page">
  <header>
    <button class="back" onclick={onback}>← {back}</button>
    <h1>{title}</h1>
    {@render after?.()}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>

  {#if tabs && found}
    <div class="tabs" role="tablist">
      {#each tabs as t (t.id)}
        <button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </div>
  {/if}

  {#if !found}
    <p class="gone">{loading ? 'Carregando…' : 'Este recurso não existe mais no cluster.'}</p>
  {:else}
    <div class="content" class:fill role={tabs ? 'tabpanel' : undefined}>{@render children()}</div>
  {/if}
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
  header {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .back { font-size: 12px; }
  h1 { font-size: 18px; font-weight: 600; user-select: text; }
  .actions { margin-left: auto; display: flex; gap: 8px; }
  .gone { padding: 32px; color: var(--muted); text-align: center; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 22px; }
  .content.fill { overflow: hidden; padding: 0; gap: 0; }
  .tabs { display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--border); }
  .tabs button {
    background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0;
    padding: 10px 12px 8px; color: var(--muted); font-weight: 500;
  }
  .tabs button:hover:not(:disabled) { color: var(--text); border-color: transparent; }
  .tabs button.active { color: var(--text); border-bottom-color: var(--accent); }
</style>
