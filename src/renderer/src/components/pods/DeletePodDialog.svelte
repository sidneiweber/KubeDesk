<script lang="ts">
  import type { PodRow } from '@shared/api'
  import { toasts } from '../../lib/toasts.svelte'
  import Modal from '../Modal.svelte'

  let { pod, onclose }: { pod: PodRow; onclose: () => void } = $props()

  let saving = $state(false)
  let error = $state('')

  // O que acontece depois depende de quem é dono do pod
  const kind = $derived(pod.owner.split('/')[0])
  const recreated = $derived(['ReplicaSet', 'StatefulSet', 'DaemonSet', 'ReplicationController'].includes(kind))

  async function confirm() {
    saving = true
    error = ''
    try {
      await window.kube.deletePod(pod.namespace, pod.name)
      toasts.success(recreated ? `${pod.name} apagado; ${pod.owner} vai criar outro` : `${pod.name} apagado`)
      onclose()
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }
</script>

<Modal title="Apagar {pod.name}?" {onclose}>
  {#if recreated}
    <p>O pod é controlado por <code>{pod.owner}</code>, que vai criar um pod novo no lugar. Na prática, é um reinício deste pod.</p>
  {:else if pod.owner}
    <p class="warn">O pod pertence a <code>{pod.owner}</code>. Dependendo de como esse recurso está configurado, ele pode não ser recriado.</p>
  {:else}
    <p class="warn">Este pod não tem controlador: depois de apagado, ele não volta.</p>
  {/if}
  {#if error}<div class="error-box" role="alert">{error}</div>{/if}

  {#snippet footer()}
    <button onclick={onclose}>Cancelar</button>
    <button class="danger" onclick={confirm} disabled={saving}>{saving ? 'Apagando…' : 'Apagar pod'}</button>
  {/snippet}
</Modal>

<style>
  .warn { color: var(--pend); font-weight: 500; }
  code { font-family: var(--mono); font-size: 13px; color: var(--navy); }
  .danger { background: var(--fail); border-color: var(--fail); color: #fff; }
  .danger:hover:not(:disabled) { background: #A3202C; border-color: #A3202C; color: #fff; }
</style>
