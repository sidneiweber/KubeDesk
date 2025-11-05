"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const k8s = __importStar(require("@kubernetes/client-node"));
const yaml = __importStar(require("js-yaml"));
const LogService_1 = require("./main/services/LogService");
const DeploymentService_1 = __importDefault(require("./main/services/DeploymentService"));
let mainWindow;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
        mainWindow.maximize();
        mainWindow.show();
    });
    mainWindow.loadFile('src/renderer/index.html');
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}
electron_1.app.whenReady().then(() => {
    if (process.platform === 'linux') {
        electron_1.app.setAppUserModelId('kubedesk');
    }
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// IPC Handlers
electron_1.ipcMain.handle('get-kubeconfig-path', () => {
    const homeDir = os.homedir();
    const defaultPath = path.join(homeDir, '.kube', 'config');
    return defaultPath;
});
electron_1.ipcMain.handle('load-kubeconfig', async (event, configPath) => {
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const kubeConfig = yaml.load(configContent);
        const clusters = kubeConfig.clusters.map((cluster) => ({
            name: cluster.name,
            server: cluster.cluster.server,
        }));
        const contexts = kubeConfig.contexts.map((context) => ({
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
    }
    catch (error) {
        throw new Error(`Erro ao carregar kubeconfig: ${error.message}`);
    }
});
electron_1.ipcMain.handle('select-kubeconfig-file', async () => {
    if (!mainWindow)
        return null;
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
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
const activeConfigs = new Map();
electron_1.ipcMain.handle('connect-to-cluster', async (event, configPath, contextName) => {
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
    }
    catch (error) {
        throw new Error(`Erro ao conectar ao cluster: ${error.message}`);
    }
});
electron_1.ipcMain.handle('get-pods', async (event, connectionId, namespace = 'default') => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = namespace === 'all'
        ? await k8sApi.listPodForAllNamespaces()
        : await k8sApi.listNamespacedPod(namespace);
    return response.body.items.map((pod) => ({
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
electron_1.ipcMain.handle('get-namespaces', async (event, connectionId) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.listNamespace();
    return response.body.items.map((ns) => ({
        name: ns.metadata?.name,
        status: ns.status?.phase,
        age: calculateAge(ns.metadata?.creationTimestamp),
    }));
});
electron_1.ipcMain.handle('get-pod-logs', (event, connectionId, podName, namespace, containerName = null, tailLines = 100, sinceSeconds = 300) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return (0, LogService_1.getPodLogs)(kc, podName, namespace, containerName, tailLines, sinceSeconds);
});
electron_1.ipcMain.handle('stream-pod-logs', async (event, connectionId, podName, namespace, containerName, sinceSeconds) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return (0, LogService_1.streamPodLogs)(kc, connectionId, podName, namespace, containerName, sinceSeconds, event);
});
electron_1.ipcMain.on('stop-stream-pod-logs', (event, streamId) => {
    (0, LogService_1.stopLogStream)(streamId);
});
electron_1.ipcMain.handle('get-pod-containers', async (event, connectionId, podName, namespace) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);
    return response.body.spec?.containers.map(container => ({
        name: container.name,
        image: container.image,
        ready: response.body.status?.containerStatuses?.find(cs => cs.name === container.name)?.ready || false,
    })) || [];
});
electron_1.ipcMain.handle('get-pod-details', async (event, connectionId, podName, namespace) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);
    return response.body;
});
// DEPLOYMENT HANDLERS
electron_1.ipcMain.handle('get-deployments', async (event, connectionId, namespace = 'default') => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return DeploymentService_1.default.listDeployments(kc, namespace);
});
electron_1.ipcMain.handle('get-deployment-details', async (event, connectionId, name, namespace) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return DeploymentService_1.default.getDeploymentDetails(kc, name, namespace);
});
electron_1.ipcMain.handle('get-deployment-yaml', async (event, connectionId, name, namespace) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return DeploymentService_1.default.getDeploymentYAML(kc, name, namespace);
});
electron_1.ipcMain.handle('get-deployment-pods', async (event, connectionId, deploymentName, namespace) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return DeploymentService_1.default.getDeploymentPods(kc, deploymentName, namespace);
});
electron_1.ipcMain.handle('scale-deployment', async (event, connectionId, name, namespace, replicas) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return DeploymentService_1.default.scaleDeployment(kc, name, namespace, replicas);
});
electron_1.ipcMain.handle('restart-deployment', async (event, connectionId, name, namespace) => {
    const kc = activeConfigs.get(connectionId);
    if (!kc)
        throw new Error('Conexão não encontrada');
    return DeploymentService_1.default.restartDeployment(kc, name, namespace);
});
function calculateAge(creationTimestamp) {
    if (!creationTimestamp)
        return 'Unknown';
    const now = new Date();
    const created = new Date(creationTimestamp);
    const diffMs = now.getTime() - created.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
//# sourceMappingURL=main.js.map