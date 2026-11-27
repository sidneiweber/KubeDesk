<script lang="ts">
  import type { CsiNodeRow } from '@shared/api'
  import { nav } from '../../lib/nav.svelte'
  import { openYaml } from '../../lib/yaml.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import ResourceView from '../ResourceView.svelte'
  import type { Column } from '../table/ResourceTable.svelte'
  import { createdText } from './common'

  // `kubectl get csinodes` mostra só a contagem; os nomes ajudam mais
  const columns: Column<CsiNodeRow>[] = [
    { key: 'count', label: 'Drivers', sort: (n) => n.drivers.length, text: (n) => String(n.drivers.length), mono: true },
    { key: 'drivers', label: 'Nomes', sort: (n) => n.drivers.map((d) => d.name).join(','), text: (n) => n.drivers.map((d) => d.name).join(', ') || '-' },
  ]
</script>

<ResourceView kind="csinodes" clusterScoped {columns} noun="nodes" emptyText="Nenhum CSINode no cluster"
  search={(n) => `${n.name} ${n.drivers.map((d) => d.name).join(' ')}`}>
  {#snippet details({ row: n, loading, onback })}
    <DetailPage back="CSINodes" {onback} title={n?.name ?? 'CSINode'} found={!!n} {loading}>
      {#snippet actions()}{#if n}<button onclick={() => openYaml('csinodes', '', n.name)}>YAML</button>{/if}{/snippet}
      {#if n}
        <p class="muted">Criado {createdText(n.created)}</p>
        <Section title="Drivers">
          {#if n.drivers.length === 0}
            <p class="muted">Nenhum driver CSI registrado neste node.</p>
          {:else}
            <table class="detail-table">
              <thead><tr><th>Driver</th><th>Node ID</th><th>Limite de volumes</th><th>Topologia</th></tr></thead>
              <tbody>
                {#each n.drivers as d (d.name)}
                  <tr>
                    <td><button class="link" onclick={() => nav.go('csidrivers', { namespace: '', name: d.name })}>{d.name}</button></td>
                    <td class="mono">{d.nodeID}</td>
                    <td class="mono">{d.allocatable ?? '-'}</td>
                    <td class="mono">{d.topologyKeys.join(', ') || '-'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </Section>
        <Labels labels={n.labels} />
      {/if}
    </DetailPage>
  {/snippet}
</ResourceView>

<style>
  .muted { color: var(--muted); }
  .link { all: unset; cursor: pointer; color: var(--accent); }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--focus); }
</style>
