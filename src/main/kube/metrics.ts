import type { KubeConfig } from '@kubernetes/client-node'
import type { MetricsUpdate, PodUsage } from '@shared/api'
import { errorMessage } from './errors'
import { apiGet } from './http'
import { cpuMillicores, memoryBytes } from './quantity'
import { resourcePath } from './watch'

// O metrics-server coleta a cada ~15s por padrão: ler mais rápido que isso
// só repete o mesmo número. Sem ele, tenta de novo de vez em quando, caso
// seja instalado com o app aberto.
const POLL_MS = 15_000
const RETRY_UNAVAILABLE_MS = 60_000

interface PodMetricsList {
  items: { metadata: { name: string; namespace: string }; timestamp?: string; containers: { name: string; usage: { cpu?: string; memory?: string } }[] }[]
}

/** Soma o uso dos containers de cada pod. */
export function toPodUsage(list: PodMetricsList): PodUsage[] {
  return list.items.map((p) => {
    const containers = p.containers.map((c) => ({
      name: c.name,
      cpu: cpuMillicores(c.usage.cpu) ?? 0,
      memory: memoryBytes(c.usage.memory) ?? 0,
    }))
    return {
      key: `${p.metadata.namespace}/${p.metadata.name}`,
      cpu: containers.reduce((a, c) => a + c.cpu, 0),
      memory: containers.reduce((a, c) => a + c.memory, 0),
      containers,
    }
  })
}

/** Motivo legível de a API de métricas não responder. */
export function unavailableReason(err: unknown): string {
  const code = (err as { code?: number })?.code
  if (code === 404 || code === 503) return 'metrics-server não encontrado no cluster (API metrics.k8s.io indisponível)'
  if (code === 403) return 'sem permissão para ler métricas (metrics.k8s.io)'
  return errorMessage(err)
}

/**
 * Lê o uso de CPU/memória dos pods de um namespace ("" = todos), uma
 * listagem por vez, e entrega cada leitura. Sem metrics-server, entrega
 * available: false com o motivo: a UI mostra N/D, nunca um número inventado.
 */
export function watchPodMetrics(kc: KubeConfig, namespace: string, emit: (u: MetricsUpdate) => void): () => void {
  const path = resourcePath('/apis/metrics.k8s.io/v1beta1', 'pods', namespace)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const poll = async () => {
    let next = POLL_MS
    try {
      const res = await apiGet(kc, path, {}, controller.signal)
      const list = (await res.json()) as PodMetricsList
      if (!stopped) emit({ available: true, reason: '', items: toPodUsage(list), timestamp: Date.now() })
    } catch (err) {
      if (stopped) return
      next = RETRY_UNAVAILABLE_MS
      emit({ available: false, reason: unavailableReason(err), items: [], timestamp: Date.now() })
    }
    if (!stopped) timer = setTimeout(poll, next)
  }
  void poll()

  return () => {
    stopped = true
    clearTimeout(timer)
    controller.abort()
  }
}
