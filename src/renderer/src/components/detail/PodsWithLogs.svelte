<script lang="ts">
  import type { PodRow } from '@shared/api'
  import PodsTable from '../pods/PodsTable.svelte'
  import LogViewer from '../logs/LogViewer.svelte'
  import Section from './Section.svelte'

  // Pods escolhidos por um seletor (de deployment, de service), com os logs
  // do pod clicado logo abaixo.

  let { namespace, selector, emptyText, noSelectorText }: {
    namespace: string
    selector: string
    emptyText: string
    /** Mensagem quando o recurso não seleciona pods. */
    noSelectorText: string
  } = $props()

  let logPod = $state<PodRow | null>(null)
</script>

<Section title="Pods">
  {#if selector}
    <div class="table">
      <PodsTable {namespace} labelSelector={selector} selected={logPod?.uid} onlogs={(p) => (logPod = p)} {emptyText} />
    </div>
    {#if logPod}
      <div class="logs">
        {#key logPod.uid}
          <LogViewer pod={logPod} onclose={() => (logPod = null)} />
        {/key}
      </div>
    {/if}
  {:else}
    <p class="muted">{noSelectorText}</p>
  {/if}
</Section>

<style>
  .table { height: 260px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .table > :global(section) { flex: 1; }
  .logs { height: 380px; display: flex; flex-direction: column; margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .logs > :global(section) { flex: 1; border-top: 0; }
  .muted { color: var(--muted); }
</style>
