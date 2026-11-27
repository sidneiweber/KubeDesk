import type { HpaRow } from '@shared/api'

/** Coluna TARGETS do kubectl: "cpu: 45%/80%, memory: 200Mi/1Gi". */
export function metricsText(h: HpaRow): string {
  return h.metrics.map((m) => `${m.name}: ${m.current}/${m.target}`).join(', ') || '<none>'
}
