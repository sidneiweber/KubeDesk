<script lang="ts">
  import type { RolloutKind, WorkloadBase } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'
  import { toasts } from '../../lib/toasts.svelte'
  import { WORKLOADS } from '../../lib/workloads'
  import Modal from '../Modal.svelte'

  // Histórico de rollout, a revisão mais nova em cima. O Deployment guarda as
  // revisões como ReplicaSets; DaemonSet e StatefulSet, como
  // ControllerRevisions. A mais nova é sempre a atual: voltar para uma antiga
  // cria uma revisão nova com o template dela.
  // "Voltar" faz o mesmo que `kubectl rollout undo --to-revision=N`.

  let { kind, workload, paused = false, strategy = '' }: {
    kind: RolloutKind
    workload: WorkloadBase
    paused?: boolean
    strategy?: string
  } = $props()

  interface Revision {
    uid: string
    name: string
    revision: number
    images: string[]
    /** "pronto/desejado" (só ReplicaSet tem pods próprios). */
    pods: string
    changeCause: string
    created: number
  }

  const opts = () => (workload.selector ? { namespace: workload.namespace, labelSelector: workload.selector } : null)
  const sets = new LiveList('replicasets', () => (kind === 'deployments' ? opts() : null))
  const crs = new LiveList('controllerrevisions', () => (kind !== 'deployments' ? opts() : null))

  const revisions = $derived<Revision[]>(
    (kind === 'deployments'
      ? sets.rows
          .filter((r) => r.owner?.uid === workload.uid)
          .map((r) => ({ uid: r.uid, name: r.name, revision: r.revision, images: r.images, pods: `${r.ready}/${r.desired}`, changeCause: r.changeCause, created: r.created }))
      : crs.rows
          .filter((r) => r.ownerUid === workload.uid)
          .map((r) => ({ uid: r.uid, name: r.name, revision: r.revision, images: r.images, pods: '', changeCause: '', created: r.created }))
    ).sort((a, b) => b.revision - a.revision),
  )
  const list = $derived(kind === 'deployments' ? sets : crs)
  const current = $derived(revisions[0]?.revision ?? 0)
  const showPods = $derived(kind === 'deployments')
  const showCause = $derived(revisions.some((r) => r.changeCause))

  let target = $state<Revision | null>(null)
  let saving = $state(false)
  let error = $state('')

  async function rollback() {
    if (!target) return
    saving = true
    error = ''
    try {
      await window.kube.rollback(kind, workload.namespace, workload.name, target.revision)
      toasts.success(`${workload.name}: voltando para a revisão ${target.revision}`)
      target = null
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  function close() {
    target = null
    error = ''
  }
</script>

{#if list.error}
  <div class="error-box" role="alert">{list.error}</div>
{:else if revisions.length === 0}
  <p class="muted">{list.loading ? 'Carregando…' : 'Nenhuma revisão encontrada.'}</p>
{:else}
  <p class="muted hint">
    {revisions.length === 1 ? 'Só há 1 revisão guardada' : `O Kubernetes guarda as últimas ${revisions.length} revisões`}
    (limite em <code>spec.revisionHistoryLimit</code>).
  </p>
  <table class="detail-table">
    <thead>
      <tr>
        <th>Revisão</th><th>{kind === 'deployments' ? 'ReplicaSet' : 'ControllerRevision'}</th><th>Imagens</th>
        {#if showPods}<th>Pods</th>{/if}
        {#if showCause}<th>Motivo</th>{/if}
        <th>Criada</th><th></th>
      </tr>
    </thead>
    <tbody>
      {#each revisions as r (r.uid)}
        <tr class:current={r.revision === current}>
          <td class="mono">
            {r.revision || '-'}
            {#if r.revision === current}<span class="badge">atual</span>{/if}
          </td>
          <td class="mono">{r.name}</td>
          <td class="mono text">{#each r.images as img, i (i)}<div>{img}</div>{/each}</td>
          {#if showPods}<td class="mono">{r.pods}</td>{/if}
          {#if showCause}<td class="text">{r.changeCause || '-'}</td>{/if}
          <td class="mono" title={formatDateTime(r.created)}>{formatAge(r.created, now.value)}</td>
          <td class="action">
            {#if r.revision !== current && r.revision > 0}
              <button onclick={() => (target = r)} disabled={paused} title={paused ? 'Rollout pausado' : undefined}>Voltar para esta</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if target}
  <Modal title="Voltar {workload.name} para a revisão {target.revision}?" onclose={close}>
    <p>
      O template de pods do {WORKLOADS[kind].label} volta a ser o da revisão {target.revision}, como num
      <code>kubectl rollout undo</code>. Isso inicia um rollout novo.
    </p>
    <div class="images">
      {#each target.images as img, i (i)}<code>{img}</code>{/each}
    </div>
    {#if strategy === 'Recreate'}
      <p class="warn">A estratégia é <strong>Recreate</strong>: o serviço fica fora do ar até os pods novos subirem.</p>
    {:else if strategy === 'OnDelete'}
      <p class="warn">A estratégia é <strong>OnDelete</strong>: os pods só mudam quando forem apagados.</p>
    {/if}
    {#if error}<div class="error-box" role="alert">{error}</div>{/if}
    {#snippet footer()}
      <button onclick={close}>Cancelar</button>
      <button class="primary" onclick={rollback} disabled={saving}>{saving ? 'Voltando…' : 'Voltar'}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .muted { color: var(--muted); }
  .hint { font-size: 12px; margin-bottom: -10px; }
  .warn { color: var(--pend); font-weight: 500; }
  code { font-family: var(--mono); font-size: 12px; }
  .badge {
    margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-family: var(--sans); font-size: 11px;
    color: var(--ok); background: var(--ok-bg);
  }
  tr.current td { background: var(--row-selected); }
  .action { text-align: right; white-space: nowrap; }
  .images { display: flex; flex-direction: column; gap: 4px; }
</style>
