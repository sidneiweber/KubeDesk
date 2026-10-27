<script lang="ts">
  import type { IngressRow } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { ingress, loading, onback }: {
    ingress: IngressRow | undefined
    loading: boolean
    onback: () => void
  } = $props()
</script>

<DetailPage back="Ingresses" {onback} title={ingress?.name ?? 'Ingress'} namespace={ingress?.namespace} found={!!ingress} {loading}>
  {#snippet actions()}
    {#if ingress}<button onclick={() => openYaml('ingresses', ingress.namespace, ingress.name)}>YAML</button>{/if}
  {/snippet}
  {#if ingress}
    <Fields fields={[
      { label: 'Classe', value: ingress.className },
      { label: 'Endereço', value: ingress.addresses.join(', ') || 'ainda não atribuído pelo controller', code: ingress.addresses.length > 0 },
      { label: 'Portas', value: ingress.ports, code: true },
      { label: 'Criado', value: `${formatDateTime(ingress.created)} (${formatAge(ingress.created, now.value)})` },
    ]} />

    <Section title="Regras">
      {#if ingress.rules.length === 0}
        <p class="muted">Nenhuma regra.</p>
      {:else}
        <table class="detail-table">
          <thead><tr><th>Host</th><th>Caminho</th><th>Tipo</th><th>Backend</th></tr></thead>
          <tbody>
            {#each ingress.rules as r, i (i)}
              <tr><td>{r.host}</td><td>{r.path}</td><td>{r.pathType}</td><td>{r.backend}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Section>

    {#if ingress.tls.length > 0}
      <Section title="TLS">
        <table class="detail-table">
          <thead><tr><th>Secret</th><th>Hosts</th></tr></thead>
          <tbody>
            {#each ingress.tls as t, i (i)}
              <tr><td>{t.secretName || '-'}</td><td>{t.hosts.join(', ') || '-'}</td></tr>
            {/each}
          </tbody>
        </table>
      </Section>
    {/if}

    <Labels labels={ingress.labels} />
  {/if}
</DetailPage>

<style>
  .muted { color: var(--muted); }
</style>
