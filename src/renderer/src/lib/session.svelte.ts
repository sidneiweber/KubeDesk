import type { KubeContext } from '@shared/api'

// Namespace escolhido por contexto, como o app antigo fazia. Fica nas
// preferências do main (não no localStorage, que pode perder a última
// gravação). Se falhar, cai no namespace do kubeconfig.
const nsKey = (context: string) => `namespace:${context}`

async function loadNamespace(context: string): Promise<string | null> {
  try {
    const v = await window.kube.getPref(nsKey(context))
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

export function saveNamespace(context: string, namespace: string): void {
  window.kube.setPref(nsKey(context), namespace).catch(() => {
    // sem gravar, sem lembrança: não vale interromper o usuário por isso
  })
}

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
    // Vale "" (todos) ou um namespace que existe. Sem permissão para listar
    // namespaces a lista vem vazia, e aí qualquer nome vale
    const usable = (ns: string) => ns === '' || this.namespaces.length === 0 || this.namespaces.includes(ns)
    const remembered = await loadNamespace(name)
    const fromContext = this.contexts.find((c) => c.name === name)?.namespace ?? 'default'
    this.namespace = remembered !== null && usable(remembered) ? remembered : usable(fromContext) ? fromContext : ''
    this.context = name
  }

  disconnect(): void {
    this.context = null
  }
}

export const session = new Session()
