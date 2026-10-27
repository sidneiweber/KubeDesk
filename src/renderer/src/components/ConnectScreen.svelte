<script lang="ts">
  import { onMount } from 'svelte'
  import { session } from '../lib/session.svelte'
  import logo from '../assets/logo.png'

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
      <img src={logo} alt="" />
      <h1>KubeDesk</h1>
    </header>
    <p class="subtitle">Conecte-se aos seus clusters Kubernetes</p>

    <div class="field">
      <span class="label">Kubeconfig</span>
      <div class="row">
        <code title={session.kubeconfigPath ?? ''}>{session.kubeconfigPath ?? 'Padrão ($KUBECONFIG ou ~/.kube/config)'}</code>
        <button onclick={selectFile} disabled={connecting}>Selecionar…</button>
      </div>
    </div>

    <label class="field">
      <span class="label">Contexto</span>
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
  .screen { height: 100%; display: grid; place-items: center; padding: 24px; }
  .card {
    width: min(520px, 100%);
    display: flex; flex-direction: column; gap: 18px;
    padding: 32px; border-radius: 12px;
    background: var(--surface); border: 1px solid var(--border);
  }
  header { display: flex; align-items: center; gap: 12px; }
  header img { width: 40px; filter: drop-shadow(0 2px 4px rgba(74, 158, 255, .3)); }
  h1 { font-size: 24px; font-weight: 600; color: var(--accent); }
  .subtitle { color: var(--muted); margin-top: -10px; }

  .field { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
  .label { color: var(--muted); font-size: 12px; }
  .row { display: flex; gap: 8px; }
  code {
    flex: 1; min-width: 0; padding: 6px 9px; border-radius: 6px;
    background: var(--surface-sunken); border: 1px solid var(--border);
    font-family: var(--mono); font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left;
  }
  .connect { padding: 9px; }
</style>
