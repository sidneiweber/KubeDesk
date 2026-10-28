<script lang="ts">
  import type { PodRow } from '@shared/api'
  import { nav } from '../../lib/nav.svelte'
  import { session } from '../../lib/session.svelte'
  import PodsTable from './PodsTable.svelte'
  import PodDetails from './PodDetails.svelte'
  import LogViewer from '../logs/LogViewer.svelte'

  let logPod = $state<PodRow | null>(null)
  // Pode chegar aberto vindo de outra tela (ex.: um pod nos detalhes do deployment)
  let opened = $state<{ namespace: string; name: string } | null>(nav.takeTarget())

  // Trocar de namespace fecha os logs e os detalhes de um pod que talvez nem
  // apareça mais. Só na troca: na entrada, o alvo vindo de outra tela vale.
  let lastNamespace = session.namespace
  $effect(() => {
    const ns = session.namespace
    logPod = null
    if (ns !== lastNamespace) {
      lastNamespace = ns
      opened = null
    }
  })

  const open = (p: PodRow) => (opened = { namespace: p.namespace, name: p.name })
</script>

{#if opened}
  {#key `${opened.namespace}/${opened.name}`}
    <PodDetails namespace={opened.namespace} name={opened.name} onback={() => (opened = null)} />
  {/key}
{:else}
  <div class="view" class:split={logPod}>
    <PodsTable namespace={session.namespace} selected={logPod?.uid} onlogs={(p) => (logPod = p)} onopen={open} />
    {#if logPod}
      {#key logPod.uid}
        <LogViewer pod={logPod} onclose={() => (logPod = null)} />
      {/key}
    {/if}
  </div>
{/if}

<style>
  .view { flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); }
  .view.split { grid-template-rows: minmax(150px, 45%) minmax(0, 1fr); }
</style>
