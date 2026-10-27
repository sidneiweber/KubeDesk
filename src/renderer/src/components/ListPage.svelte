<script lang="ts">
  import type { Snippet } from 'svelte'
  import PageHeader from './PageHeader.svelte'

  let { title, namespace, children }: { title: string; namespace?: string; children: Snippet } = $props()
</script>

<div class="list">
  <PageHeader {title} {namespace} />
  {@render children()}
</div>

<style>
  .list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 20px; padding: 24px 32px; }
  .list > :global(section) { flex: 1; }
</style>
