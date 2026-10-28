<script lang="ts">
  import type { Snippet } from 'svelte'

  // Moldura das páginas de detalhe: voltar, nome, status e ações numa linha,
  // e o conteúdo rolável. O recurso vem da lista ao vivo; se sumir do
  // cluster, a página avisa.

  let { back, onback, title, found, loading, after, actions, children }: {
    /** Texto do botão de voltar, ex.: "Deployments". */
    back: string
    onback: () => void
    title: string
    /** false = o recurso não está (mais) na lista. */
    found: boolean
    loading: boolean
    after?: Snippet
    actions?: Snippet
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

  {#if !found}
    <p class="gone">{loading ? 'Carregando…' : 'Este recurso não existe mais no cluster.'}</p>
  {:else}
    <div class="content">{@render children()}</div>
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
</style>
