import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from 'electron'
import type { KubeConfig } from '@kubernetes/client-node'
import type { Events, Invoke, KubeconfigInfo } from '@shared/api'
import { connect, listContexts, loadKubeconfig } from './kube/connection'
import { errorMessage } from './kube/errors'
import { streamLogs } from './kube/logs'
import { watchPods } from './kube/pods'

// Estado da sessão. Uma janela só, então um cluster ativo por vez.
let kubeconfigPath: string | null = null
let kc: KubeConfig | null = null
const subscriptions = new Map<string, () => void>()

function handle<K extends keyof Invoke>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, ...args: Invoke[K]['args']) => Promise<Invoke[K]['result']> | Invoke[K]['result'],
): void {
  ipcMain.handle(channel, (event, ...args) => fn(event, ...(args as Invoke[K]['args'])))
}

function send<K extends keyof Events>(target: WebContents, channel: K, ...args: Events[K]): void {
  if (!target.isDestroyed()) target.send(channel, ...args)
}

function requireCluster(): KubeConfig {
  if (!kc) throw new Error('Nenhum cluster conectado')
  return kc
}

function subscribe(id: string, stop: () => void): void {
  subscriptions.get(id)?.()
  subscriptions.set(id, stop)
}

export function stopAll(): void {
  for (const stop of subscriptions.values()) stop()
  subscriptions.clear()
}

function kubeconfigInfo(): KubeconfigInfo {
  return { path: kubeconfigPath, contexts: listContexts(loadKubeconfig(kubeconfigPath)) }
}

export function registerIpc(): void {
  handle('kubeconfig:get', () => {
    try {
      return kubeconfigInfo()
    } catch (err) {
      throw new Error(`Erro ao ler o kubeconfig: ${errorMessage(err)}`)
    }
  })

  handle('kubeconfig:select', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = { title: 'Selecionar kubeconfig', properties: ['openFile', 'showHiddenFiles'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null

    const previous = kubeconfigPath
    kubeconfigPath = result.filePaths[0]
    try {
      return kubeconfigInfo()
    } catch (err) {
      kubeconfigPath = previous
      throw new Error(`Arquivo inválido: ${errorMessage(err)}`)
    }
  })

  handle('cluster:connect', async (_, context) => {
    stopAll()
    kc = null
    const result = await connect(kubeconfigPath, context)
    kc = result.kc
    return result.namespaces
  })

  handle('pods:watch', (event, id, namespace) => {
    const target = event.sender
    subscribe(
      id,
      watchPods(
        requireCluster(),
        namespace,
        (batch) => send(target, 'pods:batch', id, batch),
        (message) => send(target, 'pods:error', id, message),
      ),
    )
  })

  handle('logs:start', (event, id, opts) => {
    const target = event.sender
    subscribe(
      id,
      streamLogs(
        requireCluster(),
        opts,
        (lines) => send(target, 'logs:lines', id, lines),
        (error) => {
          subscriptions.delete(id)
          send(target, 'logs:end', id, error)
        },
      ),
    )
  })

  handle('sub:stop', (_, id) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  })
}
