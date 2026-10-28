<script lang="ts">
  import { usageView } from '../../lib/usage'

  // Uso de um recurso: valor no formato do `kubectl top` e uma barra contra o
  // limit (ou o request). Sem medição, mostra N/D: nunca um número inventado.

  let { used, request, limit, format, unavailable }: {
    used: number | undefined
    request: number | null
    limit: number | null
    format: (n: number) => string
    /** Motivo de não haver métricas (sem metrics-server, sem permissão). */
    unavailable: string
  } = $props()

  const view = $derived(used === undefined ? null : usageView(used, request, limit, format))
</script>

{#if unavailable}
  <span class="na" title={unavailable}>N/D</span>
{:else if !view}
  <!-- Pod novo ainda sem leitura do metrics-server -->
  <span class="na" title="Ainda sem medição para este pod">-</span>
{:else}
  <span class="usage" title={view.title}>
    <span class="value">{view.text}</span>
    {#if view.percent !== null}
      <span class="bar {view.level}" aria-hidden="true"><span style:width="{Math.min(view.percent, 100)}%"></span></span>
      <span class="pct">{view.percent}%</span>
    {/if}
  </span>
{/if}

<style>
  .na { color: var(--muted); }
  .usage { display: inline-flex; align-items: center; gap: 8px; }
  .value { min-width: 46px; }
  .bar { width: 48px; height: 6px; border-radius: 3px; background: var(--nevoa); overflow: hidden; }
  .bar span { display: block; height: 100%; border-radius: 3px; }
  .ok span { background: var(--ok); }
  .warn span { background: #D98E04; }
  .high span { background: var(--fail); }
  .neutral span { background: var(--azul); }
  .pct { font-size: 11px; color: var(--muted); min-width: 32px; }
  .high + .pct { color: var(--fail); font-weight: 500; }
</style>
