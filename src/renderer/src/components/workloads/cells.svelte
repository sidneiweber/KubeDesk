<script lang="ts" module>
  import type { WorkloadBase } from '@shared/api'
  import type { Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { formatAge } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'

  // Colunas que todo workload tem: nome, status, idade e imagens.

  export { statusCell, imagesCell }

  export function nameColumn<R extends WorkloadBase>(): Column<R> {
    return { key: 'name', label: 'Nome', sort: (r) => r.name, text: (r) => r.name, link: true }
  }

  export function statusColumn<R extends WorkloadBase>(): Column<R> {
    return { key: 'status', label: 'Status', sort: (r) => r.status, cell: statusCell }
  }

  export function ageColumn<R extends WorkloadBase>(): Column<R> {
    // Idade crescente = mais novo primeiro
    return { key: 'age', label: 'Idade', sort: (r) => (r.created ? -r.created : null), text: (r) => formatAge(r.created, now.value), mono: true }
  }

  export function imagesColumn<R extends WorkloadBase>(hidden = false): Column<R> {
    return { key: 'images', label: 'Imagens', sort: (r) => r.images.join(','), cell: imagesCell, hidden }
  }

  /** "pronto/desejado", ordenando pela fração (desejado 0 fica no fim). */
  export function readyColumn<R extends WorkloadBase>(ready: (r: R) => number, desired: (r: R) => number): Column<R> {
    return {
      key: 'ready', label: 'Ready', mono: true,
      sort: (r) => (desired(r) ? ready(r) / desired(r) : null),
      text: (r) => `${ready(r)}/${desired(r)}`,
    }
  }
</script>

{#snippet statusCell(r: WorkloadBase)}<StatusPill status={r.status} statusClass={r.statusClass} />{/snippet}
{#snippet imagesCell(r: WorkloadBase)}
  <span class="images" title={r.images.join('\n')}>
    {r.images[0] ?? '-'}{#if r.images.length > 1}<span class="more"> +{r.images.length - 1}</span>{/if}
  </span>
{/snippet}

<style>
  .images { font-family: var(--mono); font-size: 12px; color: var(--muted); display: inline-block; max-width: 360px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .more { color: var(--accent); }
</style>
