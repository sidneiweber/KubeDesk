<script lang="ts">
  import type { SecretRow } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { now } from '../../lib/now.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import DataEntries, { type DataEntry } from './DataEntries.svelte'
  import { openYaml } from '../../lib/yaml.svelte'

  let { secret, loading, onback }: {
    secret: SecretRow | undefined
    loading: boolean
    onback: () => void
  } = $props()

  // Valores só na tela depois de pedir. Ficam neste componente: saem junto
  // com a página.
  let revealed = $state(false)
  let values = $state<Record<string, string> | null>(null)
  let error = $state('')

  const fetchValues = () => window.kube.revealSecret(secret!.namespace, secret!.name)

  // A linha só é trocada quando o secret muda no cluster: aí relê os valores
  $effect(() => {
    if (!revealed || !secret) return
    let cancelled = false
    error = ''
    fetchValues()
      .then((v) => { if (!cancelled) values = v })
      .catch((e: Error) => { if (!cancelled) error = e.message })
    return () => { cancelled = true }
  })

  function toggle() {
    revealed = !revealed
    if (!revealed) {
      values = null
      error = ''
    }
  }

  const entries: DataEntry[] = $derived(
    (secret?.keys ?? []).map((k) => ({
      key: k.key,
      size: k.size,
      value: revealed && values ? (values[k.key] ?? '') : null,
      hidden: revealed && !values && !error ? 'Carregando…' : '••••••••',
    })),
  )

  // Copiar não exige revelar: busca só a chave pedida
  async function copyValue(key: string): Promise<string | null> {
    const v = values ?? (await fetchValues())
    return v[key] ?? ''
  }
</script>

<DetailPage back="Secrets" {onback} title={secret?.name ?? 'Secret'} found={!!secret} {loading}>
  {#snippet actions()}
    {#if secret}
      <button onclick={toggle}>{revealed ? 'Ocultar valores' : 'Revelar valores'}</button>
      <button onclick={() => openYaml('secrets', secret.namespace, secret.name)}>YAML</button>
    {/if}
  {/snippet}
  {#if secret}
    <Fields fields={[
      { label: 'Namespace', value: secret.namespace },
      { label: 'Tipo', value: secret.type, code: true },
      { label: 'Chaves', value: String(secret.keys.length) },
      { label: 'Imutável', value: secret.immutable ? 'Sim' : 'Não' },
      { label: 'Criado', value: `${formatDateTime(secret.created)} (${formatAge(secret.created, now.value)})` },
    ]} />

    <Section title="Dados">
      {#if error}<div class="error-box" role="alert">{error}</div>{/if}
      <DataEntries {entries} emptyText="Este Secret não tem chaves." oncopy={copyValue} />
    </Section>

    <Labels labels={secret.labels} />
  {/if}
</DetailPage>
