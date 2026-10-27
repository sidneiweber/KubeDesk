// Contrato entre main, preload e renderer. Só tipos: nada daqui vai para o
// bundle do renderer, que não pode importar @kubernetes/client-node.

export interface KubeContext {
  name: string
  cluster: string
  namespace: string
  current: boolean
}

export interface KubeconfigInfo {
  /** Arquivo escolhido pelo usuário, ou null para a regra padrão do kubectl. */
  path: string | null
  contexts: KubeContext[]
}

/** Linha da tabela de pods, já calculada no main. */
export interface PodRow {
  uid: string
  name: string
  namespace: string
  status: string
  statusClass: StatusClass
  ready: string
  restarts: number
  node: string
  ip: string
  /** Epoch em ms; a idade é calculada no renderer para poder andar sozinha. */
  created: number
  containers: string[]
}

export type StatusClass = 'running' | 'succeeded' | 'pending' | 'failed' | 'unknown'

/** Lote de mudanças da lista de pods. reset=true: substitua tudo. */
export interface PodBatch {
  reset: boolean
  upsert: PodRow[]
  deleted: string[]
}

export interface LogOptions {
  namespace: string
  pod: string
  container: string
  /** 0 = todas as linhas. */
  tailLines: number
  timestamps: boolean
  follow: boolean
}

/** Função que encerra uma assinatura (watch ou stream). */
export type Unsubscribe = () => void

/** API exposta em window.kube pelo preload. */
export interface KubeApi {
  kubeconfig(): Promise<KubeconfigInfo>
  /** Abre o seletor de arquivo. null se o usuário cancelou. */
  selectKubeconfig(): Promise<KubeconfigInfo | null>
  /** Conecta e devolve os namespaces (vazio se não houver permissão para listar). */
  connect(context: string): Promise<string[]>
  /** namespace "" = todos. */
  watchPods(namespace: string, onBatch: (b: PodBatch) => void, onError: (msg: string) => void): Unsubscribe
  streamLogs(opts: LogOptions, onLines: (lines: string[]) => void, onEnd: (error: string | null) => void): Unsubscribe
}

// Canais IPC. Os de invoke têm argumentos e retorno tipados em Invoke; os de
// evento levam sempre o id da assinatura como primeiro argumento.

export interface Invoke {
  'kubeconfig:get': { args: []; result: KubeconfigInfo }
  'kubeconfig:select': { args: []; result: KubeconfigInfo | null }
  'cluster:connect': { args: [context: string]; result: string[] }
  'pods:watch': { args: [id: string, namespace: string]; result: void }
  'logs:start': { args: [id: string, opts: LogOptions]; result: void }
  'sub:stop': { args: [id: string]; result: void }
}

export interface Events {
  'pods:batch': [id: string, batch: PodBatch]
  'pods:error': [id: string, message: string]
  'logs:lines': [id: string, lines: string[]]
  'logs:end': [id: string, error: string | null]
}
