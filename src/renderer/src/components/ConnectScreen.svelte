<script lang="ts">
  import { onMount } from 'svelte'
  import { session } from '../lib/session.svelte'
  import Logo from './Logo.svelte'

  let selected = $state('')
  let loading = $state(true)
  let connecting = $state(false)
  let error = $state('')

  function pickDefault() {
    const ctx = session.contexts.find((c) => c.current) ?? session.contexts[0]
    selected = ctx?.name ?? ''
  }

  onMount(async () => {
    try {
      await session.loadKubeconfig()
      pickDefault()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  async function selectFile() {
    error = ''
    try {
      if (await session.selectKubeconfig()) pickDefault()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function connect() {
    if (!selected) return
    connecting = true
    error = ''
    try {
      await session.connect(selected)
    } catch (e) {
      error = (e as Error).message
    } finally {
      connecting = false
    }
  }
</script>

<div class="screen">
  <div class="card">
    <header>
      <h1><Logo size={36} /></h1>
      <p class="subtitle">Gerencie seus clusters Kubernetes em uma só janela.</p>
    </header>

    <div class="field">
      <span class="eyebrow">Kubeconfig</span>
      <div class="row">
        <code title={session.kubeconfigPath ?? ''}>{session.kubeconfigPath ?? 'Padrão ($KUBECONFIG ou ~/.kube/config)'}</code>
        <button onclick={selectFile} disabled={connecting}>Selecionar…</button>
      </div>
    </div>

    <label class="field">
      <span class="eyebrow">Contexto</span>
      <select bind:value={selected} disabled={loading || connecting || session.contexts.length === 0}>
        {#if session.contexts.length === 0}
          <option value="">{loading ? 'Carregando…' : 'Nenhum contexto encontrado'}</option>
        {/if}
        {#each session.contexts as c (c.name)}
          <option value={c.name}>{c.name}{c.current ? ' (atual)' : ''}</option>
        {/each}
      </select>
    </label>

    {#if error}
      <div class="error-box" role="alert">{error}</div>
    {/if}

    <button class="primary connect" onclick={connect} disabled={!selected || connecting}>
      {connecting ? 'Conectando…' : 'Conectar'}
    </button>
  </div>
</div>

<style>
  /* Fundo do hero do kit: Ink com a grade sutil */
  .screen {
    height: 100%; display: grid; place-items: center; padding: 24px; overflow: auto;
    background-color: var(--ink);
    background-image: linear-gradient(#13223A 1px, transparent 1px), linear-gradient(90deg, #13223A 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .card {
    width: min(500px, 100%);
    display: flex; flex-direction: column; gap: 20px;
    padding: 36px; border-radius: 16px;
    background: var(--branco);
    box-shadow: 0 24px 60px rgba(0, 0, 0, .35);
  }
  header { display: flex; flex-direction: column; gap: 12px; margin-bottom: 4px; }
  h1 { display: flex; }
  .subtitle { color: var(--text-2); font-size: 15px; }

  .field { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
  .row { display: flex; gap: 8px; }
  code {
    flex: 1; min-width: 0; height: 34px; display: flex; align-items: center; padding: 0 10px; border-radius: 8px;
    background: var(--gelo); border: 1px solid var(--border); color: var(--navy);
    font-size: 12px; overflow: hidden; white-space: nowrap;
  }
  .connect { height: 42px; margin-top: 4px; }
</style>
