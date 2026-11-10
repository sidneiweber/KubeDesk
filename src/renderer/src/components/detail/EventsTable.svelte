<script lang="ts">
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { LiveList } from '../../lib/liveList.svelte'
  import { now } from '../../lib/now.svelte'

  // Eventos de um recurso (involvedObject.uid), mais recentes primeiro.

  let { namespace, uid }: { namespace: string; uid: string | undefined } = $props()

  const events = new LiveList('events', () => (uid ? { namespace, fieldSelector: `involvedObject.uid=${uid}` } : null))
  const sorted = $derived([...events.rows].sort((a, b) => b.last - a.last))
  const ago = (ms: number) => (ms ? formatAge(ms, now.value) : '-')
</script>

{#if events.error}
  <p class="muted">Não foi possível ler os eventos: {events.error}</p>
{:else if sorted.length === 0}
  <p class="muted">{events.loading ? 'Carregando…' : 'Nenhum evento recente (o cluster costuma guardar só a última hora).'}</p>
{:else}
  <table class="detail-table">
    <thead><tr><th>Tipo</th><th>Motivo</th><th>Mensagem</th><th>Vezes</th><th>Última</th><th>Origem</th></tr></thead>
    <tbody>
      {#each sorted as e (e.uid)}
        <tr>
          <td class:bad={e.type === 'Warning'}>{e.type}</td>
          <td>{e.reason}</td>
          <td class="text">{e.message}</td>
          <td class="mono">{e.count}</td>
          <td class="mono" title={formatDateTime(e.last)}>{ago(e.last)}</td>
          <td>{e.source || '-'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .muted { color: var(--muted); }
</style>
