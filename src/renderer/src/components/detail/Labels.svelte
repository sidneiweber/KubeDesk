<script lang="ts">
  import Section from './Section.svelte'

  // Some quando não há labels: uma seção vazia só ocupa espaço.
  let { labels }: { labels: Record<string, string> } = $props()

  const entries = $derived(Object.entries(labels))
</script>

{#if entries.length > 0}
  <Section title="Labels">
    <div class="labels">
      {#each entries as [k, v] (k)}
        <code>{k}={v}</code>
      {/each}
    </div>
  </Section>
{/if}

<style>
  .labels { display: flex; flex-wrap: wrap; gap: 6px; }
  code {
    padding: 2px 8px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border);
    font-size: 12px; user-select: text;
  }
</style>
