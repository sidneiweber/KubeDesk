<script lang="ts">
  import type { ConfigMapRow } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import DataEntries from './DataEntries.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { configMap, loading, onback }: {
    configMap: ConfigMapRow | undefined
    loading: boolean
    onback: () => void
  } = $props()
</script>

<DetailPage back="ConfigMaps" {onback} title={configMap?.name ?? 'ConfigMap'} found={!!configMap} {loading}>
  {#snippet actions()}
    {#if configMap}<button onclick={() => openYaml('configmaps', configMap.namespace, configMap.name)}>YAML</button>{/if}
  {/snippet}
  {#if configMap}
    <Fields fields={[
      { label: 'Namespace', value: configMap.namespace },
      { label: 'Chaves', value: String(configMap.entries.length) },
      { label: 'Imutável', value: configMap.immutable ? 'Sim' : 'Não' },
      { label: 'Criado', value: `${formatDateTime(configMap.created)} (${formatAge(configMap.created, now.value)})` },
    ]} />

    <Section title="Dados">
      <DataEntries entries={configMap.entries} emptyText="Este ConfigMap não tem chaves." />
    </Section>

    <Labels labels={configMap.labels} />
  {/if}
</DetailPage>
