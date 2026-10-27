import type { KubeContext } from '@shared/api'

// Estado da conexão, compartilhado pelas telas. Substitui as variáveis
// globais soltas no topo do renderer.js antigo.

class Session {
  /** null = regra padrão do kubectl ($KUBECONFIG ou ~/.kube/config). */
  kubeconfigPath = $state<string | null>(null)
  contexts = $state<KubeContext[]>([])
  /** Contexto conectado; null enquanto está na tela de conexão. */
  context = $state<string | null>(null)
  namespaces = $state<string[]>([])
  /** "" = todos os namespaces. */
  namespace = $state('')

  async loadKubeconfig(): Promise<void> {
    const info = await window.kube.kubeconfig()
    this.kubeconfigPath = info.path
    this.contexts = info.contexts
  }

  /** false se o usuário cancelou o seletor. */
  async selectKubeconfig(): Promise<boolean> {
    const info = await window.kube.selectKubeconfig()
    if (!info) return false
    this.kubeconfigPath = info.path
    this.contexts = info.contexts
    return true
  }

  async connect(name: string): Promise<void> {
    this.namespaces = await window.kube.connect(name)
    const preferred = this.contexts.find((c) => c.name === name)?.namespace ?? 'default'
    // Sem permissão para listar namespaces a lista vem vazia: fica o do contexto
    this.namespace = this.namespaces.length === 0 || this.namespaces.includes(preferred) ? preferred : ''
    this.context = name
  }

  disconnect(): void {
    this.context = null
  }
}

export const session = new Session()
