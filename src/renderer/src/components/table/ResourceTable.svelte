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
    /** Números, idades, IPs: fonte monoespaçada. */
    mono?: boolean
    muted?: boolean
    /** O texto vira link que abre o recurso (chama onactivate). */
    link?: boolean
    /** Começa escondida (o usuário pode mostrar pelo botão Colunas). */
    hidden?: boolean
    /** Não pode ser escondida. A primeira coluna sempre é fixa. */
    fixed?: boolean
  }
</script>

<script lang="ts" generics="R extends { uid: string }">
  import { nextSort, sortRows, type Accessors } from '../../lib/sort'
  import ColumnPicker from './ColumnPicker.svelte'
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'

  let {
    id,
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
    menu,
  }: {
    /** Identifica a tabela nas preferências (colunas escondidas). */
    id?: string
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
    /** Itens do menu de contexto (botão direito, tecla Menu ou Shift+F10). */
    menu?: (row: R) => MenuItem[]
  } = $props()

  // Colunas escondidas: padrão das colunas, ou o que o usuário escolheu antes
  // svelte-ignore state_referenced_locally
  let hidden = $state<Set<string>>(new Set(columns.filter((c) => c.hidden).map((c) => c.key)))
  const prefKey = $derived(id ? `columns:${id}` : '')

  // Se o usuário mexer nas colunas antes de a preferência chegar do disco,
  // a escolha dele vale: a leitura atrasada não pode sobrescrevê-la
  let touched = false

  $effect(() => {
    if (!prefKey) return
    window.kube.getPref(prefKey).then((v) => {
      if (!touched && Array.isArray(v)) hidden = new Set(v.filter((k): k is string => typeof k === 'string'))
    }).catch(() => {})
  })

  function setHidden(next: Set<string>) {
    touched = true
    hidden = next
    if (prefKey) void window.kube.setPref(prefKey, [...next]).catch(() => {})
  }

  const isFixed = (c: Column<R>, i: number) => i === 0 || !!c.fixed
  const shown = $derived(columns.filter((c, i) => isFixed(c, i) || !hidden.has(c.key)))
  const pickable = $derived(columns.map((c, i) => ({ key: c.key, label: c.label, fixed: isFixed(c, i) })))

  // Menu de contexto aberto: linha e posição
  let menuAt = $state<{ row: R; x: number; y: number } | null>(null)

  function openMenu(row: R, x: number, y: number) {
    if (menu && menu(row).length) menuAt = { row, x, y }
  }

  function onRowMenu(e: MouseEvent, row: R) {
    if (!menu) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).focus()
    openMenu(row, e.clientX, e.clientY)
  }

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
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') onactivate?.(row)
    // Tecla Menu ou Shift+F10: abre o menu junto à linha
    if (menu && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
      e.preventDefault()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openMenu(row, r.left + 24, r.bottom)
    }
  }
</script>

<section>
  <div class="toolbar">
    <input class="search" type="search" placeholder="Filtrar" bind:value={filter} aria-label="Filtrar {noun}" />
    <span class="count" aria-live="polite">
      {#if loading}
        Carregando…
      {:else}
        {visible.length}{visible.length !== rows.length ? ` de ${rows.length}` : ''} {noun}
      {/if}
    </span>
    {@render toolbar?.()}
    {#if id}
      <span class="right"><ColumnPicker columns={pickable} {hidden} onchange={setHidden} /></span>
    {/if}
  </div>

  {#if error}
    <div class="error-box" role="alert">{error}</div>
  {/if}

  <div class="scroll">
    <table>
      <thead>
        <tr>
          {#each shown as c (c.key)}
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
              tabindex={onactivate || menu ? 0 : undefined}
              ondblclick={() => onactivate?.(row)} onkeydown={(e) => onRowKey(e, row)}
              oncontextmenu={(e) => onRowMenu(e, row)}>
            {#each shown as c (c.key)}
              <td class:mono={c.mono} class:muted={c.muted}>
                {#if c.cell}
                  {@render c.cell(row)}
                {:else if c.link && onactivate}
                  <button class="link" onclick={() => onactivate(row)}>{c.text?.(row) ?? ''}</button>
                {:else}
                  {c.text?.(row) ?? ''}
                {/if}
              </td>
            {/each}
            {#if actions}<td class="actions">{@render actions(row)}</td>{/if}
          </tr>
        {:else}
          {#if !loading && !error}
            <tr><td class="empty" colspan={shown.length + (actions ? 1 : 0)}>{filter ? `Nenhum resultado para "${filter}"` : emptyText}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</section>

{#if menuAt && menu}
  <ContextMenu x={menuAt.x} y={menuAt.y} items={menu(menuAt.row)} label="Ações" onclose={() => (menuAt = null)} />
{/if}

<style>
  /* min-width 0: sem isso a tabela larga empurra a página em vez de rolar */
  section { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; }
  .search { width: 320px; }
  .count { color: var(--muted); }
  .right { margin-left: auto; }
  .error-box { margin: 0 16px 10px; }

  .scroll { flex: 1; min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--surface); border-bottom: 1px solid var(--border); text-align: left; }
  th button, th .plain { all: unset; display: flex; gap: 4px; padding: 8px 12px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  th button { cursor: pointer; }
  th button:hover, th[aria-sort='ascending'] button, th[aria-sort='descending'] button { color: var(--text); }
  th button:focus-visible { outline: 2px solid var(--focus); }
  .arrow { font-size: 9px; align-self: center; }

  td { padding: 6px 12px; border-bottom: 1px solid var(--border-subtle); white-space: nowrap; user-select: text; }
  td:first-child { font-weight: 500; }
  tbody tr:hover { background: var(--row-hover); }
  tr:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  tr.selected, tr.selected:hover { background: var(--row-selected); }
  .mono { font-family: var(--mono); font-size: 12px; }
  /* Nome que abre os detalhes: parece link, não botão */
  .link { all: unset; cursor: pointer; color: var(--accent); font-weight: 500; }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
  .muted { color: var(--muted); }
  .empty { text-align: center; color: var(--muted); padding: 32px; font-weight: 400; }
  .actions { text-align: right; user-select: none; padding-top: 3px; padding-bottom: 3px; }
  .actions :global(button) { margin-left: 2px; }
  .actions :global(button:not(.icon-btn)) { padding: 2px 10px; font-size: 12px; }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
