<script lang="ts">
  import Prism from 'prismjs'
  import 'prismjs/components/prism-yaml'
  import { yamlView, type YamlTarget } from '../lib/yaml.svelte'
  import { toasts } from '../lib/toasts.svelte'

  // Painel lateral com o YAML do recurso. É um retrato do momento em que
  // abriu (não acompanha o watch): "Recarregar" busca de novo.

  let { target }: { target: YamlTarget } = $props()

  const KIND_LABEL: Record<YamlTarget['kind'], string> = {
    pods: 'Pod', deployments: 'Deployment', namespaces: 'Namespace',
    services: 'Service', ingresses: 'Ingress', endpointslices: 'EndpointSlice',
  }

  let dialog: HTMLDialogElement
  let yaml = $state('')
  let loading = $state(true)
  let error = $state('')
  let managedFields = $state(false)
  let loadedAt = $state(0)

  // Prism devolve HTML com o texto escapado: seguro para {@html}
  const highlighted = $derived(yaml ? Prism.highlight(yaml, Prism.languages.yaml, 'yaml') : '')
  const lineCount = $derived(yaml ? yaml.replace(/\n$/, '').split('\n').length : 0)

  $effect(() => {
    dialog.showModal()
    return () => dialog.close()
  })

  // Recarrega ao abrir e ao alternar managedFields
  $effect(() => {
    void managedFields
    load()
  })

  async function load() {
    loading = true
    error = ''
    try {
      yaml = await window.kube.getYaml(target.kind, target.namespace, target.name, managedFields)
      loadedAt = Date.now()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(yaml)
      toasts.success('YAML copiado')
    } catch (e) {
      toasts.error(`Não foi possível copiar: ${(e as Error).message}`)
    }
  }

  async function save() {
    try {
      const path = await window.kube.saveFile(`${target.name}.yaml`, yaml)
      if (path) toasts.success(`Salvo em ${path}`)
    } catch (e) {
      toasts.error((e as Error).message)
    }
  }

  const close = () => (yamlView.target = null)
</script>

<dialog bind:this={dialog} aria-labelledby="yaml-title" onclose={close} onclick={(e) => e.target === dialog && close()}>
  <div class="panel">
    <header>
      <div class="titles">
        <div class="eyebrow">{KIND_LABEL[target.kind]}{target.namespace ? ` · ${target.namespace}` : ''}</div>
        <h2 id="yaml-title">{target.name}</h2>
      </div>
      <button class="close" onclick={close} aria-label="Fechar YAML" title="Fechar (Esc)">✕</button>
    </header>

    <div class="toolbar">
      <label><input type="checkbox" bind:checked={managedFields} /> managedFields</label>
      <span class="when">
        {#if loading}Carregando…{:else if loadedAt}Lido às {new Date(loadedAt).toLocaleTimeString('pt-BR')}{/if}
      </span>
      <button onclick={load} disabled={loading}>Recarregar</button>
      <button onclick={copy} disabled={!yaml}>Copiar</button>
      <button onclick={save} disabled={!yaml}>Salvar…</button>
    </div>

    {#if error}
      <div class="error-box" role="alert">{error}</div>
    {:else}
      <!-- Área com rolagem precisa de foco para ser rolada só com teclado -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="code" role="region" aria-label="YAML de {target.name}" aria-busy={loading} tabindex="0">
        <pre class="gutter" aria-hidden="true">{#each { length: lineCount } as _, i (i)}{i + 1}{'\n'}{/each}</pre>
        <pre class="yaml"><code>{@html highlighted}</code></pre>
      </div>
    {/if}
  </div>
</dialog>

<style>
  /* Painel à direita, de altura total */
  dialog {
    margin: 0 0 0 auto; padding: 0; height: 100vh; max-height: 100vh;
    width: min(860px, 75vw); max-width: 100vw;
    background: var(--surface); color: var(--text);
    border: 0; border-left: 1px solid var(--border);
    box-shadow: -20px 0 50px rgba(0, 0, 0, .5);
  }
  dialog::backdrop { background: rgba(0, 0, 0, .55); }
  .panel { height: 100%; display: flex; flex-direction: column; }

  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 16px 10px; }
  .titles { min-width: 0; }
  h2 { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; user-select: text; }

  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 16px 12px; border-bottom: 1px solid var(--border); }
  .when { margin-right: auto; color: var(--muted); font-size: 12px; }
  .error-box { margin: 16px; }

  .code { flex: 1; min-height: 0; overflow: auto; display: flex; background: var(--term-bg); }
  .code:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  pre { margin: 0; padding: 12px 0; font-family: var(--mono); font-size: 12px; line-height: 1.6; }
  .gutter {
    position: sticky; left: 0; flex-shrink: 0; padding: 12px 10px 12px 14px; text-align: right;
    color: #5c5c5c; background: #1b1b1b; border-right: 1px solid var(--border-subtle); user-select: none;
  }
  .yaml { flex: 1; padding-left: 14px; padding-right: 20px; color: #e5e5e5; user-select: text; white-space: pre; }

  /* Cores de sintaxe no espírito do tema "tomorrow" que o app antigo usava */
  .yaml :global(.token.key), .yaml :global(.token.atrule) { color: #81a2be; }
  .yaml :global(.token.string) { color: #b5bd68; }
  .yaml :global(.token.number), .yaml :global(.token.datetime) { color: #de935f; }
  .yaml :global(.token.boolean), .yaml :global(.token.null), .yaml :global(.token.important) { color: #b294bb; }
  .yaml :global(.token.punctuation) { color: #969896; }
  .yaml :global(.token.comment) { color: #969896; font-style: italic; }
</style>
