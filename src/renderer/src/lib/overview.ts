import type { StatusClass } from '@shared/api'
import type { Section } from './nav.svelte'
import { readyFraction } from './sort'

// Resumo de saúde para a página Overview. Funções puras: a página só junta
// as listas ao vivo e desenha.

export type Health = 'ok' | 'warn' | 'bad' | 'empty'

export interface Tally {
  total: number
  ok: number
  pending: number
  failed: number
  /** Concluídos (Jobs, pods Completed) e desconhecidos: não pesam na saúde. */
  other: number
  health: Health
}

/** O que importa de cada linha para o resumo. */
export interface Item {
  uid: string
  namespace: string
  name: string
  status: string
  statusClass: StatusClass
}

/**
 * Pod "Running" com container não pronto (readiness falhando) conta como
 * pendente: para quem olha o cluster, ele ainda não está servindo.
 */
export function podClass(p: { status: string; statusClass: StatusClass; ready: string }): StatusClass {
  if (p.statusClass === 'running' && readyFraction(p.ready) < 1) return 'pending'
  return p.statusClass
}

export function tally(items: readonly { statusClass: StatusClass }[]): Tally {
  const t = { total: items.length, ok: 0, pending: 0, failed: 0, other: 0 }
  for (const i of items) {
    if (i.statusClass === 'running') t.ok++
    else if (i.statusClass === 'pending') t.pending++
    else if (i.statusClass === 'failed') t.failed++
    else t.other++
  }
  const health: Health = t.total === 0 ? 'empty' : t.failed > 0 ? 'bad' : t.pending > 0 ? 'warn' : 'ok'
  return { ...t, health }
}

export interface Problem extends Item {
  kind: string
  section: Section
}

/** Recursos com falha ou pendentes, falhas primeiro e depois por nome. */
export function problems(groups: { kind: string; section: Section; items: readonly Item[] }[]): Problem[] {
  const out: Problem[] = []
  for (const g of groups) {
    for (const i of g.items) {
      if (i.statusClass === 'failed' || i.statusClass === 'pending') out.push({ ...i, kind: g.kind, section: g.section })
    }
  }
  const rank = (p: Problem) => (p.statusClass === 'failed' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

// Kind do involvedObject de um evento -> seção do app
const KIND_SECTION: Record<string, Section> = {
  Pod: 'pods',
  Deployment: 'deployments',
  ReplicaSet: 'replicasets',
  DaemonSet: 'daemonsets',
  StatefulSet: 'statefulsets',
  Job: 'jobs',
  CronJob: 'cronjobs',
  Service: 'services',
  Ingress: 'ingresses',
  ConfigMap: 'configmaps',
  Secret: 'secrets',
  HorizontalPodAutoscaler: 'hpas',
  PersistentVolumeClaim: 'pvcs',
  PersistentVolume: 'pvs',
}

/** "Pod/web-1" -> onde abrir, ou null se o app não tem tela para o tipo. */
export function eventTarget(object: string): { section: Section; name: string } | null {
  const i = object.indexOf('/')
  const section = KIND_SECTION[object.slice(0, i)]
  return section ? { section, name: object.slice(i + 1) } : null
}
