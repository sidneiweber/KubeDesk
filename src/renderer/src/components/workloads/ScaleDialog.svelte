<script lang="ts">
  import type { ScalableKind } from '@shared/api'
  import { toasts } from '../../lib/toasts.svelte'
  import Modal from '../Modal.svelte'

  let { kind, deployment, onclose }: {
    kind: ScalableKind
    /** O workload (Deployment, ReplicaSet ou StatefulSet). */
    deployment: { namespace: string; name: string; desired: number; owner: { kind: string; name: string } | null }
    onclose: () => void
  } = $props()

  // svelte-ignore state_referenced_locally
  let replicas = $state(deployment.desired)
  let saving = $state(false)
  let error = $state('')

  const valid = $derived(Number.isInteger(replicas) && replicas >= 0)
  const changed = $derived(replicas !== deployment.desired)

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (!valid || !changed || saving) return
    saving = true
    error = ''
    // O deployment é ao vivo: depois do await o watch já pode ter trazido o valor novo
    const from = deployment.desired
    try {
      await window.kube.scale(kind, deployment.namespace, deployment.name, replicas)
      toasts.success(`${deployment.name}: ${from} → ${replicas} réplica${replicas === 1 ? '' : 's'}`)
      onclose()
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }
</script>

<Modal title="Escalar {deployment.name}" {onclose}>
  <form id="scale-form" onsubmit={submit}>
    <p class="muted">Namespace <strong>{deployment.namespace}</strong> · hoje com <strong>{deployment.desired}</strong> réplica{deployment.desired === 1 ? '' : 's'}</p>
    <label class="field">
      Réplicas
      <!-- svelte-ignore a11y_autofocus -->
      <input type="number" min="0" step="1" bind:value={replicas} autofocus />
    </label>
    {#if deployment.owner}
      <p class="warn">Este recurso é controlado por {deployment.owner.kind}/{deployment.owner.name}, que deve desfazer a mudança. Escale o {deployment.owner.kind}.</p>
    {/if}
    {#if valid && replicas === 0 && deployment.desired > 0}
      <p class="warn">Com 0 réplicas todos os pods são removidos e o serviço fica fora do ar.</p>
    {/if}
    {#if error}<div class="error-box" role="alert">{error}</div>{/if}
  </form>

  {#snippet footer()}
    <button type="button" onclick={onclose}>Cancelar</button>
    <button type="submit" form="scale-form" class="primary" disabled={!valid || !changed || saving}>
      {saving ? 'Escalando…' : 'Escalar'}
    </button>
  {/snippet}
</Modal>

<style>
  form { display: flex; flex-direction: column; gap: 12px; }
  .muted { color: var(--muted); }
  .muted strong { color: var(--text); font-weight: 500; }
  .field { flex-direction: column; align-items: stretch; gap: 6px; }
  .field input { width: 120px; font-family: var(--mono); }
  .warn { color: var(--pend); font-weight: 500; }
</style>
