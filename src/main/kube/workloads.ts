import {
  AppsV1Api,
  BatchV1Api,
  type KubeConfig,
  type KubernetesListObject,
  type KubernetesObject,
  type V1ControllerRevision,
  type V1CronJob,
  type V1DaemonSet,
  type V1Job,
  type V1LabelSelector,
  type V1PodTemplateSpec,
  type V1ReplicaSet,
  type V1StatefulSet,
} from '@kubernetes/client-node'
import type {
  Batch,
  ControllerRevisionRow,
  CronJobRow,
  DaemonSetRow,
  DeploymentCondition,
  JobRow,
  ReplicaSetRow,
  StatefulSetRow,
  StatusClass,
  WatchKind,
  WatchOptions,
  WorkloadBase,
} from '@shared/api'
import { millis } from './meta'
import { collectionPath } from './resources'
import { watchResource } from './watch'

type Status = { status: string; statusClass: StatusClass }

interface Conditionish {
  type: string
  status: string
  reason?: string
  message?: string
  lastTransitionTime?: Date | string
}

/** V1LabelSelector -> "app=web,tier in (a,b),!legacy", como o kubectl aceita. */
export function labelSelectorString(sel: V1LabelSelector | undefined): string {
  if (!sel) return ''
  const parts = Object.entries(sel.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`)
  for (const e of sel.matchExpressions ?? []) {
    const values = (e.values ?? []).join(',')
    switch (e.operator) {
      case 'In':
        parts.push(`${e.key} in (${values})`)
        break
      case 'NotIn':
        parts.push(`${e.key} notin (${values})`)
        break
      case 'Exists':
        parts.push(e.key)
        break
      case 'DoesNotExist':
        parts.push(`!${e.key}`)
        break
    }
  }
  return parts.join(',')
}

/** Campos comuns a todo workload, a partir do objeto e do template de pods. */
export function workloadBase(
  obj: KubernetesObject,
  template: V1PodTemplateSpec | undefined,
  selector: V1LabelSelector | undefined,
  conditions: Conditionish[] | undefined,
  status: Status,
): WorkloadBase {
  const containers = template?.spec?.containers ?? []
  const owner = obj.metadata?.ownerReferences?.find((o) => o.controller) ?? obj.metadata?.ownerReferences?.[0]
  return {
    uid: obj.metadata?.uid ?? '',
    name: obj.metadata?.name ?? '',
    namespace: obj.metadata?.namespace ?? '',
    ...status,
    created: millis(obj.metadata?.creationTimestamp),
    labels: obj.metadata?.labels ?? {},
    annotations: obj.metadata?.annotations ?? {},
    selector: labelSelectorString(selector),
    images: containers.map((c) => c.image ?? ''),
    containers: containers.map((c) => ({
      name: c.name,
      image: c.image ?? '',
      ports: (c.ports ?? []).map((p) => `${p.name ? `${p.name}:` : ''}${p.containerPort}/${p.protocol ?? 'TCP'}`),
      requests: (c.resources?.requests ?? {}) as Record<string, string>,
      limits: (c.resources?.limits ?? {}) as Record<string, string>,
    })),
    conditions: (conditions ?? []).map(
      (c): DeploymentCondition => ({
        type: c.type,
        status: c.status,
        reason: c.reason ?? '',
        message: c.message ?? '',
        lastTransition: millis(c.lastTransitionTime),
      }),
    ),
    owner: owner ? { kind: owner.kind, name: owner.name, uid: owner.uid } : null,
  }
}

// ---- ReplicaSet ----

export function replicaSetStatus(rs: V1ReplicaSet): Status {
  const desired = rs.spec?.replicas ?? 1
  const ready = rs.status?.readyReplicas ?? 0
  const available = rs.status?.availableReplicas ?? 0
  if (desired === 0) return { status: (rs.status?.replicas ?? 0) > 0 ? 'Scaling down' : 'Scaled to 0', statusClass: 'unknown' }
  if (rs.status?.conditions?.some((c) => c.type === 'ReplicaFailure' && c.status === 'True')) return { status: 'ReplicaFailure', statusClass: 'failed' }
  if (available >= desired) return { status: 'Available', statusClass: 'running' }
  if (ready === 0) return { status: 'Unavailable', statusClass: 'failed' }
  return { status: 'Progressing', statusClass: 'pending' }
}

export function toReplicaSetRow(rs: V1ReplicaSet): ReplicaSetRow {
  const ann = rs.metadata?.annotations ?? {}
  return {
    ...workloadBase(rs, rs.spec?.template, rs.spec?.selector, rs.status?.conditions, replicaSetStatus(rs)),
    revision: Number(ann['deployment.kubernetes.io/revision']) || 0,
    changeCause: ann['kubernetes.io/change-cause'] ?? '',
    desired: rs.spec?.replicas ?? 1,
    current: rs.status?.replicas ?? 0,
    ready: rs.status?.readyReplicas ?? 0,
    available: rs.status?.availableReplicas ?? 0,
  }
}

// ---- DaemonSet ----

export function daemonSetStatus(ds: V1DaemonSet): Status {
  const st = ds.status
  const desired = st?.desiredNumberScheduled ?? 0
  const updated = st?.updatedNumberScheduled ?? 0
  const available = st?.numberAvailable ?? 0
  if (desired === 0) return { status: 'Sem nodes', statusClass: 'unknown' }
  const rolling = (ds.metadata?.generation ?? 0) > (st?.observedGeneration ?? 0) || updated < desired
  if (rolling && ds.spec?.updateStrategy?.type !== 'OnDelete') return { status: 'Progressing', statusClass: 'pending' }
  if (available >= desired) return { status: 'Available', statusClass: 'running' }
  if (available === 0) return { status: 'Unavailable', statusClass: 'failed' }
  return { status: 'Degraded', statusClass: 'pending' }
}

export function toDaemonSetRow(ds: V1DaemonSet): DaemonSetRow {
  const st = ds.status
  return {
    ...workloadBase(ds, ds.spec?.template, ds.spec?.selector, st?.conditions, daemonSetStatus(ds)),
    desired: st?.desiredNumberScheduled ?? 0,
    current: st?.currentNumberScheduled ?? 0,
    ready: st?.numberReady ?? 0,
    upToDate: st?.updatedNumberScheduled ?? 0,
    available: st?.numberAvailable ?? 0,
    nodeSelector: Object.entries(ds.spec?.template?.spec?.nodeSelector ?? {}).map(([k, v]) => `${k}=${v}`),
    strategy: ds.spec?.updateStrategy?.type ?? 'RollingUpdate',
  }
}

// ---- StatefulSet ----

export function statefulSetStatus(sts: V1StatefulSet): Status {
  const st = sts.status
  const desired = sts.spec?.replicas ?? 1
  const ready = st?.readyReplicas ?? 0
  const updated = st?.updatedReplicas ?? 0
  if (desired === 0 && (st?.replicas ?? 0) === 0) return { status: 'Scaled to 0', statusClass: 'unknown' }
  const rolling =
    (sts.metadata?.generation ?? 0) > (st?.observedGeneration ?? 0) ||
    (sts.spec?.updateStrategy?.type !== 'OnDelete' && (updated < desired || (!!st?.updateRevision && st.updateRevision !== st.currentRevision))) ||
    (st?.replicas ?? 0) !== desired
  if (rolling) return { status: 'Progressing', statusClass: 'pending' }
  if (ready >= desired) return { status: 'Available', statusClass: 'running' }
  if (ready === 0) return { status: 'Unavailable', statusClass: 'failed' }
  return { status: 'Degraded', statusClass: 'pending' }
}

export function toStatefulSetRow(sts: V1StatefulSet): StatefulSetRow {
  const st = sts.status
  return {
    ...workloadBase(sts, sts.spec?.template, sts.spec?.selector, st?.conditions, statefulSetStatus(sts)),
    desired: sts.spec?.replicas ?? 1,
    current: st?.currentReplicas ?? 0,
    ready: st?.readyReplicas ?? 0,
    upToDate: st?.updatedReplicas ?? 0,
    available: st?.availableReplicas ?? 0,
    serviceName: sts.spec?.serviceName ?? '',
    strategy: sts.spec?.updateStrategy?.type ?? 'RollingUpdate',
    podManagementPolicy: sts.spec?.podManagementPolicy ?? 'OrderedReady',
    volumeClaims: (sts.spec?.volumeClaimTemplates ?? []).map((v) => v.metadata?.name ?? ''),
  }
}

// ---- Job ----

export function jobStatus(job: V1Job): Status {
  const cond = (type: string) => job.status?.conditions?.some((c) => c.type === type && c.status === 'True')
  if (cond('Complete')) return { status: 'Complete', statusClass: 'succeeded' }
  if (cond('Failed')) return { status: 'Failed', statusClass: 'failed' }
  if (job.spec?.suspend) return { status: 'Suspended', statusClass: 'unknown' }
  if ((job.status?.active ?? 0) > 0) return { status: 'Running', statusClass: 'running' }
  return { status: 'Pending', statusClass: 'pending' }
}

export function toJobRow(job: V1Job): JobRow {
  const st = job.status
  return {
    ...workloadBase(job, job.spec?.template, job.spec?.selector, st?.conditions, jobStatus(job)),
    completions: job.spec?.completions ?? null,
    parallelism: job.spec?.parallelism ?? 1,
    active: st?.active ?? 0,
    succeeded: st?.succeeded ?? 0,
    failed: st?.failed ?? 0,
    backoffLimit: job.spec?.backoffLimit ?? 6,
    suspended: job.spec?.suspend ?? false,
    startTime: millis(st?.startTime),
    completionTime: millis(st?.completionTime),
  }
}

// ---- CronJob ----

export function cronJobStatus(cj: V1CronJob): Status {
  if (cj.spec?.suspend) return { status: 'Suspended', statusClass: 'unknown' }
  if ((cj.status?.active?.length ?? 0) > 0) return { status: 'Active', statusClass: 'running' }
  return { status: 'Scheduled', statusClass: 'succeeded' }
}

export function toCronJobRow(cj: V1CronJob): CronJobRow {
  const spec = cj.spec
  return {
    // CronJob não tem seletor: os pods são dos Jobs que ele cria
    ...workloadBase(cj, spec?.jobTemplate?.spec?.template, undefined, undefined, cronJobStatus(cj)),
    schedule: spec?.schedule ?? '',
    timeZone: spec?.timeZone ?? '',
    suspended: spec?.suspend ?? false,
    concurrencyPolicy: spec?.concurrencyPolicy ?? 'Allow',
    active: cj.status?.active?.length ?? 0,
    lastSchedule: millis(cj.status?.lastScheduleTime),
    lastSuccessful: millis(cj.status?.lastSuccessfulTime),
    successfulJobsHistoryLimit: spec?.successfulJobsHistoryLimit ?? 3,
    failedJobsHistoryLimit: spec?.failedJobsHistoryLimit ?? 1,
  }
}

// ---- ControllerRevision (histórico de DaemonSet e StatefulSet) ----

/** Imagens guardadas na revisão; `data` é o patch com o template inteiro. */
export function revisionImages(cr: V1ControllerRevision): string[] {
  const data = cr.data as { spec?: { template?: V1PodTemplateSpec } } | undefined
  return (data?.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? '')
}

export function toControllerRevisionRow(cr: V1ControllerRevision): ControllerRevisionRow {
  const owner = cr.metadata?.ownerReferences?.find((o) => o.controller)
  return {
    uid: cr.metadata?.uid ?? '',
    name: cr.metadata?.name ?? '',
    namespace: cr.metadata?.namespace ?? '',
    ownerUid: owner?.uid ?? '',
    revision: cr.revision,
    images: revisionImages(cr),
    created: millis(cr.metadata?.creationTimestamp),
  }
}

// ---- Watchers ----

type Watcher<R> = (kc: KubeConfig, opts: WatchOptions, emit: (b: Batch<R>) => void, onError: (m: string) => void) => () => void

function watcher<T extends KubernetesObject, R>(
  kind: WatchKind,
  list: (kc: KubeConfig, namespace: string, labelSelector?: string) => Promise<KubernetesListObject<T>>,
  toRow: (obj: T) => R,
): Watcher<R> {
  return (kc, { namespace, labelSelector }, emit, onError) =>
    watchResource({
      kc,
      path: collectionPath(kind, namespace),
      list: () => list(kc, namespace, labelSelector),
      labelSelector,
      toRow,
      emit,
      onError,
    })
}

const apps = (kc: KubeConfig) => kc.makeApiClient(AppsV1Api)
const batch = (kc: KubeConfig) => kc.makeApiClient(BatchV1Api)

export const watchReplicaSets = watcher('replicasets', (kc, namespace, labelSelector) =>
  namespace ? apps(kc).listNamespacedReplicaSet({ namespace, labelSelector }) : apps(kc).listReplicaSetForAllNamespaces({ labelSelector }),
  toReplicaSetRow)

export const watchDaemonSets = watcher('daemonsets', (kc, namespace, labelSelector) =>
  namespace ? apps(kc).listNamespacedDaemonSet({ namespace, labelSelector }) : apps(kc).listDaemonSetForAllNamespaces({ labelSelector }),
  toDaemonSetRow)

export const watchStatefulSets = watcher('statefulsets', (kc, namespace, labelSelector) =>
  namespace ? apps(kc).listNamespacedStatefulSet({ namespace, labelSelector }) : apps(kc).listStatefulSetForAllNamespaces({ labelSelector }),
  toStatefulSetRow)

export const watchControllerRevisions = watcher('controllerrevisions', (kc, namespace, labelSelector) =>
  namespace
    ? apps(kc).listNamespacedControllerRevision({ namespace, labelSelector })
    : apps(kc).listControllerRevisionForAllNamespaces({ labelSelector }),
  toControllerRevisionRow)

export const watchJobs = watcher('jobs', (kc, namespace, labelSelector) =>
  namespace ? batch(kc).listNamespacedJob({ namespace, labelSelector }) : batch(kc).listJobForAllNamespaces({ labelSelector }),
  toJobRow)

export const watchCronJobs = watcher('cronjobs', (kc, namespace, labelSelector) =>
  namespace ? batch(kc).listNamespacedCronJob({ namespace, labelSelector }) : batch(kc).listCronJobForAllNamespaces({ labelSelector }),
  toCronJobRow)
