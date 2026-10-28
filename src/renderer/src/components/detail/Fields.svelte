<script lang="ts" module>
  export interface Field {
    label: string
    value: string
    /** Valor técnico (IP, seletor, imagem): fonte monoespaçada. */
    code?: boolean
  }
</script>

<script lang="ts">
  // Grade de "rótulo: valor" no topo das páginas de detalhe.

  let { fields }: { fields: Field[] } = $props()
</script>

<dl>
  {#each fields as f (f.label)}
    <div>
      <dt>{f.label}</dt>
      <dd class:code={f.code}>{f.value || '-'}</dd>
    </div>
  {/each}
</dl>

<style>
  dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px 24px; }
  div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  dt { font-size: 11px; color: var(--muted); }
  dd { user-select: text; overflow-wrap: anywhere; }
  .code { font-family: var(--mono); font-size: 12px; }
</style>
