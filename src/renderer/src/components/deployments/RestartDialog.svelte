<script lang="ts">
  import type { DeploymentRow } from '@shared/api'
  import { toasts } from '../../lib/toasts.svelte'
  import Modal from '../Modal.svelte'

  let { deployment, onclose }: { deployment: DeploymentRow; onclose: () => void } = $props()

  let saving = $state(false)
  let error = $state('')

  async function confirm() {
    saving = true
    error = ''
    try {
      await window.kube.restartDeployment(deployment.namespace, deployment.name)
      toasts.success(`${deployment.name}: rollout de reinício iniciado`)
      onclose()
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }
</script>

<Modal title="Reiniciar {deployment.name}?" {onclose}>
  <p>Todos os pods do deployment serão recriados, como num <code>kubectl rollout restart</code>.</p>
  <!-- O impacto depende da estratégia: com Recreate o serviço cai até os pods novos subirem -->
  {#if deployment.strategy === 'Recreate'}
    <p class="warn">A estratégia é <strong>Recreate</strong>: todos os pods param antes dos novos subirem, e o serviço fica fora do ar nesse intervalo.</p>
  {:else}
    <p class="muted">A estratégia é RollingUpdate: os pods são trocados aos poucos.</p>
  {/if}
  {#if error}<div class="error-box" role="alert">{error}</div>{/if}

  {#snippet footer()}
    <button onclick={onclose}>Cancelar</button>
    <button class="primary" onclick={confirm} disabled={saving}>{saving ? 'Reiniciando…' : 'Reiniciar'}</button>
  {/snippet}
</Modal>

<style>
  .muted { color: var(--muted); }
  .warn { color: var(--pend); font-weight: 500; }
  code { font-family: var(--mono); font-size: 12px; }
</style>
