<script lang="ts">
  import type { HpaRow } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { nav } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { kindToSection } from '../../lib/workloads'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { hpa, loading, onback }: {
    hpa: HpaRow | undefined
    loading: boolean
    onback: () => void
  } = $props()

  const targetSection = $derived(hpa ? kindToSection(hpa.target.kind) : null)
</script>

<DetailPage back="HPAs" {onback} title={hpa?.name ?? 'HorizontalPodAutoscaler'} found={!!hpa} {loading}>
  {#snippet after()}
    {#if hpa}<StatusPill status={hpa.status} statusClass={hpa.statusClass} />{/if}
  {/snippet}
  {#snippet actions()}
    {#if hpa}<button onclick={() => openYaml('hpas', hpa.namespace, hpa.name)}>YAML</button>{/if}
  {/snippet}
  {#if hpa}
    <Fields fields={[
      {
        label: 'Alvo',
        value: `${hpa.target.kind}/${hpa.target.name}`,
        onclick: targetSection ? () => nav.go(targetSection, { namespace: hpa.namespace, name: hpa.target.name }) : undefined,
      },
      { label: 'Réplicas', value: `${hpa.currentReplicas} atuais · ${hpa.desiredReplicas} desejadas` },
      { label: 'Limites', value: `mín ${hpa.minReplicas} · máx ${hpa.maxReplicas}` },
      { label: 'Última escala', value: hpa.lastScale ? `${formatDateTime(hpa.lastScale)} (${formatAge(hpa.lastScale, now.value)})` : 'nunca' },
      { label: 'Namespace', value: hpa.namespace },
      { label: 'Criado', value: `${formatDateTime(hpa.created)} (${formatAge(hpa.created, now.value)})` },
    ]} />

    <Section title="Métricas">
      {#if hpa.metrics.length === 0}
        <p class="muted">Nenhuma métrica declarada.</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Métrica</th><th>Tipo</th><th>Atual</th><th>Alvo</th></tr></thead>
          <tbody>
            {#each hpa.metrics as m, i (i)}
              <tr>
                <td>{m.name}</td>
                <td>{m.type}</td>
                <td class="mono" class:muted={m.current === '<unknown>'}>{m.current}</td>
                <td class="mono">{m.target}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Section>

    {#if hpa.conditions.length > 0}
      <Section title="Condições">
        <table class="detail-table">
          <thead><tr><th>Tipo</th><th>Status</th><th>Motivo</th><th>Mensagem</th><th>Desde</th></tr></thead>
          <tbody>
            {#each hpa.conditions as c (c.type)}
              <tr>
                <td>{c.type}</td>
                <td>{c.status}</td>
                <td class="text">{c.reason || '-'}</td>
                <td class="text">{c.message || '-'}</td>
                <td class="mono">{c.lastTransition ? formatAge(c.lastTransition, now.value) : '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Section>
    {/if}

    <Labels labels={hpa.labels} />
  {/if}
</DetailPage>

<style>
  .muted { color: var(--muted); }
</style>
