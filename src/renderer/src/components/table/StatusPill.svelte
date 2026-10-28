<script lang="ts">
  import type { StatusClass } from '@shared/api'

  // Status com ícone + texto: não depende só da cor. O ícone segue a classe
  // (ok, concluído, pendente, falha, desconhecido); o texto é o motivo exato
  // do Kubernetes.

  let { status, statusClass }: { status: string; statusClass: StatusClass } = $props()

  const kind = $derived(
    statusClass === 'running' ? 'ok' : statusClass === 'succeeded' ? 'done' : statusClass === 'pending' ? 'pend' : statusClass === 'failed' ? 'fail' : 'unk',
  )
</script>

<span class="badge {kind}">
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind === 'ok' || kind === 'done'}
      <path d="M3 8.5l3 3 7-7" />
    {:else if kind === 'pend'}
      <circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" />
    {:else if kind === 'fail'}
      <path d="M4 4l8 8M12 4l-8 8" />
    {:else}
      <circle cx="8" cy="8" r="6" /><path d="M6.5 6.2a1.6 1.6 0 113 .8c-.6.4-1.5.8-1.5 1.7M8 11.3v.2" />
    {/if}
  </svg>
  {status}
</span>

<style>
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 500; white-space: nowrap;
  }
  /* Ícone discreto: o status não depende só da cor */
  svg { width: 10px; height: 10px; flex-shrink: 0; }
  .ok { background: var(--ok-bg); color: var(--ok); }
  .done { background: var(--done-bg); color: var(--done); }
  .pend { background: var(--pend-bg); color: var(--pend); }
  .fail { background: var(--fail-bg); color: var(--fail); }
  .unk { background: var(--unk-bg); color: var(--unk); }
</style>
