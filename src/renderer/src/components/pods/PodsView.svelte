<script lang="ts">
  import type { PodRow } from '@shared/api'
  import { session } from '../../lib/session.svelte'
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
  <PodsTable namespace={session.namespace} selected={logPod?.uid} onlogs={(p) => (logPod = p)} />
  {#if logPod}
    {#key logPod.uid}
      <LogViewer pod={logPod} onclose={() => (logPod = null)} />
    {/key}
  {/if}
</div>

<style>
  .view { flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); }
  .view.split { grid-template-rows: minmax(150px, 45%) minmax(0, 1fr); }
</style>
