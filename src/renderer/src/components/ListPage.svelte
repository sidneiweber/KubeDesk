<script lang="ts">
  import type { Snippet } from 'svelte'

  // Página de lista: a tabela ocupa tudo, sem título (como no layout original).
  let { children }: { children: Snippet } = $props()
</script>

<div class="list">
  {@render children()}
</div>

<style>
  .list { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
  .list > :global(section) { flex: 1; }
</style>
