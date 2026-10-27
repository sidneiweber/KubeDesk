<script lang="ts">
  import { session } from './lib/session.svelte'
  import ConnectScreen from './components/ConnectScreen.svelte'
  import Sidebar, { type Section } from './components/Sidebar.svelte'
  import PodsView from './components/pods/PodsView.svelte'

  let section = $state<Section>('pods')
</script>

{#if session.context === null}
  <ConnectScreen />
{:else}
  <div class="layout">
    <Sidebar bind:section />
    <main>
      <!-- Recria a tela ao trocar de contexto, para não sobrar estado do cluster anterior -->
      {#key session.context}
        {#if section === 'pods'}
          <PodsView />
        {/if}
      {/key}
    </main>
  </div>
{/if}

<style>
  .layout { display: flex; height: 100%; }
  main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
