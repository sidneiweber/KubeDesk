import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from 'electron'
import type { KubeConfig } from '@kubernetes/client-node'
import type { Batch, Events, Invoke, KubeconfigInfo, WatchKind, WatchOptions, WatchRows } from '@shared/api'
import { connect, listContexts, loadKubeconfig } from './kube/connection'
import { restartDeployment, scaleDeployment, watchDeployments } from './kube/deployments'
import { watchEndpointSlices } from './kube/endpointSlices'
import { watchIngresses } from './kube/ingresses'
import { watchNamespaces } from './kube/namespaces'
import { watchServices } from './kube/services'
import { errorMessage } from './kube/errors'
import { streamLogs } from './kube/logs'
import { watchPods } from './kube/pods'
import { resourceYaml } from './kube/yaml'
import { PrefsStore } from './prefs'

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

type Watcher<K extends WatchKind> = (
  kc: KubeConfig,
  opts: WatchOptions,
  emit: (b: Batch<WatchRows[K]>) => void,
  onError: (message: string) => void,
) => () => void

// Um watcher por recurso; uma tela nova entra aqui e em WatchRows
const watchers: { [K in WatchKind]: Watcher<K> } = {
  pods: watchPods,
  deployments: watchDeployments,
  namespaces: watchNamespaces,
  services: watchServices,
  ingresses: watchIngresses,
  endpointslices: watchEndpointSlices,
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
  const prefs = PrefsStore.inDir(app.getPath('userData'))
  handle('prefs:get', (_, key) => prefs.get(key))
  handle('prefs:set', (_, key, value) => prefs.set(key, value))

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

  handle('watch:start', (event, id, kind, opts) => {
    const watcher = watchers[kind] as Watcher<WatchKind> | undefined
    if (!watcher) throw new Error(`Recurso desconhecido: ${kind}`)
    const target = event.sender
    subscribe(
      id,
      watcher(
        requireCluster(),
        opts,
        (batch) => send(target, 'watch:batch', id, batch),
        (message) => send(target, 'watch:error', id, message),
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

  handle('deployment:scale', (_, namespace, name, replicas) => scaleDeployment(requireCluster(), namespace, name, replicas))
  handle('deployment:restart', (_, namespace, name) => restartDeployment(requireCluster(), namespace, name))

  handle('resource:yaml', (_, kind, namespace, name, managedFields) =>
    resourceYaml(requireCluster(), kind, namespace, name, managedFields))

  handle('file:save', async (event, defaultName, content) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Salvar', defaultPath: defaultName }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })

  handle('sub:stop', (_, id) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  })
}
