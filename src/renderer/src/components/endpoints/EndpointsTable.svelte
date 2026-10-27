<script lang="ts">
  import type { EndpointView } from '../../lib/endpoints'
  import StatusPill from '../table/StatusPill.svelte'

  // Endpoints de um service, um por endereço. Usado na tela de Endpoints e
  // nos detalhes do Service.

  let { endpoints, emptyText = 'Nenhum endpoint' }: { endpoints: EndpointView[]; emptyText?: string } = $props()

  const states = {
    ready: { status: 'Pronto', statusClass: 'running' },
    notReady: { status: 'Não pronto', statusClass: 'failed' },
    terminating: { status: 'Encerrando', statusClass: 'pending' },
  } as const
</script>

{#if endpoints.length === 0}
  <p class="muted">{emptyText}</p>
{:else}
  <table class="detail-table">
    <thead><tr><th>Endereço</th><th>Portas</th><th>Estado</th><th>Pod</th><th>Node</th></tr></thead>
    <tbody>
      {#each endpoints as e (e.address)}
        <tr>
          <td>{e.address}</td>
          <td>{e.ports.join(', ') || '-'}</td>
          <td><StatusPill {...states[e.state]} /></td>
          <td>{e.pod || '-'}</td>
          <td>{e.node || '-'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .muted { color: var(--muted); }
</style>
