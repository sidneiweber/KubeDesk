const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const LogService = require('./main/services/LogService');
const DeploymentService = require('./main/services/DeploymentService');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../assets/icon-square.png'),
    titleBarStyle: 'default',
    show: false,
    title: 'KubeDesk'
  });

  mainWindow.setMenuBarVisibility(false);

  // Maximizar a janela após carregar
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.loadFile('src/renderer/index.html');

  // Abrir DevTools em modo desenvolvimento
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Configurar ícone da aplicação para o sistema
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

ipcMain.handle('load-kubeconfig', async (event, configPath) => {
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const kubeConfig = yaml.load(configContent);

    // Extrair informações dos clusters
    const clusters = kubeConfig.clusters.map((cluster, index) => ({
      name: cluster.name,
      server: cluster.cluster.server,
      caData: cluster.cluster['certificate-authority-data'],
      contextName: kubeConfig.contexts.find(ctx => ctx.context.cluster === cluster.name)?.name
    }));

    const contexts = kubeConfig.contexts.map(context => ({
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
  } catch (error) {
    throw new Error(`Erro ao carregar kubeconfig: ${error.message}`);
  }
});

ipcMain.handle('select-kubeconfig-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar arquivo kubeconfig',
    filters: [
      { name: 'Kubernetes Config', extensions: ['yml', 'yaml'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Armazenar configurações ativas em memória
const activeConfigs = new Map();

ipcMain.handle('connect-to-cluster', async (event, configPath, contextName) => {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromFile(configPath);
    kc.setCurrentContext(contextName);

    // Testar conexão
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    await k8sApi.listNamespace();

    // Gerar um ID único para esta conexão
    const connectionId = `${contextName}-${Date.now()}`;
    activeConfigs.set(connectionId, kc);

    return {
      connected: true,
      context: contextName,
      connectionId: connectionId
    };
  } catch (error) {
    throw new Error(`Erro ao conectar ao cluster: ${error.message}`);
  }
});

ipcMain.handle('get-pods', async (event, connectionId, namespace = 'default') => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    let response;

    if (namespace === 'all') {
      // Listar pods de todos os namespaces
      response = await k8sApi.listPodForAllNamespaces();
    } else {
      // Listar pods de um namespace específico
      response = await k8sApi.listNamespacedPod(namespace);
    }

    const pods = response.body.items.map(pod => ({
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
      status: pod.status.phase,
      ready: `${pod.status.containerStatuses?.filter(c => c.ready).length || 0}/${pod.status.containerStatuses?.length || 0}`,
      restarts: pod.status.containerStatuses?.reduce((total, c) => total + (c.restartCount || 0), 0) || 0,
      age: calculateAge(pod.metadata.creationTimestamp),
      node: pod.spec.nodeName,
      ip: pod.status.podIP,
      containers: pod.spec.containers.map(container => ({
        name: container.name,
        image: container.image,
        resources: container.resources
      })),
      // Adicionar recursos agregados do pod
      totalResources: calculatePodTotalResources(pod.spec.containers)
    }));

    return pods;
  } catch (error) {
    throw new Error(`Erro ao buscar pods: ${error.message}`);
  }
});

ipcMain.handle('get-services', async (event, connectionId, namespace = 'default') => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    let response;

    if (namespace === 'all') {
      // Listar services de todos os namespaces
      response = await k8sApi.listServiceForAllNamespaces();
    } else {
      // Listar services de um namespace específico
      response = await k8sApi.listNamespacedService(namespace);
    }

    const services = response.body.items.map(service => ({
      metadata: {
        name: service.metadata.name,
        namespace: service.metadata.namespace,
        creationTimestamp: service.metadata.creationTimestamp,
        uid: service.metadata.uid,
        resourceVersion: service.metadata.resourceVersion,
        labels: service.metadata.labels || {},
        annotations: service.metadata.annotations || {}
      },
      spec: {
        type: service.spec.type,
        clusterIP: service.spec.clusterIP,
        externalIPs: service.spec.externalIPs || [],
        sessionAffinity: service.spec.sessionAffinity,
        loadBalancerIP: service.spec.loadBalancerIP,
        ports: service.spec.ports || [],
        selector: service.spec.selector || {}
      },
      status: service.status || {}
    }));

    return services;
  } catch (error) {
    throw new Error(`Erro ao buscar services: ${error.message}`);
  }
});

ipcMain.handle('get-service', async (event, connectionId, name, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedService(name, namespace);
    
    return {
      metadata: {
        name: response.body.metadata.name,
        namespace: response.body.metadata.namespace,
        creationTimestamp: response.body.metadata.creationTimestamp,
        uid: response.body.metadata.uid,
        resourceVersion: response.body.metadata.resourceVersion,
        labels: response.body.metadata.labels || {},
        annotations: response.body.metadata.annotations || {}
      },
      spec: {
        type: response.body.spec.type,
        clusterIP: response.body.spec.clusterIP,
        externalIPs: response.body.spec.externalIPs || [],
        sessionAffinity: response.body.spec.sessionAffinity,
        loadBalancerIP: response.body.spec.loadBalancerIP,
        ports: response.body.spec.ports || [],
        selector: response.body.spec.selector || {}
      },
      status: response.body.status || {}
    };
  } catch (error) {
    throw new Error(`Erro ao buscar service: ${error.message}`);
  }
});

ipcMain.handle('get-service-yaml', async (event, connectionId, name, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedService(name, namespace);
    
    // Remover managedFields do metadata para uma visualização mais limpa
    const serviceData = JSON.parse(JSON.stringify(response.body));
    if (serviceData.metadata && serviceData.metadata.managedFields) {
      delete serviceData.metadata.managedFields;
    }

    // Converter para YAML usando a biblioteca js-yaml
    try {
      const yaml = require('js-yaml');
      return yaml.dump(serviceData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
    } catch (e) {
      // Fallback para JSON formatado
      return JSON.stringify(serviceData, null, 2);
    }
  } catch (error) {
    throw new Error(`Erro ao buscar YAML do service: ${error.message}`);
  }
});

ipcMain.handle('get-namespaces', async (event, connectionId) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.listNamespace();
    const namespaces = response.body.items.map(ns => ({
      name: ns.metadata.name,
      status: ns.status.phase,
      age: calculateAge(ns.metadata.creationTimestamp)
    }));

    return namespaces;
  } catch (error) {
    throw new Error(`Erro ao buscar namespaces: ${error.message}`);
  }
});

ipcMain.handle('get-pod-logs', (event, connectionId, podName, namespace, containerName = null, tailLines = 100, sinceSeconds = 300) => {
  const kc = activeConfigs.get(connectionId);
  return LogService.getPodLogs(kc, podName, namespace, containerName, tailLines, sinceSeconds);
});

ipcMain.handle('stream-pod-logs', async (event, connectionId, podName, namespace, containerName = null, sinceSeconds = null) => {
  const kc = activeConfigs.get(connectionId);
  return LogService.streamPodLogs(kc, connectionId, podName, namespace, containerName, sinceSeconds, event);
});

ipcMain.on('stop-stream-pod-logs', (event, streamId) => {
  LogService.stopLogStream(streamId);
});

ipcMain.handle('get-pod-containers', async (event, connectionId, podName, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);

    const containers = response.body.spec.containers.map(container => ({
      name: container.name,
      image: container.image,
      ready: response.body.status.containerStatuses?.find(cs => cs.name === container.name)?.ready || false
    }));

    return containers;
  } catch (error) {
    throw new Error(`Erro ao buscar containers do pod: ${error.message}`);
  }
});

ipcMain.handle('get-pod-details', async (event, connectionId, podName, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);

    return response.body;
  } catch (error) {
    throw new Error(`Erro ao buscar detalhes do pod: ${error.message}`);
  }
});

ipcMain.handle('calculate-age', async (event, creationTimestamp) => {
  return calculateAge(creationTimestamp);
});

// Handler para verificar se o Metrics Server está disponível
ipcMain.handle('check-metrics-server', async (event, connectionId) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const metricsApi = kc.makeApiClient(k8s.CustomObjectsApi);
    
    // Tentar listar métricas de pods em um namespace específico
    await metricsApi.listNamespacedCustomObject(
      'metrics.k8s.io',
      'v1beta1',
      'kube-system', // namespace padrão
      'pods',
      undefined, undefined, undefined, undefined, undefined, 1 // limit 1 para teste rápido
    );
    
    return { available: true, message: 'Metrics Server está disponível' };
  } catch (error) {
    if (error.status === 404 || error.message.includes('metrics.k8s.io')) {
      return { available: false, message: 'Metrics Server não está disponível' };
    }
    throw error;
  }
});

ipcMain.handle('get-pod-metrics', async (event, connectionId, podName, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    // Buscar dados reais do pod
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);
    const pod = response.body;

    // Tentar buscar métricas reais do Metrics Server
    try {
      return await getRealPodMetrics(kc, podName, namespace, pod);
    } catch (metricsError) {
      // Sem Metrics Server ainda temos requests/limits do spec, mas não o uso
      return podResourcesWithoutUsage(pod);
    }
  } catch (error) {
    console.error('Erro ao buscar métricas do pod:', error);
    return unknownMetrics();
  }
});

// Handler para buscar métricas de múltiplos pods em batch
ipcMain.handle('get-pods-metrics-batch', async (event, connectionId, pods) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const metricsApi = kc.makeApiClient(k8s.CustomObjectsApi);
    
    // Buscar todos os pods de uma vez
    const podPromises = pods.map(async (pod) => {
      try {
        const response = await k8sApi.readNamespacedPod(pod.name, pod.namespace);
        return { pod: response.body, originalPod: pod };
      } catch (error) {
        console.warn(`Erro ao buscar pod ${pod.name}:`, error);
        return { pod: null, originalPod: pod };
      }
    });

    const podResults = await Promise.all(podPromises);
    
    // Tentar buscar métricas de todos os pods de uma vez
    let allPodMetrics = null;
    try {
      // Buscar métricas de todos os pods do namespace
      const namespace = pods[0]?.namespace || 'default';
      const metricsResponse = await metricsApi.listNamespacedCustomObject(
        'metrics.k8s.io',
        'v1beta1',
        namespace,
        'pods'
      );
      allPodMetrics = metricsResponse.body.items;
    } catch (metricsError) {
      console.warn('Metrics Server não disponível para batch:', metricsError.message);
    }

    // Processar métricas para cada pod
    const results = await Promise.all(
      podResults.map(async ({ pod, originalPod }) => {
        if (!pod) {
          return { pod: originalPod, metrics: unknownMetrics() };
        }

        try {
          const podMetrics = allPodMetrics?.find(item => item.metadata.name === pod.metadata.name);
          const metrics = podMetrics
            ? buildPodMetrics(pod, podMetrics)
            : podResourcesWithoutUsage(pod);

          return { pod: originalPod, metrics };
        } catch (error) {
          console.error(`Erro ao processar métricas para pod ${pod.metadata.name}:`, error);
          return { pod: originalPod, metrics: unknownMetrics() };
        }
      })
    );

    return results;
  } catch (error) {
    console.error('Erro ao buscar métricas em batch:', error);
    return pods.map(pod => ({ pod, metrics: unknownMetrics() }));
  }
});

// Combina o uso medido pelo Metrics Server com os requests/limits do spec.
// percentage nulo = sem denominador (pod sem requests/limits), não zero: o uso
// é real, apenas não há referência para uma barra de progresso.
function buildPodMetrics(pod, podMetrics) {
  const totalResources = calculatePodTotalResources(pod.spec.containers);

  let totalCpuUsage = 0;
  let totalMemoryUsage = 0;

  for (const container of podMetrics.containers || []) {
    if (container.usage?.cpu) {
      totalCpuUsage += parseCpuToMillicores(container.usage.cpu);
    }
    if (container.usage?.memory) {
      totalMemoryUsage += parseMemoryToMi(container.usage.memory);
    }
  }

  // Referência é limits, com fallback para requests
  const cpuReference = parseCpuToMillicores(totalResources.cpuLimits || totalResources.cpuRequests);
  const memoryReference = parseMemoryToMi(totalResources.memoryLimits || totalResources.memoryRequests);

  return {
    cpu: {
      current: `${totalCpuUsage}m`,
      requests: totalResources.cpuRequests,
      limits: totalResources.cpuLimits,
      percentage: cpuReference > 0 ? Math.round((totalCpuUsage / cpuReference) * 100) : null
    },
    memory: {
      current: formatMemoryIntelligently(`${totalMemoryUsage}Mi`),
      requests: totalResources.memoryRequests,
      limits: totalResources.memoryLimits,
      percentage: memoryReference > 0 ? Math.round((totalMemoryUsage / memoryReference) * 100) : null
    }
  };
}

// Função para buscar métricas reais do Metrics Server
async function getRealPodMetrics(kc, podName, namespace, pod) {
  try {
    // Tentar usar a API de métricas personalizada
    const metricsApi = kc.makeApiClient(k8s.CustomObjectsApi);
    
    // Buscar métricas do pod
    const podMetricsResponse = await metricsApi.listNamespacedCustomObject(
      'metrics.k8s.io',
      'v1beta1',
      namespace,
      'pods',
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // continue
      undefined, // fieldSelector
      undefined, // labelSelector
      undefined, // limit
      undefined, // resourceVersion
      undefined, // resourceVersionMatch
      undefined, // timeoutSeconds
      undefined  // watch
    );

    // Encontrar as métricas do pod específico
    const podMetrics = podMetricsResponse.body.items.find(item => item.metadata.name === podName);

    if (!podMetrics) {
      throw new Error('Métricas do pod não encontradas');
    }

    return buildPodMetrics(pod, podMetrics);

  } catch (error) {
    // Se a API de métricas não estiver disponível, tentar método alternativo
    if (error.status === 404 || error.message.includes('metrics.k8s.io')) {
      throw new Error('Metrics Server não está disponível no cluster');
    }
    throw error;
  }
}

// Métricas de um pod sem o uso atual: requests/limits vêm do spec e são dados
// reais, mas o consumo só existe via Metrics Server. current/percentage nulos
// sinalizam "indisponível" para a UI — nunca estimar, ou o usuário não
// consegue distinguir de medição real.
function podResourcesWithoutUsage(pod) {
  const totalResources = calculatePodTotalResources(pod.spec.containers);

  return {
    cpu: {
      current: null,
      requests: totalResources.cpuRequests,
      limits: totalResources.cpuLimits,
      percentage: null
    },
    memory: {
      current: null,
      requests: totalResources.memoryRequests,
      limits: totalResources.memoryLimits,
      percentage: null
    }
  };
}

// Métricas totalmente desconhecidas: nem o spec do pod pôde ser lido.
function unknownMetrics() {
  return {
    cpu: { current: null, requests: null, limits: null, percentage: null },
    memory: { current: null, requests: null, limits: null, percentage: null }
  };
}

// Função para calcular recursos totais de um pod baseado nos containers
function calculatePodTotalResources(containers) {
  let totalCpuRequests = 0;
  let totalCpuLimits = 0;
  let totalMemoryRequests = 0;
  let totalMemoryLimits = 0;

  containers.forEach(container => {
    if (container.resources) {
      // CPU Requests
      if (container.resources.requests?.cpu) {
        totalCpuRequests += parseCpuToMillicores(container.resources.requests.cpu);
      }
      
      // CPU Limits
      if (container.resources.limits?.cpu) {
        totalCpuLimits += parseCpuToMillicores(container.resources.limits.cpu);
      }
      
      // Memory Requests
      if (container.resources.requests?.memory) {
        totalMemoryRequests += parseMemoryToMi(container.resources.requests.memory);
      }
      
      // Memory Limits
      if (container.resources.limits?.memory) {
        totalMemoryLimits += parseMemoryToMi(container.resources.limits.memory);
      }
    }
  });

  return {
    cpuRequests: totalCpuRequests > 0 ? `${totalCpuRequests}m` : null,
    cpuLimits: totalCpuLimits > 0 ? `${totalCpuLimits}m` : null,
    memoryRequests: totalMemoryRequests > 0 ? formatMemoryIntelligently(`${totalMemoryRequests}Mi`) : null,
    memoryLimits: totalMemoryLimits > 0 ? formatMemoryIntelligently(`${totalMemoryLimits}Mi`) : null
  };
}

// Função para converter CPU para millicores
function parseCpuToMillicores(cpuStr) {
  if (!cpuStr) return 0;
  
  if (cpuStr.endsWith('m')) {
    return parseInt(cpuStr.slice(0, -1));
  } else if (cpuStr.endsWith('n')) {
    return Math.floor(parseInt(cpuStr.slice(0, -1)) / 1000000);
  } else {
    return Math.floor(parseFloat(cpuStr) * 1000);
  }
}

// Função para converter memória para Mi (com conversão inteligente)
function parseMemoryToMi(memStr) {
  if (!memStr) return 0;
  
  const units = {
    'Ki': 1024,
    'Mi': 1024 * 1024,
    'Gi': 1024 * 1024 * 1024,
    'Ti': 1024 * 1024 * 1024 * 1024
  };
  
  for (const [unit, multiplier] of Object.entries(units)) {
    if (memStr.endsWith(unit)) {
      return Math.floor(parseFloat(memStr.slice(0, -unit.length)) * multiplier / (1024 * 1024));
    }
  }
  
  // Se não tem unidade, assumir bytes e converter para Mi
  return Math.floor(parseInt(memStr) / (1024 * 1024));
}

// Função para formatar memória de forma inteligente (converte 2000Mi para 2Gi)
function formatMemoryIntelligently(bytes) {
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
  let size = bytes;
  let unitIndex = 0;
  
  // Converter para bytes primeiro
  if (typeof bytes === 'string') {
    if (bytes.endsWith('Mi')) {
      size = parseFloat(bytes.slice(0, -2)) * 1024 * 1024;
    } else if (bytes.endsWith('Gi')) {
      size = parseFloat(bytes.slice(0, -2)) * 1024 * 1024 * 1024;
    } else if (bytes.endsWith('Ki')) {
      size = parseFloat(bytes.slice(0, -2)) * 1024;
    } else if (bytes.endsWith('Ti')) {
      size = parseFloat(bytes.slice(0, -2)) * 1024 * 1024 * 1024 * 1024;
    } else {
      size = parseFloat(bytes);
    }
  }
  
  // Encontrar a unidade apropriada
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  // Arredondar para números inteiros quando apropriado
  if (size >= 100) {
    size = Math.round(size);
  } else if (size >= 10) {
    size = Math.round(size * 10) / 10;
  } else {
    size = Math.round(size * 100) / 100;
  }
  
  return `${size}${units[unitIndex]}`;
}


// Handler para buscar YAML do pod
ipcMain.handle('get-pod-yaml', async (event, connectionId, podName, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const response = await k8sApi.readNamespacedPod(podName, namespace);

    // Remover managedFields do metadata para uma visualização mais limpa
    const podData = JSON.parse(JSON.stringify(response.body));
    if (podData.metadata && podData.metadata.managedFields) {
      delete podData.metadata.managedFields;
    }

    // Converter o objeto do pod para YAML
    const podYaml = yaml.dump(podData, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    return podYaml;
  } catch (error) {
    throw new Error(`Erro ao buscar YAML do pod: ${error.message}`);
  }
});

// ============================================================================
// DEPLOYMENT HANDLERS
// ============================================================================

// Handler para listar deployments
ipcMain.handle('get-deployments', async (event, connectionId, namespace = 'default') => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    return await DeploymentService.listDeployments(kc, namespace);
  } catch (error) {
    console.error('Erro ao buscar deployments:', error);
    throw new Error(`Erro ao buscar deployments: ${error.message}`);
  }
});

// Handler para obter detalhes de um deployment
ipcMain.handle('get-deployment-details', async (event, connectionId, name, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    return await DeploymentService.getDeploymentDetails(kc, name, namespace);
  } catch (error) {
    console.error('Erro ao buscar detalhes do deployment:', error);
    throw new Error(`Erro ao buscar detalhes do deployment: ${error.message}`);
  }
});

// Handler para obter YAML de um deployment
ipcMain.handle('get-deployment-yaml', async (event, connectionId, name, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    return await DeploymentService.getDeploymentYAML(kc, name, namespace);
  } catch (error) {
    console.error('Erro ao buscar YAML do deployment:', error);
    throw new Error(`Erro ao buscar YAML do deployment: ${error.message}`);
  }
});

// Handler para obter pods de um deployment
ipcMain.handle('get-deployment-pods', async (event, connectionId, deploymentName, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    return await DeploymentService.getDeploymentPods(kc, deploymentName, namespace);
  } catch (error) {
    console.error('Erro ao buscar pods do deployment:', error);
    throw new Error(`Erro ao buscar pods do deployment: ${error.message}`);
  }
});

// Handler para escalar um deployment
ipcMain.handle('scale-deployment', async (event, connectionId, name, namespace, replicas) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    return await DeploymentService.scaleDeployment(kc, name, namespace, replicas);
  } catch (error) {
    console.error('Erro ao escalar deployment:', error);
    throw new Error(`Erro ao escalar deployment: ${error.message}`);
  }
});

// Handler para reiniciar um deployment
ipcMain.handle('restart-deployment', async (event, connectionId, name, namespace) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    return await DeploymentService.restartDeployment(kc, name, namespace);
  } catch (error) {
    console.error('Erro ao reiniciar deployment:', error);
    throw new Error(`Erro ao reiniciar deployment: ${error.message}`);
  }
});

// ============================================================================
// END DEPLOYMENT HANDLERS
// ============================================================================

function calculateAge(creationTimestamp) {
  if (!creationTimestamp) return 'Unknown';

  const now = new Date();
  const created = new Date(creationTimestamp);
  const diffMs = now - created;

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
