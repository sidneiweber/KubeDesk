import type { KubeApi } from '../shared/api'

declare global {
  interface Window {
    kube: KubeApi
  }
}

export {}
