<script lang="ts">
  import type { PodRow } from '@shared/api'
  import { session } from '../../lib/session.svelte'
  import PageHeader from '../PageHeader.svelte'
  import PodsTable from './PodsTable.svelte'
  import LogViewer from '../logs/LogViewer.svelte'

  let logPod = $state<PodRow | null>(null)

  // Trocar de namespace fecha os logs de um pod que talvez nem apareça mais
  $effect(() => {
    void session.namespace
    logPod = null
  })
</script>

<div class="view" class:split={logPod}>
  <div class="list">
    <PageHeader title="Pods" />
    <PodsTable namespace={session.namespace} selected={logPod?.uid} onlogs={(p) => (logPod = p)} />
  </div>
  {#if logPod}
    {#key logPod.uid}
      <LogViewer pod={logPod} onclose={() => (logPod = null)} />
    {/key}
  {/if}
</div>

<style>
  .view { flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); }
  .view.split { grid-template-rows: minmax(180px, 50%) minmax(0, 1fr); }
  .list { min-height: 0; display: flex; flex-direction: column; gap: 20px; padding: 24px 32px; }
  .list > :global(section) { flex: 1; }
  .split .list { padding-bottom: 16px; }
</style>
