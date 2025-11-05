import { app, BrowserWindow, ipcMain, dialog, Menu, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import { getPodLogs, streamPodLogs, stopLogStream } from './main/services/LogService';
import DeploymentService from './main/services/DeploymentService';
import { DeploymentSummary, PodSummary } from './main/services/types';

let mainWindow: BrowserWindow | null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../assets/icon-square.png'),
    titleBarStyle: 'default',
    show: false,
    title: 'KubeDesk'
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow!.maximize();
    mainWindow!.show();
  });

  mainWindow.loadFile('src/renderer/index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  if (process.platform === 'linux') {
    app.setAppUserModelId('kubedesk');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('get-kubeconfig-path', () => {
  const homeDir = os.homedir();
  const defaultPath = path.join(homeDir, '.kube', 'config');
  return defaultPath;
});

ipcMain.handle('load-kubeconfig', async (event: IpcMainInvokeEvent, configPath: string) => {
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const kubeConfig: any = yaml.load(configContent);

    const clusters = kubeConfig.clusters.map((cluster: any) => ({
      name: cluster.name,
      server: cluster.cluster.server,
    }));

    const contexts = kubeConfig.contexts.map((context: any) => ({
      name: context.name,
      cluster: context.context.cluster,
      user: context.context.user,
      namespace: context.context.namespace || 'default'
    }));

    return {
      clusters,
      contexts,
      currentContext: kubeConfig['current-context']
    };
  } catch (error: any) {
    throw new Error(`Erro ao carregar kubeconfig: ${error.message}`);
  }
});

ipcMain.handle('select-kubeconfig-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar arquivo kubeconfig',
    filters: [
      { name: 'Kubernetes Config', extensions: ['yml', 'yaml', 'config'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

const activeConfigs = new Map<string, k8s.KubeConfig>();

ipcMain.handle('connect-to-cluster', async (event: IpcMainInvokeEvent, configPath: string, contextName: string) => {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromFile(configPath);
    kc.setCurrentContext(contextName);

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    await k8sApi.listNamespace();

    const connectionId = `${contextName}-${Date.now()}`;
    activeConfigs.set(connectionId, kc);

    return {
      connected: true,
      context: contextName,
      connectionId: connectionId
    };
  } catch (error: any) {
    throw new Error(`Erro ao conectar ao cluster: ${error.message}`);
  }
});

ipcMain.handle('get-pods', async (event: IpcMainInvokeEvent, connectionId: string, namespace = 'default') => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = namespace === 'all'
        ? await k8sApi.listPodForAllNamespaces()
        : await k8sApi.listNamespacedPod(namespace);

    return response.body.items.map((pod: k8s.V1Pod) => ({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
        status: pod.status?.phase,
        ready: `${pod.status?.containerStatuses?.filter(c => c.ready).length || 0}/${pod.spec?.containers.length || 0}`,
        restarts: pod.status?.containerStatuses?.reduce((sum, c) => sum + c.restartCount, 0) || 0,
        age: calculateAge(pod.metadata?.creationTimestamp),
        node: pod.spec?.nodeName,
        ip: pod.status?.podIP,
    }));
});

ipcMain.handle('get-namespaces', async (event: IpcMainInvokeEvent, connectionId: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.listNamespace();

    return response.body.items.map((ns: k8s.V1Namespace) => ({
        name: ns.metadata?.name,
        status: ns.status?.phase,
        age: calculateAge(ns.metadata?.creationTimestamp),
    }));
});

ipcMain.handle('get-pod-logs', (event: IpcMainInvokeEvent, connectionId: string, podName: string, namespace: string, containerName: string | null = null, tailLines = 100, sinceSeconds = 300) => {
  const kc = activeConfigs.get(connectionId);
  if (!kc) throw new Error('Conexão não encontrada');
  return getPodLogs(kc, podName, namespace, containerName, tailLines, sinceSeconds);
});

ipcMain.handle('stream-pod-logs', async (event: IpcMainInvokeEvent, connectionId: string, podName: string, namespace: string, containerName: string, sinceSeconds: number) => {
  const kc = activeConfigs.get(connectionId);
  if (!kc) throw new Error('Conexão não encontrada');
  return streamPodLogs(kc, connectionId, podName, namespace, containerName, sinceSeconds, event as any);
});

ipcMain.on('stop-stream-pod-logs', (event: IpcMainEvent, streamId: string) => {
  stopLogStream(streamId);
});

ipcMain.handle('get-pod-containers', async (event: IpcMainInvokeEvent, connectionId: string, podName: string, namespace: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);

    return response.body.spec?.containers.map(container => ({
        name: container.name,
        image: container.image,
        ready: response.body.status?.containerStatuses?.find(cs => cs.name === container.name)?.ready || false,
    })) || [];
});

ipcMain.handle('get-pod-details', async (event: IpcMainInvokeEvent, connectionId: string, podName: string, namespace: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);
    return response.body;
});

// DEPLOYMENT HANDLERS
ipcMain.handle('get-deployments', async (event: IpcMainInvokeEvent, connectionId: string, namespace = 'default') => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');
    return DeploymentService.listDeployments(kc, namespace);
});

ipcMain.handle('get-deployment-details', async (event: IpcMainInvokeEvent, connectionId: string, name: string, namespace: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');
    return DeploymentService.getDeploymentDetails(kc, name, namespace);
});

ipcMain.handle('get-deployment-yaml', async (event: IpcMainInvokeEvent, connectionId: string, name: string, namespace: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');
    return DeploymentService.getDeploymentYAML(kc, name, namespace);
});

ipcMain.handle('get-deployment-pods', async (event: IpcMainInvokeEvent, connectionId: string, deploymentName: string, namespace: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');
    return DeploymentService.getDeploymentPods(kc, deploymentName, namespace);
});

ipcMain.handle('scale-deployment', async (event: IpcMainInvokeEvent, connectionId: string, name: string, namespace: string, replicas: number) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');
    return DeploymentService.scaleDeployment(kc, name, namespace, replicas);
});

ipcMain.handle('restart-deployment', async (event: IpcMainInvokeEvent, connectionId: string, name: string, namespace: string) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc) throw new Error('Conexão não encontrada');
    return DeploymentService.restartDeployment(kc, name, namespace);
});

function calculateAge(creationTimestamp?: Date): string {
  if (!creationTimestamp) return 'Unknown';

  const now = new Date();
  const created = new Date(creationTimestamp);
  const diffMs = now.getTime() - created.getTime();

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
