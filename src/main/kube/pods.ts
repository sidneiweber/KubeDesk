import { CoreV1Api, type KubeConfig, type V1Container, type V1ContainerStatus, type V1Pod, type V1Volume } from '@kubernetes/client-node'
import type { Batch, ContainerDetail, PodDetail, PodRow, WatchOptions } from '@shared/api'
import { errorMessage } from './errors'
import { millis } from './meta'
import { computePodStatus, podStatusClass } from './podStatus'
import { cpuMillicores, memoryBytes, sumResources } from './quantity'
import { resourcePath, watchResource } from './watch'

export function toPodRow(p: V1Pod): PodRow {
  const s = computePodStatus(p)
  const containers = p.spec?.containers ?? []
  const res = (pick: (c: (typeof containers)[number]) => string | undefined, parse: (q?: string) => number | null, kind: 'request' | 'limit') =>
    sumResources(containers.map((c) => parse(pick(c))), kind)
  const owner = p.metadata?.ownerReferences?.find((o) => o.controller) ?? p.metadata?.ownerReferences?.[0]
  return {
    uid: p.metadata?.uid ?? '',
    name: p.metadata?.name ?? '',
    namespace: p.metadata?.namespace ?? '',
    status: s.status,
    statusClass: podStatusClass(s.status),
    ready: s.ready,
    restarts: s.restarts,
    node: p.spec?.nodeName ?? '',
    ip: p.status?.podIP ?? '',
    created: millis(p.metadata?.creationTimestamp),
    containers: containers.map((c) => c.name),
    owner: owner ? `${owner.kind}/${owner.name}` : '',
    cpuRequest: res((c) => c.resources?.requests?.cpu, cpuMillicores, 'request'),
    cpuLimit: res((c) => c.resources?.limits?.cpu, cpuMillicores, 'limit'),
    memoryRequest: res((c) => c.resources?.requests?.memory, memoryBytes, 'request'),
    memoryLimit: res((c) => c.resources?.limits?.memory, memoryBytes, 'limit'),
  }
}

export function watchPods(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<PodRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'pods', namespace),
    list: () => (namespace ? api.listNamespacedPod({ namespace, labelSelector }) : api.listPodForAllNamespaces({ labelSelector })),
    labelSelector,
    toRow: toPodRow,
    emit,
    onError,
  })
}

/** Apaga um pod. Se ele tem controlador, o controlador cria outro no lugar. */
export async function deletePod(kc: KubeConfig, namespace: string, name: string): Promise<void> {
  try {
    await kc.makeApiClient(CoreV1Api).deleteNamespacedPod({ name, namespace })
  } catch (err) {
    throw new Error(`Erro ao apagar ${name}: ${errorMessage(err)}`)
  }
}

function containerDetail(c: V1Container, st: V1ContainerStatus | undefined): ContainerDetail {
  const s = st?.state
  let state = ''
  let reason = ''
  let message = ''
  let since = 0
  let exitCode: number | null = null
  if (s?.running) {
    state = 'Running'
    since = millis(s.running.startedAt)
  } else if (s?.waiting) {
    state = 'Waiting'
    reason = s.waiting.reason ?? ''
    message = s.waiting.message ?? ''
  } else if (s?.terminated) {
    state = 'Terminated'
    reason = s.terminated.reason ?? ''
    message = s.terminated.message ?? ''
    exitCode = s.terminated.exitCode
    since = millis(s.terminated.finishedAt)
  }
  const last = st?.lastState?.terminated
  return {
    name: c.name,
    image: c.image ?? '',
    state,
    reason,
    message,
    since,
    exitCode,
    ready: st?.ready ?? false,
    restarts: st?.restartCount ?? 0,
    lastTermination: last ? `${last.reason || 'Error'} (exit ${last.exitCode})` : '',
    ports: (c.ports ?? []).map((p) => `${p.name ? `${p.name}:` : ''}${p.containerPort}/${p.protocol ?? 'TCP'}`),
    cpuRequest: cpuMillicores(c.resources?.requests?.cpu),
    cpuLimit: cpuMillicores(c.resources?.limits?.cpu),
    memoryRequest: memoryBytes(c.resources?.requests?.memory),
    memoryLimit: memoryBytes(c.resources?.limits?.memory),
  }
}

/** Tipo e origem de um volume, como o `kubectl describe` resume. */
export function volumeSource(v: V1Volume): { kind: string; source: string } {
  if (v.configMap) return { kind: 'ConfigMap', source: v.configMap.name ?? '' }
  if (v.secret) return { kind: 'Secret', source: v.secret.secretName ?? '' }
  if (v.persistentVolumeClaim) return { kind: 'PersistentVolumeClaim', source: v.persistentVolumeClaim.claimName }
  if (v.emptyDir) return { kind: 'EmptyDir', source: v.emptyDir.medium || '' }
  if (v.hostPath) return { kind: 'HostPath', source: v.hostPath.path }
  if (v.projected) return { kind: 'Projected', source: `${v.projected.sources?.length ?? 0} fontes` }
  if (v.downwardAPI) return { kind: 'DownwardAPI', source: '' }
  if (v.csi) return { kind: 'CSI', source: v.csi.driver }
  if (v.nfs) return { kind: 'NFS', source: `${v.nfs.server}:${v.nfs.path}` }
  // Tipos menos comuns: o nome do campo já diz qual é
  const key = Object.keys(v).find((k) => k !== 'name') ?? ''
  return { kind: key ? key[0].toUpperCase() + key.slice(1) : '-', source: '' }
}

export function toPodDetail(p: V1Pod): PodDetail {
  const statuses = new Map((p.status?.containerStatuses ?? []).map((s) => [s.name, s]))
  const initStatuses = new Map((p.status?.initContainerStatuses ?? []).map((s) => [s.name, s]))
  return {
    ...toPodRow(p),
    qosClass: p.status?.qosClass ?? '',
    serviceAccount: p.spec?.serviceAccountName ?? '',
    restartPolicy: p.spec?.restartPolicy ?? '',
    priorityClass: p.spec?.priorityClassName ?? '',
    hostIP: p.status?.hostIP ?? '',
    podIPs: (p.status?.podIPs ?? []).map((i) => i.ip),
    startTime: millis(p.status?.startTime),
    initContainers: (p.spec?.initContainers ?? []).map((c) => containerDetail(c, initStatuses.get(c.name))),
    containerDetails: (p.spec?.containers ?? []).map((c) => containerDetail(c, statuses.get(c.name))),
    conditions: (p.status?.conditions ?? []).map((c) => ({
      type: c.type, status: c.status, reason: c.reason ?? '', message: c.message ?? '', lastTransition: millis(c.lastTransitionTime),
    })),
    volumes: (p.spec?.volumes ?? []).map((v) => ({ name: v.name, ...volumeSource(v) })),
    labels: p.metadata?.labels ?? {},
    annotations: p.metadata?.annotations ?? {},
  }
}

/** Observa um pod só, pelo nome. opts.fieldSelector é ignorado: o filtro é o nome. */
export function watchPodDetails(
  kc: KubeConfig,
  { namespace, fieldSelector }: WatchOptions,
  emit: (b: Batch<PodDetail>) => void,
  onError: (message: string) => void,
): () => void {
  if (!namespace || !fieldSelector?.startsWith('metadata.name=')) {
    onError('Detalhe de pod precisa de namespace e de metadata.name')
    return () => {}
  }
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'pods', namespace),
    list: () => api.listNamespacedPod({ namespace, fieldSelector }),
    fieldSelector,
    toRow: toPodDetail,
    emit,
    onError,
  })
}
