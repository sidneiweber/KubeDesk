<script lang="ts" module>
  export interface Field {
    label: string
    value: string
    /** Valor técnico (IP, seletor, imagem): Mono em Navy. */
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
  dl {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px 28px;
    padding: 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--head-bg);
  }
  div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  dt { font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  dd { color: var(--text-2); user-select: text; overflow-wrap: anywhere; }
  .code { font-family: var(--mono); font-size: 13px; color: var(--navy); }
</style>
