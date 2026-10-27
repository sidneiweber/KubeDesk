<script lang="ts">
  import type { Snippet } from 'svelte'
  import PageHeader from '../PageHeader.svelte'

  // Moldura das páginas de detalhe: voltar, cabeçalho e conteúdo rolável.
  // O recurso vem da lista ao vivo; se sumir do cluster, a página avisa.

  let { back, onback, title, namespace, found, loading, after, actions, children }: {
    /** Texto do botão de voltar, ex.: "Deployments". */
    back: string
    onback: () => void
    title: string
    namespace?: string
    /** false = o recurso não está (mais) na lista. */
    found: boolean
    loading: boolean
    after?: Snippet
    actions?: Snippet
    children: Snippet
  } = $props()
</script>

<div class="page">
  <div class="head">
    <button class="back" onclick={onback}>← {back}</button>
    <PageHeader {title} {namespace} {after} {actions} />
  </div>

  {#if !found}
    <p class="gone">{loading ? 'Carregando…' : 'Este recurso não existe mais no cluster.'}</p>
  {:else}
    <div class="content">{@render children()}</div>
  {/if}
</div>

<style>
  .page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .head { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px 32px 18px; border-bottom: 1px solid var(--border); }
  .head > :global(header) { align-self: stretch; }
  .back { height: 28px; padding: 0 10px; font-size: 12px; }
  .gone { padding: 40px; color: var(--muted); text-align: center; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 28px; }
</style>
