import { CoreV1Api, type KubeConfig, type V1Pod } from '@kubernetes/client-node'
import type { Batch, PodRow, WatchOptions } from '@shared/api'
import { errorMessage } from './errors'
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
    created: p.metadata?.creationTimestamp ? new Date(p.metadata.creationTimestamp).getTime() : 0,
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
