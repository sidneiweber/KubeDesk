<script lang="ts">
  import { saveNamespace, session } from './lib/session.svelte'
  import { nav } from './lib/nav.svelte'
  import ConnectScreen from './components/ConnectScreen.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import PodsView from './components/pods/PodsView.svelte'
  import DeploymentsView from './components/deployments/DeploymentsView.svelte'
  import NamespacesView from './components/namespaces/NamespacesView.svelte'
  import ServicesView from './components/services/ServicesView.svelte'
  import IngressesView from './components/ingresses/IngressesView.svelte'
  import EndpointsView from './components/endpoints/EndpointsView.svelte'
  import Toasts from './components/Toasts.svelte'
  import YamlViewer from './components/YamlViewer.svelte'
  import { yamlView } from './lib/yaml.svelte'


  // Lembra o namespace escolhido para o contexto atual
  $effect(() => {
    if (session.context) saveNamespace(session.context, session.namespace)
  })
</script>

{#if session.context === null}
  <ConnectScreen />
{:else}
  <div class="layout">
    <Sidebar />
    <main>
      <!-- Recria a tela ao trocar de contexto (para não sobrar estado do cluster
           anterior) e a cada clique no menu (para voltar à lista) -->
      {#key `${session.context}:${nav.visit}`}
        {#if nav.section === 'pods'}
          <PodsView />
        {:else if nav.section === 'deployments'}
          <DeploymentsView />
        {:else if nav.section === 'namespaces'}
          <NamespacesView />
        {:else if nav.section === 'services'}
          <ServicesView />
        {:else if nav.section === 'ingresses'}
          <IngressesView />
        {:else if nav.section === 'endpoints'}
          <EndpointsView />
        {/if}
      {/key}
    </main>
  </div>
{/if}

{#if yamlView.target}
  {#key yamlView.target}
    <YamlViewer target={yamlView.target} />
  {/key}
{/if}

<Toasts />

<style>
  .layout { display: flex; height: 100%; }
  main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
