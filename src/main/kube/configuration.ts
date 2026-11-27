import {
  AutoscalingV2Api,
  CoreV1Api,
  type KubeConfig,
  type V1ConfigMap,
  type V1Secret,
  type V2HorizontalPodAutoscaler,
  type V2MetricSpec,
  type V2MetricStatus,
  type V2MetricTarget,
  type V2MetricValueStatus,
} from '@kubernetes/client-node'
import type { Batch, ConfigMapRow, HpaMetric, HpaRow, SecretRow, StatusClass, WatchOptions } from '@shared/api'
import { errorMessage } from './errors'
import { apiGet } from './http'
import { millis } from './meta'
import { objectPath } from './resources'
import { resourcePath, watchResource } from './watch'

// ---- ConfigMap ----

export function toConfigMapRow(cm: V1ConfigMap): ConfigMapRow {
  const text = Object.entries(cm.data ?? {}).map(([key, value]) => ({ key, value, size: Buffer.byteLength(value) }))
  // binaryData vem em base64; o conteúdo não é texto, então só o tamanho
  const binary = Object.entries(cm.binaryData ?? {}).map(([key, b64]) => ({ key, value: null, size: Buffer.from(b64, 'base64').length }))
  return {
    uid: cm.metadata?.uid ?? '',
    name: cm.metadata?.name ?? '',
    namespace: cm.metadata?.namespace ?? '',
    entries: [...text, ...binary].sort((a, b) => a.key.localeCompare(b.key)),
    immutable: cm.immutable ?? false,
    created: millis(cm.metadata?.creationTimestamp),
    labels: cm.metadata?.labels ?? {},
  }
}

export function watchConfigMaps(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<ConfigMapRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'configmaps', namespace),
    list: () => (namespace ? api.listNamespacedConfigMap({ namespace, labelSelector }) : api.listConfigMapForAllNamespaces({ labelSelector })),
    labelSelector,
    toRow: toConfigMapRow,
    emit,
    onError,
  })
}

// ---- Secret ----

/**
 * A linha leva só as chaves e os tamanhos: os valores ficam no main e só vão
 * para a tela quando o usuário pede para revelar (secretValues).
 */
export function toSecretRow(s: V1Secret): SecretRow {
  return {
    uid: s.metadata?.uid ?? '',
    name: s.metadata?.name ?? '',
    namespace: s.metadata?.namespace ?? '',
    type: s.type ?? 'Opaque',
    keys: Object.entries(s.data ?? {})
      .map(([key, b64]) => ({ key, size: Buffer.from(b64, 'base64').length }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    immutable: s.immutable ?? false,
    created: millis(s.metadata?.creationTimestamp),
    labels: s.metadata?.labels ?? {},
  }
}

export function watchSecrets(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<SecretRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'secrets', namespace),
    list: () => (namespace ? api.listNamespacedSecret({ namespace, labelSelector }) : api.listSecretForAllNamespaces({ labelSelector })),
    labelSelector,
    toRow: toSecretRow,
    emit,
    onError,
  })
}

/** Valores do secret já decodificados do base64, lidos na hora do pedido. */
export function decodeSecretData(s: V1Secret): Record<string, string> {
  return Object.fromEntries(Object.entries(s.data ?? {}).map(([k, b64]) => [k, Buffer.from(b64, 'base64').toString('utf8')]))
}

export async function secretValues(kc: KubeConfig, namespace: string, name: string): Promise<Record<string, string>> {
  try {
    const res = await apiGet(kc, objectPath('secrets', namespace, name))
    return decodeSecretData((await res.json()) as V1Secret)
  } catch (err) {
    throw new Error(`Erro ao ler o secret ${name}: ${errorMessage(err)}`)
  }
}

// ---- HorizontalPodAutoscaler ----

function targetString(t: V2MetricTarget | undefined): string {
  if (!t) return '<unknown>'
  if (t.type === 'Utilization') return t.averageUtilization === undefined ? '<unknown>' : `${t.averageUtilization}%`
  return (t.type === 'Value' ? t.value : t.averageValue) ?? '<unknown>'
}

/** Valor atual no mesmo formato do alvo (porcentagem se o alvo é porcentagem). */
function currentString(c: V2MetricValueStatus | undefined, t: V2MetricTarget | undefined): string {
  if (!c) return '<unknown>'
  if (t?.type === 'Utilization') return c.averageUtilization === undefined ? '<unknown>' : `${c.averageUtilization}%`
  if (t?.type === 'Value') return c.value ?? '<unknown>'
  return c.averageValue ?? c.value ?? '<unknown>'
}

/** Nome da métrica e a chave para achar o status correspondente. */
function metricId(m: V2MetricSpec | V2MetricStatus): { name: string; key: string } | null {
  switch (m.type) {
    case 'Resource':
      return m.resource ? { name: m.resource.name, key: `Resource/${m.resource.name}` } : null
    case 'ContainerResource':
      return m.containerResource
        ? { name: `${m.containerResource.name} (${m.containerResource.container})`, key: `ContainerResource/${m.containerResource.name}/${m.containerResource.container}` }
        : null
    case 'Pods':
      return m.pods ? { name: m.pods.metric.name, key: `Pods/${m.pods.metric.name}` } : null
    case 'Object': {
      const o = m.object
      if (!o) return null
      const ref = `${o.describedObject.kind}/${o.describedObject.name}`
      return { name: `${o.metric.name} (${ref})`, key: `Object/${o.metric.name}/${ref}` }
    }
    case 'External':
      return m.external ? { name: m.external.metric.name, key: `External/${m.external.metric.name}` } : null
    default:
      return null
  }
}

function specTarget(m: V2MetricSpec): V2MetricTarget | undefined {
  return (m.resource ?? m.containerResource ?? m.pods ?? m.object ?? m.external)?.target
}

function statusCurrent(m: V2MetricStatus): V2MetricValueStatus | undefined {
  return (m.resource ?? m.containerResource ?? m.pods ?? m.object ?? m.external)?.current
}

/** Métricas com valor atual e alvo, como a coluna TARGETS do kubectl. */
export function hpaMetrics(hpa: V2HorizontalPodAutoscaler): HpaMetric[] {
  const current = new Map<string, V2MetricValueStatus | undefined>()
  for (const s of hpa.status?.currentMetrics ?? []) {
    const id = metricId(s)
    if (id) current.set(id.key, statusCurrent(s))
  }
  return (hpa.spec?.metrics ?? []).flatMap((m) => {
    const id = metricId(m)
    if (!id) return []
    const target = specTarget(m)
    return [{ type: m.type, name: id.name, current: currentString(current.get(id.key), target), target: targetString(target) }]
  })
}

export function hpaStatus(hpa: V2HorizontalPodAutoscaler): { status: string; statusClass: StatusClass } {
  const conds = hpa.status?.conditions ?? []
  const able = conds.find((c) => c.type === 'AbleToScale')
  const active = conds.find((c) => c.type === 'ScalingActive')
  if (able?.status === 'False') return { status: able.reason || 'Não consegue escalar', statusClass: 'failed' }
  if (active?.status === 'False') return { status: active.reason || 'Inativo', statusClass: 'failed' }
  if (!active) return { status: 'Aguardando métricas', statusClass: 'pending' }
  const limited = conds.find((c) => c.type === 'ScalingLimited')
  if (limited?.status === 'True') return { status: 'No limite', statusClass: 'pending' }
  return { status: 'Ativo', statusClass: 'running' }
}

export function toHpaRow(hpa: V2HorizontalPodAutoscaler): HpaRow {
  const spec = hpa.spec
  const ref = spec?.scaleTargetRef
  return {
    uid: hpa.metadata?.uid ?? '',
    name: hpa.metadata?.name ?? '',
    namespace: hpa.metadata?.namespace ?? '',
    ...hpaStatus(hpa),
    target: { kind: ref?.kind ?? '', name: ref?.name ?? '' },
    minReplicas: spec?.minReplicas ?? 1,
    maxReplicas: spec?.maxReplicas ?? 0,
    currentReplicas: hpa.status?.currentReplicas ?? 0,
    desiredReplicas: hpa.status?.desiredReplicas ?? 0,
    metrics: hpaMetrics(hpa),
    lastScale: millis(hpa.status?.lastScaleTime),
    conditions: (hpa.status?.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason ?? '',
      message: c.message ?? '',
      lastTransition: millis(c.lastTransitionTime),
    })),
    created: millis(hpa.metadata?.creationTimestamp),
    labels: hpa.metadata?.labels ?? {},
  }
}

export function watchHpas(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<HpaRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(AutoscalingV2Api)
  return watchResource({
    kc,
    path: resourcePath('/apis/autoscaling/v2', 'horizontalpodautoscalers', namespace),
    list: () =>
      namespace
        ? api.listNamespacedHorizontalPodAutoscaler({ namespace, labelSelector })
        : api.listHorizontalPodAutoscalerForAllNamespaces({ labelSelector }),
    labelSelector,
    toRow: toHpaRow,
    emit,
    onError,
  })
}
