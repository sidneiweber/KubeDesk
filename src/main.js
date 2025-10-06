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
      }))
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
        console.log(`Tentando configuração: ${config.name}`);
        response = await k8sApi.readNamespacedPodLog(...config.params);
        console.log(`Sucesso com configuração: ${config.name}`);
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

    console.log(`Logs recebidos: ${response.body ? response.body.length : 0} caracteres`);

    // Debug: mostrar parte do conteúdo bruto
    if (response.body) {
      const preview = response.body.substring(0, 500);
      console.log('Preview do conteúdo bruto:', JSON.stringify(preview));
    }

    // Parsear logs em formato estruturado
    const logs = parseLogs(response.body, podName);

    console.log(`Logs parseados: ${logs.length} entradas`);

    // Debug: mostrar alguns logs parseados
    if (logs.length > 0) {
      console.log('Primeiros 3 logs parseados:');
      logs.slice(0, 3).forEach((log, i) => {
        console.log(`Log ${i + 1}:`, {
          timestamp: log.timestamp,
          hasRealTimestamp: log.hasRealTimestamp,
          isApproximateTimestamp: log.isApproximateTimestamp,
          message: log.message.substring(0, 100) + '...'
        });
      });
    }

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
    console.log('Conteúdo de logs vazio ou nulo');
    return [];
  }

  const lines = logContent.split('\n').filter(line => line.trim());
  console.log(`Processando ${lines.length} linhas de log`);

  // Debug: mostrar as primeiras linhas para entender o formato
  console.log('Primeiras 3 linhas de log:');
  lines.slice(0, 3).forEach((line, i) => {
    console.log(`Linha ${i + 1}:`, JSON.stringify(line));
  });

  const logs = [];

  lines.forEach((line, index) => {
    // Tentar parsear diferentes formatos de log
    let parsedLog = parseLogLine(line, podName, index);
    if (parsedLog) {
      logs.push(parsedLog);
    }
  });

  console.log(`Logs parseados com sucesso: ${logs.length} entradas`);
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
