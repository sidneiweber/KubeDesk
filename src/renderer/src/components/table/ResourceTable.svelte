<script lang="ts" module>
  import type { Snippet } from 'svelte'
  import type { SortState, SortValue } from '../../lib/sort'

  export interface Column<R> {
    key: string
    label: string
    /** Valor para ordenar; sem ele a coluna não ordena. */
    sort?: (row: R) => SortValue
    /** Texto da célula; ignorado quando a coluna tem `cell`. */
    text?: (row: R) => string
    cell?: Snippet<[R]>
    mono?: boolean
    muted?: boolean
  }
</script>

<script lang="ts" generics="R extends { uid: string }">
  import { nextSort, sortRows, type Accessors } from '../../lib/sort'

  let {
    rows,
    columns,
    search,
    loading,
    error,
    noun,
    emptyText,
    initialSort = { column: 'name', direction: 'asc' },
    selected,
    onactivate,
    actions,
    toolbar,
  }: {
    rows: readonly R[]
    columns: Column<R>[]
    /** Texto em que o filtro procura. */
    search: (row: R) => string
    loading: boolean
    error: string
    /** Plural para o contador, ex.: "pods". */
    noun: string
    emptyText: string
    initialSort?: SortState | null
    selected?: string | null
    /** Duplo clique ou Enter na linha. */
    onactivate?: (row: R) => void
    actions?: Snippet<[R]>
    toolbar?: Snippet
  } = $props()

  let filter = $state('')
  // svelte-ignore state_referenced_locally
  let sort = $state<SortState | null>(initialSort)

  const accessors = $derived(
    Object.fromEntries(columns.filter((c) => c.sort).map((c) => [c.key, c.sort!])) as Accessors<R>,
  )

  // A busca é local: filtra o que já está em memória, sem ir ao cluster
  const visible = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    const matched = q ? rows.filter((r) => search(r).toLowerCase().includes(q)) : rows
    return sortRows(matched, accessors, sort)
  })

  function ariaSort(key: string) {
    if (sort?.column !== key) return 'none'
    return sort.direction === 'asc' ? 'ascending' : 'descending'
  }

  function onRowKey(e: KeyboardEvent, row: R) {
    if (e.key === 'Enter' && e.target === e.currentTarget) onactivate?.(row)
  }
</script>

<section>
  <div class="toolbar">
    <input type="search" placeholder="Filtrar" bind:value={filter} aria-label="Filtrar {noun}" />
    <span class="count" aria-live="polite">
      {#if loading}
        Carregando…
      {:else}
        {visible.length}{visible.length !== rows.length ? ` de ${rows.length}` : ''} {noun}
      {/if}
    </span>
    {@render toolbar?.()}
  </div>

  {#if error}
    <div class="error-box" role="alert">{error}</div>
  {/if}

  <div class="scroll">
    <table>
      <thead>
        <tr>
          {#each columns as c (c.key)}
            <th aria-sort={c.sort ? ariaSort(c.key) : undefined}>
              {#if c.sort}
                <button onclick={() => (sort = nextSort(sort, c.key))}>
                  {c.label}<span class="arrow" aria-hidden="true">{sort?.column === c.key ? (sort.direction === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              {:else}
                <span class="plain">{c.label}</span>
              {/if}
            </th>
          {/each}
          {#if actions}<th><span class="sr-only">Ações</span></th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each visible as row (row.uid)}
          <tr class:selected={row.uid === selected} class:clickable={onactivate}
              tabindex={onactivate ? 0 : undefined}
              ondblclick={() => onactivate?.(row)} onkeydown={(e) => onRowKey(e, row)}>
            {#each columns as c (c.key)}
              <td class:mono={c.mono} class:muted={c.muted}>
                {#if c.cell}{@render c.cell(row)}{:else}{c.text?.(row) ?? ''}{/if}
              </td>
            {/each}
            {#if actions}<td class="actions">{@render actions(row)}</td>{/if}
          </tr>
        {:else}
          {#if !loading && !error}
            <tr><td class="empty" colspan={columns.length + (actions ? 1 : 0)}>{filter ? `Nenhum resultado para "${filter}"` : emptyText}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; }
  .toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .toolbar input { width: 320px; }
  .count { color: var(--muted); }
  .error-box { margin: 0 16px 10px; }

  .scroll { flex: 1; min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--surface); border-bottom: 1px solid var(--border); text-align: left; }
  th button, th .plain { all: unset; display: flex; gap: 4px; padding: 8px 12px; font-weight: 500; color: var(--muted); }
  th button { cursor: pointer; }
  th button:hover, th[aria-sort='ascending'] button, th[aria-sort='descending'] button { color: var(--text); }
  th button:focus-visible { outline: 2px solid var(--accent); }
  .arrow { font-size: 9px; align-self: center; }

  td { padding: 6px 12px; border-bottom: 1px solid var(--border-subtle); white-space: nowrap; user-select: text; }
  td:first-child { font-weight: 500; }
  tbody tr:hover { background: #222; }
  tr.clickable { cursor: default; }
  tr:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  tr.selected, tr.selected:hover { background: rgba(74, 158, 255, .12); }
  .mono { font-family: var(--mono); font-size: 12px; }
  .muted { color: var(--muted); }
  .empty { text-align: center; color: var(--muted); padding: 32px; font-weight: 400; }
  .actions { text-align: right; user-select: none; }
  .actions :global(button) { padding: 2px 10px; font-size: 12px; margin-left: 4px; }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
