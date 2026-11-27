import {
  CoreV1Api,
  StorageV1Api,
  type KubeConfig,
  type V1CSIDriver,
  type V1CSINode,
  type V1PersistentVolume,
  type V1PersistentVolumeClaim,
  type V1StorageClass,
  type V1VolumeAttachment,
} from '@kubernetes/client-node'
import type {
  Batch,
  CsiDriverRow,
  CsiNodeRow,
  PvcRow,
  PvRow,
  StatusClass,
  StorageClassRow,
  VolumeAttachmentRow,
  WatchOptions,
} from '@shared/api'
import { millis } from './meta'
import { parseQuantity } from './quantity'
import { resourcePath, watchResource } from './watch'
import { labelSelectorString } from './workloads'

type Emit<R> = (b: Batch<R>) => void

// ---- Formatos do kubectl ----

const ACCESS_MODE: Record<string, string> = {
  ReadWriteOnce: 'RWO',
  ReadOnlyMany: 'ROX',
  ReadWriteMany: 'RWX',
  ReadWriteOncePod: 'RWOP',
}

/** Coluna ACCESS MODES: "RWO", "RWO,ROX". */
export function accessModes(modes: string[] | undefined): string {
  return (modes ?? []).map((m) => ACCESS_MODE[m] ?? m).join(',')
}

/** "10Gi" e o mesmo valor em bytes, para ordenar. */
function capacity(q: string | undefined): { text: string; bytes: number | null } {
  return { text: q ?? '', bytes: parseQuantity(q) }
}

function phaseClass(phase: string, ok: string[], done: string[], fail: string[]): StatusClass {
  if (ok.includes(phase)) return 'running'
  if (done.includes(phase)) return 'succeeded'
  if (fail.includes(phase)) return 'failed'
  return phase ? 'pending' : 'unknown'
}

const meta = (o: { metadata?: { uid?: string; name?: string; namespace?: string; creationTimestamp?: Date; labels?: Record<string, string> } }) => ({
  uid: o.metadata?.uid ?? '',
  name: o.metadata?.name ?? '',
  namespace: o.metadata?.namespace ?? '',
  created: millis(o.metadata?.creationTimestamp),
  labels: o.metadata?.labels ?? {},
})

// ---- PersistentVolume ----

/** De onde vem o volume: "CSI ebs.csi.aws.com (vol-123)", "HostPath /data", "NFS srv:/exp". */
export function pvSource(pv: V1PersistentVolume): { kind: string; source: string } {
  const s = pv.spec ?? {}
  if (s.csi) return { kind: 'CSI', source: `${s.csi.driver} (${s.csi.volumeHandle})` }
  if (s.hostPath) return { kind: 'HostPath', source: s.hostPath.path }
  if (s.local) return { kind: 'Local', source: s.local.path }
  if (s.nfs) return { kind: 'NFS', source: `${s.nfs.server}:${s.nfs.path}` }
  // Plugins in-tree antigos: o nome do campo já diz o tipo
  const known = new Set(['accessModes', 'capacity', 'claimRef', 'mountOptions', 'nodeAffinity', 'persistentVolumeReclaimPolicy', 'storageClassName', 'volumeAttributesClassName', 'volumeMode'])
  const key = Object.keys(s).find((k) => !known.has(k))
  return { kind: key ? key[0].toUpperCase() + key.slice(1) : '-', source: '' }
}

/** Afinidade de node em uma linha: "kubernetes.io/hostname in (node-1)". */
function pvNodeAffinity(pv: V1PersistentVolume): string {
  const terms = pv.spec?.nodeAffinity?.required?.nodeSelectorTerms ?? []
  return terms
    .map((t) => labelSelectorString({ matchExpressions: t.matchExpressions }))
    .filter(Boolean)
    .join(' | ')
}

export function toPvRow(pv: V1PersistentVolume): PvRow {
  const spec = pv.spec ?? {}
  const phase = pv.status?.phase ?? ''
  // Apagado mas preso por finalizer (ainda em uso): o kubectl mostra Terminating
  const status = pv.metadata?.deletionTimestamp ? 'Terminating' : phase
  const cap = capacity(spec.capacity?.storage)
  const claim = spec.claimRef
  return {
    ...meta(pv),
    status,
    statusClass: status === 'Terminating' ? 'pending' : phaseClass(phase, ['Bound'], ['Available'], ['Failed']),
    capacity: cap.text,
    capacityBytes: cap.bytes,
    accessModes: accessModes(spec.accessModes),
    reclaimPolicy: spec.persistentVolumeReclaimPolicy ?? '',
    claim: claim?.name ? { namespace: claim.namespace ?? '', name: claim.name } : null,
    storageClass: spec.storageClassName ?? '',
    volumeMode: spec.volumeMode ?? 'Filesystem',
    ...pvSource(pv),
    nodeAffinity: pvNodeAffinity(pv),
    mountOptions: spec.mountOptions ?? [],
    reason: pv.status?.reason ?? '',
    message: pv.status?.message ?? '',
  }
}

export function watchPvs(kc: KubeConfig, { labelSelector }: WatchOptions, emit: Emit<PvRow>, onError: (m: string) => void): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: '/api/v1/persistentvolumes',
    list: () => api.listPersistentVolume({ labelSelector }),
    labelSelector,
    toRow: toPvRow,
    emit,
    onError,
  })
}

// ---- PersistentVolumeClaim ----

export function toPvcRow(pvc: V1PersistentVolumeClaim): PvcRow {
  const spec = pvc.spec ?? {}
  const phase = pvc.status?.phase ?? ''
  const status = pvc.metadata?.deletionTimestamp ? 'Terminating' : phase
  const cap = capacity(pvc.status?.capacity?.storage)
  return {
    ...meta(pvc),
    status,
    statusClass: status === 'Terminating' ? 'pending' : phaseClass(phase, ['Bound'], [], ['Lost']),
    volume: spec.volumeName ?? '',
    // Capacidade real só depois de ligado; antes, o que foi pedido
    capacity: cap.text,
    capacityBytes: cap.bytes,
    requested: spec.resources?.requests?.storage ?? '',
    accessModes: accessModes(pvc.status?.accessModes ?? spec.accessModes),
    storageClass: spec.storageClassName ?? '',
    volumeMode: spec.volumeMode ?? 'Filesystem',
    selector: labelSelectorString(spec.selector),
    conditions: (pvc.status?.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason ?? '',
      message: c.message ?? '',
      lastTransition: millis(c.lastTransitionTime),
    })),
  }
}

export function watchPvcs(kc: KubeConfig, { namespace, labelSelector }: WatchOptions, emit: Emit<PvcRow>, onError: (m: string) => void): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'persistentvolumeclaims', namespace),
    list: () =>
      namespace
        ? api.listNamespacedPersistentVolumeClaim({ namespace, labelSelector })
        : api.listPersistentVolumeClaimForAllNamespaces({ labelSelector }),
    labelSelector,
    toRow: toPvcRow,
    emit,
    onError,
  })
}

// ---- VolumeAttachment ----

export function toVolumeAttachmentRow(va: V1VolumeAttachment): VolumeAttachmentRow {
  const attached = va.status?.attached ?? false
  const error = va.status?.attachError?.message || va.status?.detachError?.message || ''
  return {
    ...meta(va),
    status: error ? 'Erro' : attached ? 'Anexado' : 'Anexando',
    statusClass: error ? 'failed' : attached ? 'running' : 'pending',
    attacher: va.spec?.attacher ?? '',
    pv: va.spec?.source?.persistentVolumeName ?? '',
    // Volume inline (migração CSI), sem PV
    inline: !va.spec?.source?.persistentVolumeName && !!va.spec?.source?.inlineVolumeSpec,
    node: va.spec?.nodeName ?? '',
    attached,
    error,
    metadata: va.status?.attachmentMetadata ?? {},
  }
}

export function watchVolumeAttachments(kc: KubeConfig, { labelSelector }: WatchOptions, emit: Emit<VolumeAttachmentRow>, onError: (m: string) => void): () => void {
  const api = kc.makeApiClient(StorageV1Api)
  return watchResource({
    kc,
    path: '/apis/storage.k8s.io/v1/volumeattachments',
    list: () => api.listVolumeAttachment({ labelSelector }),
    labelSelector,
    toRow: toVolumeAttachmentRow,
    emit,
    onError,
  })
}

// ---- StorageClass ----

export function isDefaultClass(sc: V1StorageClass): boolean {
  const ann = sc.metadata?.annotations ?? {}
  return ann['storageclass.kubernetes.io/is-default-class'] === 'true' || ann['storageclass.beta.kubernetes.io/is-default-class'] === 'true'
}

export function toStorageClassRow(sc: V1StorageClass): StorageClassRow {
  return {
    ...meta(sc),
    provisioner: sc.provisioner,
    // Padrões da API quando o campo não vem
    reclaimPolicy: sc.reclaimPolicy ?? 'Delete',
    volumeBindingMode: sc.volumeBindingMode ?? 'Immediate',
    allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
    isDefault: isDefaultClass(sc),
    parameters: sc.parameters ?? {},
    mountOptions: sc.mountOptions ?? [],
  }
}

export function watchStorageClasses(kc: KubeConfig, { labelSelector }: WatchOptions, emit: Emit<StorageClassRow>, onError: (m: string) => void): () => void {
  const api = kc.makeApiClient(StorageV1Api)
  return watchResource({
    kc,
    path: '/apis/storage.k8s.io/v1/storageclasses',
    list: () => api.listStorageClass({ labelSelector }),
    labelSelector,
    toRow: toStorageClassRow,
    emit,
    onError,
  })
}

// ---- CSIDriver ----

export function toCsiDriverRow(d: V1CSIDriver): CsiDriverRow {
  const s = d.spec ?? {}
  return {
    ...meta(d),
    // Padrões da API (storage.k8s.io/v1) quando o campo não vem
    attachRequired: s.attachRequired ?? true,
    podInfoOnMount: s.podInfoOnMount ?? false,
    storageCapacity: s.storageCapacity ?? false,
    tokenRequests: (s.tokenRequests ?? []).map((t) => t.audience),
    requiresRepublish: s.requiresRepublish ?? false,
    modes: s.volumeLifecycleModes ?? ['Persistent'],
    fsGroupPolicy: s.fsGroupPolicy ?? 'ReadWriteOnceWithFSType',
    seLinuxMount: s.seLinuxMount ?? false,
  }
}

export function watchCsiDrivers(kc: KubeConfig, { labelSelector }: WatchOptions, emit: Emit<CsiDriverRow>, onError: (m: string) => void): () => void {
  const api = kc.makeApiClient(StorageV1Api)
  return watchResource({
    kc,
    path: '/apis/storage.k8s.io/v1/csidrivers',
    list: () => api.listCSIDriver({ labelSelector }),
    labelSelector,
    toRow: toCsiDriverRow,
    emit,
    onError,
  })
}

// ---- CSINode ----

export function toCsiNodeRow(n: V1CSINode): CsiNodeRow {
  return {
    ...meta(n),
    drivers: (n.spec?.drivers ?? []).map((d) => ({
      name: d.name,
      nodeID: d.nodeID,
      topologyKeys: d.topologyKeys ?? [],
      allocatable: d.allocatable?.count ?? null,
    })),
  }
}

export function watchCsiNodes(kc: KubeConfig, { labelSelector }: WatchOptions, emit: Emit<CsiNodeRow>, onError: (m: string) => void): () => void {
  const api = kc.makeApiClient(StorageV1Api)
  return watchResource({
    kc,
    path: '/apis/storage.k8s.io/v1/csinodes',
    list: () => api.listCSINode({ labelSelector }),
    labelSelector,
    toRow: toCsiNodeRow,
    emit,
    onError,
  })
}
