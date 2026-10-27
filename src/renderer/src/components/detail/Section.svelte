<script lang="ts">
  import type { Snippet } from 'svelte'

  let { title, children }: { title: string; children: Snippet } = $props()
</script>

<section>
  <h2 class="eyebrow">{title}</h2>
  {@render children()}
</section>

<style>
  section { display: flex; flex-direction: column; }
  h2 { margin-bottom: 12px; }
</style>
