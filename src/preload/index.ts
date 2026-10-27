import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Events, Invoke, KubeApi, Unsubscribe } from '@shared/api'

// Única ponte entre a página e o Node. O renderer roda com contextIsolation e
// sandbox: não vê ipcRenderer, require nem process, só o que está aqui.

function invoke<K extends keyof Invoke>(channel: K, ...args: Invoke[K]['args']): Promise<Invoke[K]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

function on<K extends keyof Events>(channel: K, id: string, cb: (...args: DropFirst<Events[K]>) => void): () => void {
  const listener = (_: IpcRendererEvent, eventId: string, ...rest: DropFirst<Events[K]>) => {
    if (eventId === id) cb(...rest)
  }
  ipcRenderer.on(channel, listener as never)
  return () => ipcRenderer.removeListener(channel, listener as never)
}

type DropFirst<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never

// Assinatura com id escolhido aqui. Os listeners são registrados *antes* de
// pedir ao main para começar: se o id viesse na resposta do invoke, o primeiro
// lote poderia chegar quando ninguém estivesse ouvindo.
function subscribe(start: (id: string) => Promise<void>, listen: (id: string) => Array<() => void>, onFail: (msg: string) => void): Unsubscribe {
  const id = crypto.randomUUID()
  const offs = listen(id)
  let stopped = false

  start(id).catch((e: Error) => {
    if (!stopped) onFail(cleanError(e))
  })

  return () => {
    if (stopped) return
    stopped = true
    offs.forEach((off) => off())
    void invoke('sub:stop', id)
  }
}

// O Electron embrulha erros de invoke em "Error invoking remote method 'x': Error: ..."
function cleanError(e: Error): string {
  return e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const api: KubeApi = {
  kubeconfig: () => invoke('kubeconfig:get'),
  selectKubeconfig: () => invoke('kubeconfig:select'),
  connect: (context) => invoke('cluster:connect', context).catch((e: Error) => Promise.reject(new Error(cleanError(e)))),

  watchPods: (namespace, onBatch, onError) =>
    subscribe(
      (id) => invoke('pods:watch', id, namespace),
      (id) => [on('pods:batch', id, onBatch), on('pods:error', id, onError)],
      onError,
    ),

  streamLogs: (opts, onLines, onEnd) =>
    subscribe(
      (id) => invoke('logs:start', id, opts),
      (id) => [on('logs:lines', id, onLines), on('logs:end', id, onEnd)],
      onEnd,
    ),
}

contextBridge.exposeInMainWorld('kube', api)
