import type { KubeConfig, V1ControllerRevision, V1CronJob, V1Job, V1ReplicaSet } from '@kubernetes/client-node'
import type { RolloutKind, ScalableKind, WatchKind } from '@shared/api'
import { rollbackTemplate } from './deployments'
import { errorMessage } from './errors'
import { apiGet, apiPatch, apiPost } from './http'
import { collectionPath, objectPath } from './resources'
import { labelSelectorString } from './workloads'

// Ações sobre workloads, pela API direto (mesma autenticação da client-node):
// um caminho só para Deployment, StatefulSet, DaemonSet etc., em vez de um
// método diferente da client-node para cada tipo.

const MERGE = 'application/merge-patch+json'
const STRATEGIC = 'application/strategic-merge-patch+json'
const JSON_PATCH = 'application/json-patch+json'

interface Workload {
  metadata?: { uid?: string; name?: string }
  spec?: { paused?: boolean; selector?: Parameters<typeof labelSelectorString>[0] }
}

async function getObject<T>(kc: KubeConfig, kind: WatchKind, namespace: string, name: string): Promise<T> {
  return (await (await apiGet(kc, objectPath(kind, namespace, name))).json()) as T
}

async function listObjects<T>(kc: KubeConfig, kind: WatchKind, namespace: string, labelSelector: string): Promise<T[]> {
  const res = await apiGet(kc, collectionPath(kind, namespace), labelSelector ? { labelSelector } : {})
  return ((await res.json()) as { items?: T[] }).items ?? []
}

export async function scaleWorkload(kc: KubeConfig, kind: ScalableKind, namespace: string, name: string, replicas: number): Promise<void> {
  if (!Number.isInteger(replicas) || replicas < 0) throw new Error(`Número de réplicas inválido: ${replicas}`)
  try {
    await apiPatch(kc, `${objectPath(kind, namespace, name)}/scale`, { spec: { replicas } }, MERGE)
  } catch (err) {
    throw new Error(`Erro ao escalar ${name}: ${errorMessage(err)}`)
  }
}

/** Mesmo efeito de `kubectl rollout restart`: muda uma anotação do template. */
export async function restartWorkload(kc: KubeConfig, kind: RolloutKind, namespace: string, name: string): Promise<void> {
  try {
    // Como o kubectl: num deployment pausado a anotação mudaria sem efeito nenhum
    const current = await getObject<Workload>(kc, kind, namespace, name)
    if (current.spec?.paused) throw new Error('está pausado; retome o rollout antes de reiniciar')

    const restartedAt = new Date().toISOString()
    await apiPatch(
      kc,
      objectPath(kind, namespace, name),
      { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': restartedAt } } } } },
      STRATEGIC,
    )
  } catch (err) {
    throw new Error(`Erro ao reiniciar ${name}: ${errorMessage(err)}`)
  }
}

/** Mesmo efeito de `kubectl rollout undo --to-revision=N`. */
export async function rollbackWorkload(kc: KubeConfig, kind: RolloutKind, namespace: string, name: string, revision: number): Promise<void> {
  try {
    const current = await getObject<Workload>(kc, kind, namespace, name)
    if (current.spec?.paused) throw new Error('está pausado; retome o rollout antes de voltar uma revisão')
    const uid = current.metadata?.uid
    const selector = labelSelectorString(current.spec?.selector)
    const owned = (o: { metadata?: { ownerReferences?: { uid: string }[] } }) => !!o.metadata?.ownerReferences?.some((r) => r.uid === uid)

    if (kind === 'deployments') {
      // Deployment: a revisão é um ReplicaSet; volta o template dele
      const sets = await listObjects<V1ReplicaSet>(kc, 'replicasets', namespace, selector)
      const rs = sets.find((r) => owned(r) && Number(r.metadata?.annotations?.['deployment.kubernetes.io/revision']) === revision)
      if (!rs) throw new Error(`revisão ${revision} não encontrada`)
      await apiPatch(kc, objectPath(kind, namespace, name), [{ op: 'replace', path: '/spec/template', value: rollbackTemplate(rs) }], JSON_PATCH)
    } else {
      // DaemonSet/StatefulSet: a revisão guarda um patch pronto com o template
      const revs = await listObjects<V1ControllerRevision>(kc, 'controllerrevisions', namespace, selector)
      const cr = revs.find((r) => owned(r) && r.revision === revision)
      if (!cr) throw new Error(`revisão ${revision} não encontrada`)
      await apiPatch(kc, objectPath(kind, namespace, name), cr.data, STRATEGIC)
    }
  } catch (err) {
    throw new Error(`Erro ao voltar ${name} para a revisão ${revision}: ${errorMessage(err)}`)
  }
}

export async function suspendCronJob(kc: KubeConfig, namespace: string, name: string, suspend: boolean): Promise<void> {
  try {
    await apiPatch(kc, objectPath('cronjobs', namespace, name), { spec: { suspend } }, MERGE)
  } catch (err) {
    throw new Error(`Erro ao ${suspend ? 'pausar' : 'retomar'} ${name}: ${errorMessage(err)}`)
  }
}

/**
 * Job que o `kubectl create job --from=cronjob/x` criaria: o jobTemplate,
 * com o CronJob como dono (aparece nos Jobs dele e é limpo junto).
 */
export function jobFromCronJob(cj: V1CronJob, now: number): V1Job {
  const name = cj.metadata?.name ?? 'job'
  // Nome de Job vira label (job-name): até 63 caracteres
  const suffix = `-manual-${now.toString(36).slice(-6)}`
  const tmpl = cj.spec?.jobTemplate
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: name.slice(0, 63 - suffix.length) + suffix,
      namespace: cj.metadata?.namespace,
      labels: { ...(tmpl?.metadata?.labels ?? {}) },
      annotations: { ...(tmpl?.metadata?.annotations ?? {}), 'cronjob.kubernetes.io/instantiate': 'manual' },
      ownerReferences: [
        { apiVersion: 'batch/v1', kind: 'CronJob', name, uid: cj.metadata?.uid ?? '', controller: true, blockOwnerDeletion: true },
      ],
    },
    spec: structuredClone(tmpl?.spec),
  }
}

export async function triggerCronJob(kc: KubeConfig, namespace: string, name: string): Promise<string> {
  try {
    const cj = await getObject<V1CronJob>(kc, 'cronjobs', namespace, name)
    const job = jobFromCronJob(cj, Date.now())
    await apiPost(kc, collectionPath('jobs', namespace), job)
    return job.metadata?.name ?? ''
  } catch (err) {
    throw new Error(`Erro ao disparar ${name}: ${errorMessage(err)}`)
  }
}
