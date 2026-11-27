<script lang="ts">
  import type { VolumeAttachmentRow } from '@shared/api'
  import { nav } from '../../lib/nav.svelte'
  import { openYaml } from '../../lib/yaml.svelte'
  import DetailPage from '../detail/DetailPage.svelte'
  import Fields from '../detail/Fields.svelte'
  import Labels from '../detail/Labels.svelte'
  import Section from '../detail/Section.svelte'
  import ResourceView from '../ResourceView.svelte'
  import type { Column } from '../table/ResourceTable.svelte'
  import StatusPill from '../table/StatusPill.svelte'
  import { createdText, yesNo } from './common'

  // Colunas do `kubectl get volumeattachments`, com o status em vez de ATTACHED
  const columns: Column<VolumeAttachmentRow>[] = [
    { key: 'status', label: 'Status', sort: (v) => v.status, cell: status },
    { key: 'attacher', label: 'Attacher', sort: (v) => v.attacher, text: (v) => v.attacher },
    { key: 'pv', label: 'PV', sort: (v) => v.pv, text: (v) => v.pv || (v.inline ? '(inline)' : '-') },
    { key: 'node', label: 'Node', sort: (v) => v.node, text: (v) => v.node },
  ]
</script>

{#snippet status(v: VolumeAttachmentRow)}<StatusPill status={v.status} statusClass={v.statusClass} />{/snippet}

<ResourceView kind="volumeattachments" clusterScoped {columns} noun="attachments" emptyText="Nenhum VolumeAttachment no cluster"
  search={(v) => `${v.name} ${v.attacher} ${v.pv} ${v.node} ${v.status}`}>
  {#snippet details({ row: va, loading, onback })}
    <DetailPage back="VolumeAttachments" {onback} title={va?.name ?? 'VolumeAttachment'} found={!!va} {loading}>
      {#snippet after()}{#if va}<StatusPill status={va.status} statusClass={va.statusClass} />{/if}{/snippet}
      {#snippet actions()}{#if va}<button onclick={() => openYaml('volumeattachments', '', va.name)}>YAML</button>{/if}{/snippet}
      {#if va}
        <Fields fields={[
          {
            label: 'Attacher', value: va.attacher,
            onclick: () => nav.go('csidrivers', { namespace: '', name: va.attacher }),
          },
          {
            label: 'PersistentVolume', value: va.pv || (va.inline ? '(volume inline)' : ''),
            onclick: va.pv ? () => nav.go('pvs', { namespace: '', name: va.pv }) : undefined,
          },
          { label: 'Node', value: va.node },
          { label: 'Anexado', value: yesNo(va.attached) },
          { label: 'Criado', value: createdText(va.created) },
        ]} />

        {#if va.error}
          <Section title="Erro"><div class="error-box" role="alert">{va.error}</div></Section>
        {/if}

        {#if Object.keys(va.metadata).length > 0}
          <Section title="Metadados do attach">
            <table class="detail-table">
              <tbody>
                {#each Object.entries(va.metadata) as [k, v] (k)}
                  <tr><td class="mono">{k}</td><td class="mono">{v}</td></tr>
                {/each}
              </tbody>
            </table>
          </Section>
        {/if}

        <Labels labels={va.labels} />
      {/if}
    </DetailPage>
  {/snippet}
</ResourceView>
