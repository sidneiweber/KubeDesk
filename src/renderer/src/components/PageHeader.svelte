<script lang="ts">
  import type { Snippet } from 'svelte'
  import { session } from '../lib/session.svelte'

  let { title, namespace, before, after, actions }: {
    title: string
    /** Namespace mostrado no caminho; padrão é o selecionado na barra lateral. */
    namespace?: string
    /** Algo antes do título, ex.: botão de voltar. */
    before?: Snippet
    /** Ao lado do título, ex.: status. */
    after?: Snippet
    /** À direita, ex.: botões. */
    actions?: Snippet
  } = $props()

  const ns = $derived(namespace ?? session.namespace)
</script>

<header>
  <div class="titles">
    <div class="path mono">{session.context} / {ns || 'todos os namespaces'}</div>
    <div class="row">
      {@render before?.()}
      <h1>{title}</h1>
      {@render after?.()}
    </div>
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .titles { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .path { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { display: flex; align-items: center; gap: 12px; min-width: 0; }
  /* Título 1 do kit, um passo abaixo para caber numa tela de trabalho */
  h1 { font-size: 26px; line-height: 1.3; font-weight: 600; letter-spacing: -.02em; color: var(--ink); user-select: text; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
