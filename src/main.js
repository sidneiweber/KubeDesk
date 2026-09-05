const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const { formatAge } = require('./shared/formatAge');
const { computePodStatus } = require('./shared/podStatus');
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

function getCluster(connectionId) {
  const kc = activeConfigs.get(connectionId);
  if (!kc) {
    throw new Error('Conexão não encontrada');
  }
  return kc;
}

// Registra um handler IPC que opera sobre uma conexão ativa. Resolve o
// connectionId antes de chamar fn e prefixa qualquer erro com a descrição da
// operação, para o renderer exibir uma mensagem com contexto.
function handleWithCluster(channel, description, fn) {
  ipcMain.handle(channel, async (event, connectionId, ...args) => {
    try {
      return await fn(getCluster(connectionId), ...args);
    } catch (error) {
      throw new Error(`Erro ao ${description}: ${error.message}`);
    }
  });
}

// Serializa um objeto do K8s em YAML, sem managedFields (ruído de API).
function toCleanYaml(body) {
  const data = JSON.parse(JSON.stringify(body));
  delete data.metadata?.managedFields;

  return yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}

// Projeção de um Service para o formato consumido pelo renderer.
function projectService(service) {
  return {
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
  };
}

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

handleWithCluster('get-pods', 'buscar pods', async (kc, namespace = 'default') => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = namespace === 'all'
    ? await k8sApi.listPodForAllNamespaces()
    : await k8sApi.listNamespacedPod(namespace);

  return response.body.items.map(pod => ({
    name: pod.metadata.name,
    namespace: pod.metadata.namespace,
    // status/ready/restarts saem do mesmo cálculo que o kubectl usa: a fase
    // sozinha mostraria "Running" para um pod em CrashLoopBackOff
    ...computePodStatus(pod),
    age: formatAge(pod.metadata.creationTimestamp),
    creationTimestamp: pod.metadata.creationTimestamp,
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
});

handleWithCluster('get-services', 'buscar services', async (kc, namespace = 'default') => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = namespace === 'all'
    ? await k8sApi.listServiceForAllNamespaces()
    : await k8sApi.listNamespacedService(namespace);

  return response.body.items.map(projectService);
});

handleWithCluster('get-service', 'buscar service', async (kc, name, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.readNamespacedService(name, namespace);

  return projectService(response.body);
});

handleWithCluster('get-service-yaml', 'buscar YAML do service', async (kc, name, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.readNamespacedService(name, namespace);

  return toCleanYaml(response.body);
});

handleWithCluster('get-namespaces', 'buscar namespaces', async (kc) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.listNamespace();

  return response.body.items.map(ns => ({
    name: ns.metadata.name,
    status: ns.status.phase,
    age: formatAge(ns.metadata.creationTimestamp),
    creationTimestamp: ns.metadata.creationTimestamp
  }));
});

// Fora do handleWithCluster: além do kc, precisa do connectionId e do event
// para emitir os chunks do stream de volta ao renderer.
ipcMain.handle('stream-pod-logs', async (event, connectionId, podName, namespace, containerName = null, sinceSeconds = null) => {
  const kc = getCluster(connectionId);
  return LogService.streamPodLogs(kc, connectionId, podName, namespace, containerName, sinceSeconds, event);
});

ipcMain.on('stop-stream-pod-logs', (event, streamId) => {
  LogService.stopLogStream(streamId);
});

handleWithCluster('get-pod-containers', 'buscar containers do pod', async (kc, podName, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.readNamespacedPod(podName, namespace);

  return response.body.spec.containers.map(container => ({
    name: container.name,
    image: container.image,
    ready: response.body.status.containerStatuses?.find(cs => cs.name === container.name)?.ready || false
  }));
});

handleWithCluster('get-pod-details', 'buscar detalhes do pod', async (kc, podName, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.readNamespacedPod(podName, namespace);

  return response.body;
});

// Handler para verificar se o Metrics Server está disponível
ipcMain.handle('check-metrics-server', async (event, connectionId) => {
  try {
    const metricsApi = getCluster(connectionId).makeApiClient(k8s.CustomObjectsApi);

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
    const kc = getCluster(connectionId);

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
    const kc = getCluster(connectionId);

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
handleWithCluster('get-pod-yaml', 'buscar YAML do pod', async (kc, podName, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.readNamespacedPod(podName, namespace);

  return toCleanYaml(response.body);
});

// ============================================================================
// DEPLOYMENT HANDLERS
// ============================================================================

handleWithCluster('get-deployments', 'buscar deployments',
  (kc, namespace = 'default') => DeploymentService.listDeployments(kc, namespace));

handleWithCluster('get-deployment-details', 'buscar detalhes do deployment',
  (kc, name, namespace) => DeploymentService.getDeploymentDetails(kc, name, namespace));

handleWithCluster('get-deployment-yaml', 'buscar YAML do deployment',
  (kc, name, namespace) => DeploymentService.getDeploymentYAML(kc, name, namespace));

handleWithCluster('get-deployment-pods', 'buscar pods do deployment',
  (kc, deploymentName, namespace) => DeploymentService.getDeploymentPods(kc, deploymentName, namespace));

handleWithCluster('scale-deployment', 'escalar deployment',
  (kc, name, namespace, replicas) => DeploymentService.scaleDeployment(kc, name, namespace, replicas));

handleWithCluster('restart-deployment', 'reiniciar deployment',
  (kc, name, namespace) => DeploymentService.restartDeployment(kc, name, namespace));

// ============================================================================
// END DEPLOYMENT HANDLERS
// ============================================================================


// ============================================================================
// NETWORKING HANDLERS (Ingresses / Endpoints)
// ============================================================================

// Concatena os endereços de entrada de um Ingress: os hosts declarados nas
// regras. Sem host a regra vale para qualquer host, o que o kubectl mostra
// como "*".
function ingressHosts(ingress) {
  const rules = ingress.spec?.rules || [];
  const hosts = rules.map(rule => rule.host || '*');

  return [...new Set(hosts)];
}

// Endereços já atribuídos pelo controller (equivalente à coluna ADDRESS do
// kubectl). Fica vazio enquanto o ingress não foi programado.
function ingressAddresses(ingress) {
  const entries = ingress.status?.loadBalancer?.ingress || [];

  return entries.map(entry => entry.ip || entry.hostname).filter(Boolean);
}

// Portas expostas: 80 sempre, 443 quando há bloco TLS — mesma heurística do
// kubectl, já que o Ingress não declara portas explicitamente.
function ingressPorts(ingress) {
  const ports = ['80'];
  if (ingress.spec?.tls?.length) ports.push('443');

  return ports;
}

handleWithCluster('get-ingresses', 'buscar ingresses', async (kc, namespace = 'default') => {
  const k8sApi = kc.makeApiClient(k8s.NetworkingV1Api);
  const response = namespace === 'all'
    ? await k8sApi.listIngressForAllNamespaces()
    : await k8sApi.listNamespacedIngress(namespace);

  return response.body.items.map(ingress => ({
    name: ingress.metadata.name,
    namespace: ingress.metadata.namespace,
    className: ingress.spec?.ingressClassName || '-',
    hosts: ingressHosts(ingress),
    addresses: ingressAddresses(ingress),
    ports: ingressPorts(ingress),
    age: formatAge(ingress.metadata.creationTimestamp),
    creationTimestamp: ingress.metadata.creationTimestamp
  }));
});

handleWithCluster('get-ingress-yaml', 'buscar YAML do ingress', async (kc, name, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.NetworkingV1Api);
  const response = await k8sApi.readNamespacedIngress(name, namespace);

  return toCleanYaml(response.body);
});

// Achata os subsets de um Endpoints em "ip:porta", como a coluna ENDPOINTS do
// kubectl. Cada subset combina todos os seus endereços com todas as suas
// portas.
function endpointAddresses(endpoints) {
  const result = [];

  for (const subset of endpoints.subsets || []) {
    const ports = subset.ports || [];
    for (const address of subset.addresses || []) {
      if (ports.length === 0) {
        result.push(address.ip);
      } else {
        for (const port of ports) result.push(`${address.ip}:${port.port}`);
      }
    }
  }

  return result;
}

handleWithCluster('get-endpoints', 'buscar endpoints', async (kc, namespace = 'default') => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = namespace === 'all'
    ? await k8sApi.listEndpointsForAllNamespaces()
    : await k8sApi.listNamespacedEndpoints(namespace);

  return response.body.items.map(endpoints => ({
    name: endpoints.metadata.name,
    namespace: endpoints.metadata.namespace,
    addresses: endpointAddresses(endpoints),
    // Contagem separada: um Endpoints sem addresses ainda pode ter pods
    // não prontos, e a tela distingue "sem backend" de "backend não pronto".
    notReadyCount: (endpoints.subsets || [])
      .reduce((total, subset) => total + (subset.notReadyAddresses?.length || 0), 0),
    age: formatAge(endpoints.metadata.creationTimestamp),
    creationTimestamp: endpoints.metadata.creationTimestamp
  }));
});

handleWithCluster('get-endpoint-yaml', 'buscar YAML do endpoint', async (kc, name, namespace) => {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const response = await k8sApi.readNamespacedEndpoints(name, namespace);

  return toCleanYaml(response.body);
});

// ============================================================================
// END NETWORKING HANDLERS
// ============================================================================
