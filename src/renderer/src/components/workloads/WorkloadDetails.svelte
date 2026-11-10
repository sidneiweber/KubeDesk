<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { WorkloadBase, WorkloadKind } from '@shared/api'
  import { formatAge, formatDateTime } from '../../lib/formatAge'
  import { nav } from '../../lib/nav.svelte'
  import { now } from '../../lib/now.svelte'
  import { isRollout, kindToSection, WORKLOADS } from '../../lib/workloads'
  import StatusPill from '../table/StatusPill.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Section from '../detail/Section.svelte'
  import Fields, { type Field } from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import PodsWithLogs from '../detail/PodsWithLogs.svelte'
  import EventsTable from '../detail/EventsTable.svelte'
  import MultiPodLogs from '../logs/MultiPodLogs.svelte'
  import YamlEditor from '../YamlEditor.svelte'
  import Revisions from './Revisions.svelte'

  // Página de detalhe de qualquer workload, em abas: Visão geral, Revisões
  // (quem tem rollout), Logs dos pods, YAML editável e Eventos. Cada tipo
  // entra com os campos dele e, se quiser, uma seção a mais na visão geral.

  let {
    kind,
    workload,
    loading,
    onback,
    fields = [],
    buttons,
    overview,
    podSelector,
    noPodsText = 'Sem seletor: não há como saber quais pods são dele.',
    paused = false,
    strategy = '',
  }: {
    kind: WorkloadKind
    /** undefined = removido do cluster (ou ainda carregando). */
    workload: WorkloadBase | undefined
    loading: boolean
    onback: () => void
    /** Campos do tipo, mostrados depois de namespace e dono. */
    fields?: Field[]
    /** Botões de ação no cabeçalho. */
    buttons?: Snippet
    /** Seções extras da visão geral, antes das condições. */
    overview?: Snippet
    /** Seletor dos pods (padrão: o do workload). */
    podSelector?: string
    noPodsText?: string
    paused?: boolean
    strategy?: string
  } = $props()

  const meta = $derived(WORKLOADS[kind])
  const selector = $derived(podSelector ?? workload?.selector ?? '')

  let tab = $state('overview')
  let yamlDirty = $state(false)
  // O editor fica montado depois da primeira visita, para trocar de aba sem
  // perder uma edição em andamento
  let yamlOpened = $state(false)
  $effect(() => {
    if (tab === 'yaml') yamlOpened = true
  })

  const tabs = $derived([
    { id: 'overview', label: 'Visão geral' },
    ...(isRollout(kind) ? [{ id: 'revisions', label: 'Revisões' }] : []),
    { id: 'logs', label: 'Logs' },
    { id: 'yaml', label: yamlDirty ? 'YAML ●' : 'YAML' },
    { id: 'events', label: 'Eventos' },
  ])

  const ownerField = $derived.by((): Field[] => {
    const o = workload?.owner
    if (!o) return []
    const section = kindToSection(o.kind)
    const ns = workload!.namespace
    return [{ label: 'Controlado por', value: `${o.kind}/${o.name}`, onclick: section ? () => nav.go(section, { namespace: ns, name: o.name }) : undefined }]
  })

  // A anotação do kubectl apply repete o objeto inteiro: só polui
  const annotations = $derived(
    Object.entries(workload?.annotations ?? {}).filter(([k]) => k !== 'kubectl.kubernetes.io/last-applied-configuration'),
  )

  const resources = (r: Record<string, string>) =>
    Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'
</script>

<DetailPage back={meta.plural} {onback} title={workload?.name ?? meta.label} found={!!workload} {loading}
            {tabs} bind:tab fill={tab === 'logs' || tab === 'yaml'} actions={workload ? buttons : undefined}>
  {#snippet after()}
    {#if workload}<StatusPill status={workload.status} statusClass={workload.statusClass} />{/if}
  {/snippet}

  {#if workload && tab === 'overview'}
    <Fields fields={[
      { label: 'Namespace', value: workload.namespace },
      ...ownerField,
      ...fields,
      { label: 'Criado', value: `${formatDateTime(workload.created)} (${formatAge(workload.created, now.value)})` },
      ...(workload.selector ? [{ label: 'Seletor', value: workload.selector, code: true }] : []),
    ]} />

    {@render overview?.()}

    {#if workload.conditions.length > 0}
      <Section title="Condições">
        <table class="detail-table">
          <thead><tr><th>Tipo</th><th>Status</th><th>Motivo</th><th>Mensagem</th><th>Desde</th></tr></thead>
          <tbody>
            {#each workload.conditions as c (c.type)}
              <tr>
                <td>{c.type}</td>
                <td class:ok={c.status === 'True'} class:bad={c.status === 'False'}>{c.status}</td>
                <td class="text">{c.reason || '-'}</td>
                <td class="text">{c.message || '-'}</td>
                <td class="mono">{c.lastTransition ? formatAge(c.lastTransition, now.value) : '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Section>
    {/if}

    <Section title="Containers">
      <div class="containers">
        {#each workload.containers as c (c.name)}
          <div class="container">
            <strong>{c.name}</strong>
            <Fields fields={[
              { label: 'Imagem', value: c.image, code: true },
              { label: 'Portas', value: c.ports.join(', '), code: true },
              { label: 'Requests', value: resources(c.requests), code: true },
              { label: 'Limits', value: resources(c.limits), code: true },
            ]} />
          </div>
        {/each}
      </div>
    </Section>

    <Labels labels={workload.labels} />

    {#if annotations.length > 0}
      <Section title="Annotations">
        <table class="detail-table">
          <tbody>
            {#each annotations as [k, v] (k)}
              <tr><td class="mono">{k}</td><td class="mono text"><div class="clamp">{v}</div></td></tr>
            {/each}
          </tbody>
        </table>
      </Section>
    {/if}

    <PodsWithLogs namespace={workload.namespace} {selector} emptyText="Nenhum pod rodando" noSelectorText={noPodsText} />
  {:else if workload && tab === 'revisions' && isRollout(kind)}
    <Revisions {kind} {workload} {paused} {strategy} />
  {:else if workload && tab === 'logs'}
    {#if selector}
      {#key selector}
        <MultiPodLogs namespace={workload.namespace} {selector} containers={workload.containers.map((c) => c.name)} />
      {/key}
    {:else}
      <p class="muted pad">{noPodsText}</p>
    {/if}
  {:else if workload && tab === 'events'}
    <EventsTable namespace={workload.namespace} uid={workload.uid} />
  {/if}

  {#if workload && yamlOpened}
    <div class="yaml" class:hidden={tab !== 'yaml'}>
      <YamlEditor {kind} namespace={workload.namespace} name={workload.name} bind:dirty={yamlDirty} />
    </div>
  {/if}
</DetailPage>

<style>
  .muted { color: var(--muted); }
  .pad { padding: 16px; }
  .containers { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  .container { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .container :global(dl) { grid-template-columns: 1fr; gap: 8px; }
  .clamp { max-height: 6em; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .yaml { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .yaml.hidden { display: none; }
</style>
