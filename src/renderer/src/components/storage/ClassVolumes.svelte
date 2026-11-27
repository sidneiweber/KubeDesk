<script lang="ts">
  import { LiveList } from '../../lib/liveList.svelte'
  import { nav } from '../../lib/nav.svelte'
  import Section from '../detail/Section.svelte'
  import StatusPill from '../table/StatusPill.svelte'

  // PVs de uma StorageClass. PV não tem seletor por classe: lista todos e filtra.
  let { className }: { className: string } = $props()

  const pvs = new LiveList('pvs', () => ({ namespace: '' }))
  const volumes = $derived(pvs.rows.filter((p) => p.storageClass === className))
</script>

<Section title="PersistentVolumes desta classe">
  {#if pvs.error}
    <div class="error-box" role="alert">{pvs.error}</div>
  {:else if pvs.loading}
    <p class="muted">Carregando…</p>
  {:else if volumes.length === 0}
    <p class="muted">Nenhum volume usa esta classe.</p>
  {:else}
    <table class="detail-table">
      <thead><tr><th>Nome</th><th>Status</th><th>Capacidade</th><th>Claim</th></tr></thead>
      <tbody>
        {#each volumes as p (p.uid)}
          <tr>
            <td><button class="link" onclick={() => nav.go('pvs', { namespace: '', name: p.name })}>{p.name}</button></td>
            <td><StatusPill status={p.status} statusClass={p.statusClass} /></td>
            <td class="mono">{p.capacity}</td>
            <td>{p.claim ? `${p.claim.namespace}/${p.claim.name}` : '-'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Section>

<style>
  .muted { color: var(--muted); }
  .link { all: unset; cursor: pointer; color: var(--accent); }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--focus); }
</style>
