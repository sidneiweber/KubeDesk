import type { EndpointSliceRow, StatusClass } from '@shared/api'

// Um service pode ter vários EndpointSlices (um por família de IP, ou mais
// de um quando passa de 100 endpoints). Quem olha a tela pensa por service,
// então os slices são agrupados aqui.

export interface EndpointView {
  address: string
  ports: string[]
  state: 'ready' | 'notReady' | 'terminating'
  pod: string
  node: string
}

export interface ServiceEndpoints {
  /** namespace/service, estável entre lotes. */
  uid: string
  service: string
  namespace: string
  /** "ip:porta" prontos, como a coluna ENDPOINTS do kubectl. */
  ready: string[]
  notReady: number
  endpoints: EndpointView[]
  slices: number
  created: number
  status: string
  statusClass: StatusClass
}

function status(ready: number, notReady: number): { status: string; statusClass: StatusClass } {
  if (ready === 0 && notReady === 0) return { status: 'Sem endpoints', statusClass: 'unknown' }
  if (ready === 0) return { status: 'Nenhum pronto', statusClass: 'failed' }
  if (notReady > 0) return { status: 'Parcial', statusClass: 'pending' }
  return { status: 'Prontos', statusClass: 'running' }
}

export function groupEndpointSlices(slices: readonly EndpointSliceRow[]): ServiceEndpoints[] {
  const groups = new Map<string, EndpointSliceRow[]>()
  for (const s of slices) {
    // Slice criado à mão, sem o label de service: vira um grupo próprio
    const key = `${s.namespace}/${s.service || s.name}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }

  return [...groups.entries()].map(([uid, group]) => {
    const ready = new Set<string>()
    const endpoints = new Map<string, EndpointView>()

    for (const s of group) {
      const ports = s.ports.map((p) => `${p.port}/${p.protocol}`)
      for (const e of s.endpoints) {
        const state = e.terminating ? 'terminating' : e.ready ? 'ready' : 'notReady'
        for (const address of e.addresses) {
          endpoints.set(address, { address, ports, state, pod: e.pod, node: e.node })
          if (state === 'ready') {
            if (s.ports.length === 0) ready.add(address)
            for (const p of s.ports) ready.add(`${address}:${p.port}`)
          }
        }
      }
    }

    const all = [...endpoints.values()].sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
    const notReady = all.filter((e) => e.state !== 'ready').length
    const readyCount = all.length - notReady
    return {
      uid,
      service: group[0].service || group[0].name,
      namespace: group[0].namespace,
      ready: [...ready].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      notReady,
      endpoints: all,
      slices: group.length,
      created: Math.min(...group.map((s) => s.created || Infinity)) || 0,
      ...status(readyCount, notReady),
    }
  })
}
