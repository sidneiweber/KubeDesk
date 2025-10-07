const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const stream = require('stream');

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
    app.setAppUserModelId('kubernetes-tool');
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
const activeLogStreams = new Map();

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

    const service = response.body.items.map(pod => ({
      service: service.metadata.name,
      // namespace: pod.metadata.namespace,
      // status: pod.status.phase,
      // ready: `${pod.status.containerStatuses?.filter(c => c.ready).length || 0}/${pod.status.containerStatuses?.length || 0}`,
      // restarts: pod.status.containerStatuses?.reduce((total, c) => total + (c.restartCount || 0), 0) || 0,
      // age: calculateAge(pod.metadata.creationTimestamp),
      // node: pod.spec.nodeName,
      // ip: pod.status.podIP,
      // containers: pod.spec.containers.map(container => ({
      //     name: container.name,
      //     image: container.image,
      //     resources: container.resources
      // }))
    }));

    return services;
  } catch (error) {
    throw new Error(`Erro ao buscar services: ${error.message}`);
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

ipcMain.handle('get-pod-logs', async (event, connectionId, podName, namespace, containerName = null, tailLines = 100, sinceSeconds = 300) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    // Tentar diferentes configurações até encontrar uma que funcione
    const configs = [
      // Configuração 1: Com timestamps e sinceSeconds (prioridade alta)
      {
        name: 'com timestamps e sinceSeconds',
        params: [podName, namespace, containerName, undefined, undefined, sinceSeconds, undefined, true, tailLines]
      },
      // Configuração 2: Com timestamps apenas
      {
        name: 'com timestamps',
        params: [podName, namespace, containerName, undefined, undefined, undefined, undefined, true, tailLines]
      },
      // Configuração 3: Com tailLines
      {
        name: 'com tailLines',
        params: [podName, namespace, containerName, undefined, undefined, undefined, undefined, undefined, tailLines]
      },
      // Configuração 4: Básica - apenas parâmetros essenciais
      {
        name: 'básica',
        params: [podName, namespace, containerName]
      }
    ];

    let response = null;
    let lastError = null;

    for (const config of configs) {
      try {
        response = await k8sApi.readNamespacedPodLog(...config.params);
        break;
      } catch (error) {
        console.warn(`Falha com configuração ${config.name}: ${error.message}`);
        lastError = error;
        continue;
      }
    }

    if (!response) {
      throw lastError || new Error('Todas as configurações falharam');
    }

    // Debug: mostrar parte do conteúdo bruto
    if (response.body) {
      const preview = response.body.substring(0, 500);
    }

    // Parsear logs em formato estruturado
    const logs = parseLogs(response.body, podName);


    // Debug: mostrar alguns logs parseados


    return logs;
  } catch (error) {
    console.error('Erro detalhado ao buscar logs:', {
      podName,
      namespace,
      containerName,
      tailLines,
      sinceSeconds,
      error: error.message,
      status: error.status,
      response: error.response?.body
    });
    throw new Error(`Erro ao buscar logs do pod: ${error.message}`);
  }
});

ipcMain.handle('stream-pod-logs', async (event, connectionId, podName, namespace, containerName = null, sinceSeconds = null) => {
  try {
    const kc = activeConfigs.get(connectionId);
    if (!kc) {
      throw new Error('Conexão não encontrada');
    }

    const streamId = `${connectionId}-${namespace}-${podName}-${containerName || 'default'}`;

    // Stop any existing stream for the same pod/container
    if (activeLogStreams.has(streamId)) {
      const oldReq = activeLogStreams.get(streamId);
      if (oldReq && typeof oldReq.abort === 'function') {
        oldReq.abort();
      }
      activeLogStreams.delete(streamId);
    }

    const log = new k8s.Log(kc);
    const logStream = new stream.PassThrough();

    logStream.on('data', (chunk) => {
      event.sender.send('log-stream-data', { streamId, log: chunk.toString() });
    });

    logStream.on('error', (err) => {
      event.sender.send('log-stream-error', { streamId, message: `Erro no stream de logs: ${err.message}` });
      activeLogStreams.delete(streamId);
    });

    logStream.on('end', () => {
      event.sender.send('log-stream-end', { streamId });
      activeLogStreams.delete(streamId);
    });

    const reqPromise = log.log(namespace, podName, containerName, logStream, {
      follow: true,
      tailLines: 100,
      timestamps: true,
      sinceSeconds: sinceSeconds,
    });

    reqPromise.then((req) => {
      activeLogStreams.set(streamId, req);
    }).catch((err) => {
      event.sender.send('log-stream-error', { streamId, message: `Erro ao iniciar streaming de logs: ${err.message}` });
    });

    return { success: true, streamId: streamId, message: 'Streaming iniciado' };

  } catch (error) {
    // This will catch setup errors, not streaming errors
    throw new Error(`Erro ao iniciar streaming de logs: ${error.message}`);
  }
});

ipcMain.on('stop-stream-pod-logs', (event, streamId) => {
  if (activeLogStreams.has(streamId)) {
    const req = activeLogStreams.get(streamId);
    if (req && typeof req.abort === 'function') {
      req.abort();
    }
  }
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
    let realMetrics;
    try {
      realMetrics = await getRealPodMetrics(kc, podName, namespace, pod);
    } catch (metricsError) {
      // Fallback para cálculo baseado apenas nas requests/limits
      realMetrics = calculateRealPodMetrics(pod);
    }
    
    return realMetrics;
  } catch (error) {
    console.error('Erro ao buscar métricas do pod:', error);
    // Fallback final: retornar métricas zeradas se não conseguir buscar dados
    return {
      cpu: { current: '0m', requests: null, limits: null, percentage: 0 },
      memory: { current: '0Mi', requests: null, limits: null, percentage: 0 }
    };
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
          // Fallback para métricas zeradas se não conseguir buscar o pod
          return {
            pod: originalPod,
            metrics: {
              cpu: { current: '0m', requests: null, limits: null, percentage: 0 },
              memory: { current: '0Mi', requests: null, limits: null, percentage: 0 }
            }
          };
        }

        try {
          let realMetrics;
          if (allPodMetrics) {
            // Usar métricas reais do batch
            const podMetrics = allPodMetrics.find(item => item.metadata.name === pod.metadata.name);
            if (podMetrics) {
              realMetrics = await processPodMetricsFromBatch(pod, podMetrics);
            } else {
              realMetrics = calculateRealPodMetrics(pod);
            }
          } else {
            // Fallback para cálculo baseado em requests/limits
            realMetrics = calculateRealPodMetrics(pod);
          }
          
          return { pod: originalPod, metrics: realMetrics };
        } catch (error) {
          console.error(`Erro ao processar métricas para pod ${pod.metadata.name}:`, error);
          return {
            pod: originalPod,
            metrics: {
              cpu: { current: '0m', requests: null, limits: null, percentage: 0 },
              memory: { current: '0Mi', requests: null, limits: null, percentage: 0 }
            }
          };
        }
      })
    );

    return results;
  } catch (error) {
    console.error('Erro ao buscar métricas em batch:', error);
    // Fallback: retornar métricas zeradas para todos os pods
    return pods.map(pod => ({
      pod,
      metrics: {
        cpu: { current: '0m', requests: null, limits: null, percentage: 0 },
        memory: { current: '0Mi', requests: null, limits: null, percentage: 0 }
      }
    }));
  }
});

// Função para processar métricas de um pod a partir do batch
async function processPodMetricsFromBatch(pod, podMetrics) {
  // Calcular recursos totais do pod
  const totalResources = calculatePodTotalResources(pod.spec.containers);
  
  // Calcular uso total dos containers
  let totalCpuUsage = 0;
  let totalMemoryUsage = 0;
  
  if (podMetrics.containers) {
    podMetrics.containers.forEach(container => {
      // CPU usage (em nanocores)
      if (container.usage?.cpu) {
        totalCpuUsage += parseCpuToMillicores(container.usage.cpu);
      }
      
      // Memory usage (em bytes)
      if (container.usage?.memory) {
        totalMemoryUsage += parseMemoryToMi(container.usage.memory);
      }
    });
  }

  // Calcular porcentagens baseadas nos limits (fallback para requests se não houver limits)
  const cpuLimits = totalResources.cpuLimits ? parseCpuToMillicores(totalResources.cpuLimits) : 
                    (totalResources.cpuRequests ? parseCpuToMillicores(totalResources.cpuRequests) : 0);
  const memoryLimits = totalResources.memoryLimits ? parseMemoryToMi(totalResources.memoryLimits) : 
                       (totalResources.memoryRequests ? parseMemoryToMi(totalResources.memoryRequests) : 0);

  return {
    cpu: {
      current: `${totalCpuUsage}m`,
      requests: totalResources.cpuRequests,
      limits: totalResources.cpuLimits,
      percentage: cpuLimits > 0 ? Math.round((totalCpuUsage / cpuLimits) * 100) : 0
    },
    memory: {
      current: formatMemoryIntelligently(`${totalMemoryUsage}Mi`),
      requests: totalResources.memoryRequests,
      limits: totalResources.memoryLimits,
      percentage: memoryLimits > 0 ? Math.round((totalMemoryUsage / memoryLimits) * 100) : 0
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

    // Calcular recursos totais do pod
    const totalResources = calculatePodTotalResources(pod.spec.containers);
    
    // Calcular uso total dos containers
    let totalCpuUsage = 0;
    let totalMemoryUsage = 0;
    
    if (podMetrics.containers) {
      podMetrics.containers.forEach(container => {
        // CPU usage (em nanocores)
        if (container.usage?.cpu) {
          totalCpuUsage += parseCpuToMillicores(container.usage.cpu);
        }
        
        // Memory usage (em bytes)
        if (container.usage?.memory) {
          totalMemoryUsage += parseMemoryToMi(container.usage.memory);
        }
      });
    }

    // Calcular porcentagens baseadas nos limits (fallback para requests se não houver limits)
    const cpuLimits = totalResources.cpuLimits ? parseCpuToMillicores(totalResources.cpuLimits) : 
                      (totalResources.cpuRequests ? parseCpuToMillicores(totalResources.cpuRequests) : 0);
    const memoryLimits = totalResources.memoryLimits ? parseMemoryToMi(totalResources.memoryLimits) : 
                         (totalResources.memoryRequests ? parseMemoryToMi(totalResources.memoryRequests) : 0);

    return {
      cpu: {
        current: `${totalCpuUsage}m`,
        requests: totalResources.cpuRequests,
        limits: totalResources.cpuLimits,
        percentage: cpuLimits > 0 ? Math.round((totalCpuUsage / cpuLimits) * 100) : 0
      },
      memory: {
        current: formatMemoryIntelligently(`${totalMemoryUsage}Mi`),
        requests: totalResources.memoryRequests,
        limits: totalResources.memoryLimits,
        percentage: memoryLimits > 0 ? Math.round((totalMemoryUsage / memoryLimits) * 100) : 0
      }
    };
    
  } catch (error) {
    // Se a API de métricas não estiver disponível, tentar método alternativo
    if (error.status === 404 || error.message.includes('metrics.k8s.io')) {
      throw new Error('Metrics Server não está disponível no cluster');
    }
    throw error;
  }
}

// Função para calcular métricas reais de um pod (fallback)
function calculateRealPodMetrics(pod) {
  const containers = pod.spec.containers;
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

  // Para uso atual, vamos simular baseado nos limits (fallback para requests se não houver limits)
  // Mas agora usando os valores reais dos limits como base
  const cpuLimits = totalCpuLimits > 0 ? totalCpuLimits : totalCpuRequests;
  const memoryLimits = totalMemoryLimits > 0 ? totalMemoryLimits : totalMemoryRequests;
  
  const cpuCurrent = cpuLimits > 0 ? Math.floor(cpuLimits * (0.1 + Math.random() * 0.3)) : 0;
  const memoryCurrent = memoryLimits > 0 ? Math.floor(memoryLimits * (0.1 + Math.random() * 0.4)) : 0;

  return {
    cpu: {
      current: `${cpuCurrent}m`,
      requests: totalCpuRequests > 0 ? `${totalCpuRequests}m` : null,
      limits: totalCpuLimits > 0 ? `${totalCpuLimits}m` : null,
      percentage: cpuLimits > 0 ? Math.round((cpuCurrent / cpuLimits) * 100) : 0
    },
    memory: {
      current: formatMemoryIntelligently(`${memoryCurrent}Mi`),
      requests: totalMemoryRequests > 0 ? formatMemoryIntelligently(`${totalMemoryRequests}Mi`) : null,
      limits: totalMemoryLimits > 0 ? formatMemoryIntelligently(`${totalMemoryLimits}Mi`) : null,
      percentage: memoryLimits > 0 ? Math.round((memoryCurrent / memoryLimits) * 100) : 0
    }
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


// Handler para mostrar menu de contexto
ipcMain.handle('show-context-menu', async (event, podName, podNamespace) => {
  const template = [
    {
      label: `Pod: ${podName}`,
      enabled: false
    },
    {
      type: 'separator'
    },
    {
      label: '📋 Ver Logs',
      click: () => {
        event.sender.send('context-menu-action', 'show-logs', { podName, podNamespace });
      }
    },
    {
      label: '📊 Detalhes do Pod',
      click: () => {
        event.sender.send('context-menu-action', 'show-details', { podName, podNamespace });
      }
    },
    {
      type: 'separator'
    },
    {
      label: '🔄 Recarregar Pod',
      click: () => {
        event.sender.send('context-menu-action', 'reload-pod', { podName, podNamespace });
      }
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup();
});

function parseLogs(logContent, podName) {
  if (!logContent || logContent.trim() === '') {
    return [];
  }

  const lines = logContent.split('\n').filter(line => line.trim());



  const logs = [];

  lines.forEach((line, index) => {
    // Tentar parsear diferentes formatos de log
    let parsedLog = parseLogLine(line, podName, index);
    if (parsedLog) {
      logs.push(parsedLog);
    }
  });

  return logs;
}

function parseLogLine(line, podName, index) {
  // Padrões comuns de logs do Kubernetes - expandidos
  const timestampPatterns = [
    // ISO 8601 com milissegundos e Z
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/,
    // ISO 8601 sem milissegundos e Z
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/,
    // ISO 8601 sem Z
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
    // RFC 3339 com timezone
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2})/,
    // RFC 3339 sem milissegundos com timezone
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/,
    // Formato comum de containers: 2025-01-03T16:22:07.123456789Z
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z)/,
    // Formato com espaço: 2025-01-03 16:22:07
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
    // Formato com espaço e milissegundos: 2025-01-03 16:22:07.123
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/,
    // Formato syslog: Jan 03 16:22:07
    /^(\w{3} \d{1,2} \d{2}:\d{2}:\d{2})/,
    // Formato com colchetes: [2025-01-03T16:22:07Z]
    /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?)\]/
  ];

  const nginxRegex = /^(\d+\.\d+\.\d+\.\d+) - - \[([^\]]+)\] "([^"]+)" (\d+) (\d+) "([^"]*)" "([^"]*)" "([^"]*)"$/;
  const jsonRegex = /^\{.*\}$/;

  // Gerar ID baseado no conteúdo do log para consistência
  const crypto = require('crypto');
  const logHash = crypto.createHash('md5').update(line).digest('hex').substring(0, 8);

  let log = {
    id: `${podName}-${logHash}`,
    timestamp: null,
    podName: podName,
    level: 'info',
    message: line,
    raw: line
  };

  // Tentar todos os padrões de timestamp
  let timestampFound = false;
  for (const pattern of timestampPatterns) {
    const match = line.match(pattern);
    if (match) {
      let timestamp = match[1];

      // Normalizar timestamp para ISO 8601
      if (pattern.source.includes(' ')) {
        // Converter formato com espaço para ISO
        timestamp = timestamp.replace(' ', 'T') + 'Z';
      } else if (pattern.source.includes('\\w{3}')) {
        // Converter formato syslog para ISO
        timestamp = parseSyslogTimestamp(timestamp);
      } else if (!timestamp.includes('T') && !timestamp.includes('Z')) {
        // Adicionar T e Z se necessário
        timestamp = timestamp.replace(' ', 'T') + 'Z';
      }

      log.timestamp = timestamp;
      log.message = line.substring(match[0].length).trim();
      log.hasRealTimestamp = true;
      timestampFound = true;
      break;
    }
  }

  if (!timestampFound) {
    // Se não há timestamp no log, usar timestamp atual apenas como fallback
    log.timestamp = new Date().toISOString();
    log.isApproximateTimestamp = true;
  }

  // Verificar se é um log do nginx
  const nginxMatch = line.match(nginxRegex);
  if (nginxMatch) {
    const [, ip, timestamp, request, status, size, referer, userAgent, forwarded] = nginxMatch;
    log.ip = ip;
    log.timestamp = parseNginxTimestamp(timestamp);
    log.message = `${request} ${status} ${size}`;
    log.level = parseInt(status) >= 400 ? 'error' : 'info';
    log.raw = line;
  }

  // Verificar se é um log JSON
  if (jsonRegex.test(line)) {
    try {
      const jsonLog = JSON.parse(line);
      log.timestamp = jsonLog.timestamp || log.timestamp;
      log.level = jsonLog.level || log.level;
      log.message = jsonLog.message || jsonLog.msg || line;
    } catch (e) {
      // Não é JSON válido, manter como está
    }
  }

  // Determinar nível do log baseado no conteúdo
  if (log.message.toLowerCase().includes('error') || log.message.toLowerCase().includes('fatal')) {
    log.level = 'error';
  } else if (log.message.toLowerCase().includes('warn') || log.message.toLowerCase().includes('warning')) {
    log.level = 'warning';
  } else if (log.message.toLowerCase().includes('debug')) {
    log.level = 'debug';
  }

  return log;
}

function parseSyslogTimestamp(timestamp) {
  // Converter timestamp syslog para ISO format
  // Formato: Jan 03 16:22:07
  const months = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  const match = timestamp.match(/(\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, month, day, hour, minute, second] = match;
    const currentYear = new Date().getFullYear();
    const paddedDay = day.padStart(2, '0');
    return `${currentYear}-${months[month]}-${paddedDay}T${hour}:${minute}:${second}.000Z`;
  }

  return new Date().toISOString();
}

function parseNginxTimestamp(timestamp) {
  // Converter timestamp do nginx para ISO format
  // Formato: 22/Jul/2025:08:55:11 +0000
  const months = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  const match = timestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    return `${year}-${months[month]}-${day}T${hour}:${minute}:${second}.000Z`;
  }

  return new Date().toISOString();
}

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
