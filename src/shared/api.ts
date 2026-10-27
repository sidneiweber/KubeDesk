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

export interface DeploymentCondition {
  type: string
  status: string
  reason: string
  message: string
  lastTransition: number
}

export interface ContainerSpec {
  name: string
  image: string
  ports: string[]
  requests: Record<string, string>
  limits: Record<string, string>
}

/**
 * Linha da tabela de deployments. Leva também o que o painel de detalhes
 * mostra: são poucos objetos, e assim os detalhes ficam ao vivo de graça.
 */
export interface DeploymentRow {
  uid: string
  name: string
  namespace: string
  status: string
  statusClass: StatusClass
  desired: number
  ready: number
  upToDate: number
  available: number
  created: number
  images: string[]
  strategy: string
  paused: boolean
  revision: string
  /** Seletor no formato de label selector ("app=web,tier in (a,b)"). */
  selector: string
  labels: Record<string, string>
  conditions: DeploymentCondition[]
  containers: ContainerSpec[]
}

/** Lote de mudanças de uma lista. reset=true: substitua tudo. */
export interface Batch<R> {
  reset: boolean
  upsert: R[]
  /** UIDs. */
  deleted: string[]
}

/** Tipo de linha de cada recurso observável. */
export interface WatchRows {
  pods: PodRow
  deployments: DeploymentRow
}
export type WatchKind = keyof WatchRows

export interface WatchOptions {
  /** "" = todos. */
  namespace: string
  labelSelector?: string
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
  /** Observa uma lista. O primeiro lote (reset) é a lista completa. */
  watch<K extends WatchKind>(
    kind: K,
    opts: WatchOptions,
    onBatch: (b: Batch<WatchRows[K]>) => void,
    onError: (msg: string) => void,
  ): Unsubscribe
  streamLogs(opts: LogOptions, onLines: (lines: string[]) => void, onEnd: (error: string | null) => void): Unsubscribe
  scaleDeployment(namespace: string, name: string, replicas: number): Promise<void>
  /** Equivale a `kubectl rollout restart`. */
  restartDeployment(namespace: string, name: string): Promise<void>
}

// Canais IPC. Os de invoke têm argumentos e retorno tipados em Invoke; os de
// evento levam sempre o id da assinatura como primeiro argumento.

export interface Invoke {
  'kubeconfig:get': { args: []; result: KubeconfigInfo }
  'kubeconfig:select': { args: []; result: KubeconfigInfo | null }
  'cluster:connect': { args: [context: string]; result: string[] }
  'watch:start': { args: [id: string, kind: WatchKind, opts: WatchOptions]; result: void }
  'logs:start': { args: [id: string, opts: LogOptions]; result: void }
  'sub:stop': { args: [id: string]; result: void }
  'deployment:scale': { args: [namespace: string, name: string, replicas: number]; result: void }
  'deployment:restart': { args: [namespace: string, name: string]; result: void }
}

export interface Events {
  'watch:batch': [id: string, batch: Batch<WatchRows[WatchKind]>]
  'watch:error': [id: string, message: string]
  'logs:lines': [id: string, lines: string[]]
  'logs:end': [id: string, error: string | null]
}
