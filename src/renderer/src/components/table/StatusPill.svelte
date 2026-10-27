<script lang="ts">
  import type { StatusClass } from '@shared/api'

  let { status, statusClass }: { status: string; statusClass: StatusClass } = $props()
</script>

<span class="pill {statusClass}">{status}</span>

<style>
  .pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; white-space: nowrap; }
  .running { background: rgba(74, 222, 128, .15); color: var(--ok); }
  .succeeded { background: rgba(167, 139, 250, .15); color: var(--done); }
  .pending { background: rgba(251, 191, 36, .15); color: var(--warn); }
  .failed { background: rgba(239, 68, 68, .15); color: var(--err); }
  .unknown { background: var(--surface-2); color: var(--muted); }
</style>
