<script lang="ts">
  import type { DeploymentRow } from '@shared/api'
  import { LiveList } from '../../lib/liveList.svelte'
  import { session } from '../../lib/session.svelte'
  import DeploymentsTable from './DeploymentsTable.svelte'
  import DeploymentDetails from './DeploymentDetails.svelte'
  import ScaleDialog from './ScaleDialog.svelte'
  import RestartDialog from './RestartDialog.svelte'
  import PageHeader from '../PageHeader.svelte'

  // Uma lista só, compartilhada por tabela e detalhes: os detalhes ficam ao
  // vivo sem abrir outro watch
  const deployments = new LiveList('deployments', () => ({ namespace: session.namespace }))

  let detailsUid = $state<string | null>(null)
  let dialog = $state<{ kind: 'scale' | 'restart'; uid: string } | null>(null)

  const details = $derived(deployments.get(detailsUid))
  const dialogTarget = $derived(deployments.get(dialog?.uid))

  // Trocar de namespace volta para a lista
  $effect(() => {
    void session.namespace
    detailsUid = null
  })

  const open = (d: DeploymentRow) => (detailsUid = d.uid)
  const scale = (d: DeploymentRow) => (dialog = { kind: 'scale', uid: d.uid })
  const restart = (d: DeploymentRow) => (dialog = { kind: 'restart', uid: d.uid })
</script>

{#if detailsUid}
  <DeploymentDetails deployment={details} loading={deployments.loading} onback={() => (detailsUid = null)} onscale={scale} onrestart={restart} />
{:else}
  <div class="list">
    <PageHeader title="Deployments" />
    <DeploymentsTable {deployments} namespace={session.namespace} onopen={open} onscale={scale} onrestart={restart} />
  </div>
{/if}

{#if dialog && dialogTarget}
  {#if dialog.kind === 'scale'}
    <ScaleDialog deployment={dialogTarget} onclose={() => (dialog = null)} />
  {:else}
    <RestartDialog deployment={dialogTarget} onclose={() => (dialog = null)} />
  {/if}
{/if}

<style>
  .list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 20px; padding: 24px 32px; }
  .list > :global(section) { flex: 1; }
</style>
