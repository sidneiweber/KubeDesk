// Garantir que estamos usando o require do Node.js, não do AMD loader do Monaco
const nodeRequire = window.nodeRequire || window.require || require;
const { ipcRenderer } = nodeRequire('electron');
const LogViewer = nodeRequire('./components/LogViewer');

// Estado da aplicação
let currentConnectionId = null;
let currentContext = null;
let kubeconfigPath = null;
let currentSection = 'pods';

// Cache de preferências por cluster
const CACHE_KEY_PREFIX = 'kubedesk_preferences_';

// Funções utilitárias para gerenciar cache de preferências
function getCacheKey(context) {
    return `${CACHE_KEY_PREFIX}${context}`;
}

function saveNamespacePreference(context, namespace) {
    try {
        const cacheKey = getCacheKey(context);
        const preferences = {
            namespace: namespace,
            lastUsed: new Date().toISOString()
        };
        localStorage.setItem(cacheKey, JSON.stringify(preferences));
    } catch (error) {
        console.error('Erro ao salvar preferência de namespace:', error);
    }
}

function loadNamespacePreference(context) {
    try {
        const cacheKey = getCacheKey(context);
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const preferences = JSON.parse(cached);
            return preferences.namespace;
        }
    } catch (error) {
        console.error('Erro ao carregar preferência de namespace:', error);
    }
    return null;
}

function clearOldPreferences() {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // Remover preferências com mais de 30 dias
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_KEY_PREFIX)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data.lastUsed && new Date(data.lastUsed) < cutoffDate) {
                        localStorage.removeItem(key);
                    }
                } catch (e) {
                    // Se não conseguir fazer parse, remove o item corrompido
                    localStorage.removeItem(key);
                }
            }
        }
    } catch (error) {
        console.error('Erro ao limpar preferências antigas:', error);
    }
}


// Auto-refresh configuration
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 10000; // 10 segundos
let autoRefreshEnabled = true;

// Estado dos logs
let currentPodName = null;
let currentPodNamespace = null;
let currentDeploymentName = null;
let currentDeploymentNamespace = null;
let currentServiceName = null;
let currentServiceNamespace = null;
let currentDeploymentPods = [];
let logsStreaming = false;
let logsPaused = false;
let logsData = [];
// Instantes de chegada dos logs, para calcular a taxa real em RATE_WINDOW_MS
let logArrivalTimestamps = [];
let logsRateInterval = null;
const RATE_WINDOW_MS = 5000;
let logsFilter = '';
let currentLogStreamId = null;
let logViewer = null;
let logsOptions = {
    lineWrap: true,
    logColoring: true,
    timestamp: 'off',
    horizontalScroll: false
};

// Estado do YAML
let currentYamlContent = '';
let currentDeploymentYamlContent = '';

// Configurações de performance
const MAX_TOTAL_LOGS = 5000; // Máximo de logs mantidos em memória

// Configurações de colunas
const PODS_COLUMNS = {
    name: { key: 'name', label: 'Nome', visible: true, required: true },
    namespace: { key: 'namespace', label: 'Namespace', visible: true, required: false },
    status: { key: 'status', label: 'Status', visible: true, required: true },
    ready: { key: 'ready', label: 'Ready', visible: true, required: false },
    restarts: { key: 'restarts', label: 'Restarts', visible: true, required: false },
    age: { key: 'age', label: 'Age', visible: true, required: false },
    cpuUsage: { key: 'cpuUsage', label: 'CPU Usage', visible: true, required: false },
    memoryUsage: { key: 'memoryUsage', label: 'Memory Usage', visible: true, required: false },
    node: { key: 'node', label: 'Node', visible: true, required: false },
    ip: { key: 'ip', label: 'IP', visible: true, required: false }
};

const DEPLOYMENTS_COLUMNS = {
    name: { key: 'name', label: 'Nome', visible: true, required: true },
    namespace: { key: 'namespace', label: 'Namespace', visible: true, required: false },
    status: { key: 'status', label: 'Status', visible: true, required: true },
    ready: { key: 'ready', label: 'Ready', visible: true, required: false },
    upToDate: { key: 'upToDate', label: 'Up-to-date', visible: true, required: false },
    available: { key: 'available', label: 'Available', visible: true, required: false },
    age: { key: 'age', label: 'Age', visible: true, required: false },
    images: { key: 'images', label: 'Images', visible: true, required: false }
};

// Elementos DOM
const elements = {
    // Configuração (Setup Screen)
    kubeconfigPathInput: document.getElementById('kubeconfigPath'),
    selectConfigBtn: document.getElementById('selectConfigBtn'),
    clusterSelect: document.getElementById('clusterSelect'),
    connectBtn: document.getElementById('connectBtn'),

    // Status
    connectionStatus: document.getElementById('connectionStatus'),
    mainConnectionStatus: document.getElementById('mainConnectionStatus'),

    // Telas
    setupScreen: document.getElementById('setupScreen'),
    dashboardScreen: document.getElementById('dashboardScreen'),

    // Cluster Info
    currentClusterName: document.getElementById('currentClusterName'),
    currentClusterNamespace: document.getElementById('currentClusterNamespace'),
    reconnectBtn: document.getElementById('reconnectBtn'),

    // Navegação
    navigation: document.getElementById('navigation'),
    navLinks: document.querySelectorAll('.nav-link'),

    // Dashboard
    dashboardHeader: document.querySelector('.dashboard-header'),
    currentContextSpan: document.getElementById('currentContext'),
    currentSectionSpan: document.getElementById('currentSection'),
    currentSectionCount: document.getElementById('currentSectionCount'),
    namespaceSelect: document.getElementById('namespaceSelect'),
    searchInput: document.getElementById('searchInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    autoRefreshBtn: document.getElementById('autoRefreshBtn'),

    // Loading e erro
    loadingIndicator: document.getElementById('loadingIndicator'),
    errorMessage: document.getElementById('errorMessage'),
    errorText: document.getElementById('errorText'),

    // Seções de conteúdo
    podsSection: document.getElementById('podsSection'),
    deploymentsSection: document.getElementById('deploymentsSection'),
    servicesSection: document.getElementById('servicesSection'),
    namespacesSection: document.getElementById('namespacesSection'),
    podLogsSection: document.getElementById('podLogsSection'),
    podDetailsSection: document.getElementById('podDetailsSection'),

    // Tabelas
    podsTableBody: document.getElementById('podsTableBody'),
    deploymentsTableBody: document.getElementById('deploymentsTableBody'),
    servicesTableBody: document.getElementById('servicesTableBody'),
    namespacesTableBody: document.getElementById('namespacesTableBody'),

    // Contadores
    podsCount: document.getElementById('podsCount'),
    deploymentsCount: document.getElementById('deploymentsCount'),
    servicesCount: document.getElementById('servicesCount'),
    namespacesCount: document.getElementById('namespacesCount'),

    // Logs
    backToPodsBtn: document.getElementById('backToPodsBtn'),
    podLogsTitle: document.getElementById('podLogsTitle'),
    logsContent: document.getElementById('logsContent'),
    containerSelect: document.getElementById('containerSelect'),
    logsOptionsBtn: document.getElementById('logsOptionsBtn'),
    logsOptionsMenu: document.getElementById('logsOptionsMenu'),
    lineWrapCheckbox: document.getElementById('lineWrapCheckbox'),
    logColoringCheckbox: document.getElementById('logColoringCheckbox'),
    pauseLogsBtn: document.getElementById('pauseLogsBtn'),
    clearLogsBtn: document.getElementById('clearLogsBtn'),
    logsCount: document.getElementById('logsCount'),
    logsRate: document.getElementById('logsRate'),
    downloadCsvBtn: document.getElementById('downloadCsvBtn'),
    downloadTextBtn: document.getElementById('downloadTextBtn'),
    copyCsvBtn: document.getElementById('copyCsvBtn'),
    copyTextBtn: document.getElementById('copyTextBtn'),

    // Enhanced terminal controls
    terminalSearchInput: document.getElementById('terminalSearchInput'),
    searchPrevBtn: document.getElementById('searchPrevBtn'),
    searchNextBtn: document.getElementById('searchNextBtn'),

    // Column selectors
    podsColumnSelectorBtn: document.getElementById('podsColumnSelectorBtn'),
    deploymentsColumnSelectorBtn: document.getElementById('deploymentsColumnSelectorBtn'),
    podsColumnSelectorModal: document.getElementById('podsColumnSelectorModal'),
    deploymentsColumnSelectorModal: document.getElementById('deploymentsColumnSelectorModal'),
    podsColumnCheckboxes: document.getElementById('podsColumnCheckboxes'),
    deploymentsColumnCheckboxes: document.getElementById('deploymentsColumnCheckboxes'),
    scrollTopBtn: document.getElementById('scrollTopBtn'),
    scrollBottomBtn: document.getElementById('scrollBottomBtn'),

    // Pod Details elements
    podDetailsTitle: document.getElementById('podDetailsTitle'),
    backToPodsFromDetailsBtn: document.getElementById('backToPodsFromDetailsBtn'),
    viewPodLogsBtn: document.getElementById('viewPodLogsBtn'),
    viewPodYAMLBtn: document.getElementById('viewPodYAMLBtn'),
    
    // Service Details elements
    serviceDetailsTitle: document.getElementById('serviceDetailsTitle'),
    backToServicesFromDetailsBtn: document.getElementById('backToServicesFromDetailsBtn'),
    viewServiceYAMLBtn: document.getElementById('viewServiceYAMLBtn'),
    
    // Service YAML elements
    serviceYamlTitle: document.getElementById('serviceYamlTitle'),
    backToServicesFromYamlBtn: document.getElementById('backToServicesFromYamlBtn'),
    podDetailName: document.getElementById('podDetailName'),
    podDetailNamespace: document.getElementById('podDetailNamespace'),
    podDetailStatus: document.getElementById('podDetailStatus'),
    podDetailAge: document.getElementById('podDetailAge'),
    podDetailIP: document.getElementById('podDetailIP'),
    podDetailNode: document.getElementById('podDetailNode'),
    podContainersList: document.getElementById('podContainersList'),
    podLabelsList: document.getElementById('podLabelsList'),
    podEnvVarsList: document.getElementById('podEnvVarsList'),
    podAnnotationsList: document.getElementById('podAnnotationsList'),

    // Pod YAML elements
    podYamlSection: document.getElementById('podYamlSection'),
    podYamlTitle: document.getElementById('podYamlTitle'),
    backToPodsFromYamlBtn: document.getElementById('backToPodsFromYamlBtn'),
    copyYamlBtn: document.getElementById('copyYamlBtn'),
    downloadYamlBtn: document.getElementById('downloadYamlBtn'),
    yamlEditor: document.getElementById('yamlEditor')
};

// Event Listeners
document.addEventListener('DOMContentLoaded', initializeApp);

elements.selectConfigBtn.addEventListener('click', selectKubeconfigFile);
elements.connectBtn.addEventListener('click', connectToCluster);
elements.refreshBtn.addEventListener('click', refreshCurrentSection);
elements.autoRefreshBtn.addEventListener('click', handleAutoRefreshToggle);
elements.searchInput.addEventListener('input', filterCurrentSection);
elements.reconnectBtn.addEventListener('click', showSetupScreen);

// Seletores de colunas
elements.podsColumnSelectorBtn?.addEventListener('click', () => {
    initializeColumnSelector('pods');
    elements.podsColumnSelectorModal.style.display = 'block';
});

elements.deploymentsColumnSelectorBtn?.addEventListener('click', () => {
    initializeColumnSelector('deployments');
    elements.deploymentsColumnSelectorModal.style.display = 'block';
});

// Event listeners para modais de colunas
document.getElementById('podsColumnSelectorClose')?.addEventListener('click', () => {
    elements.podsColumnSelectorModal.style.display = 'none';
});

document.getElementById('podsColumnSelectorCancel')?.addEventListener('click', () => {
    elements.podsColumnSelectorModal.style.display = 'none';
});

document.getElementById('podsColumnSelectorSave')?.addEventListener('click', () => {
    saveColumnConfiguration('pods');
});

document.getElementById('deploymentsColumnSelectorClose')?.addEventListener('click', () => {
    elements.deploymentsColumnSelectorModal.style.display = 'none';
});

document.getElementById('deploymentsColumnSelectorCancel')?.addEventListener('click', () => {
    elements.deploymentsColumnSelectorModal.style.display = 'none';
});

document.getElementById('deploymentsColumnSelectorSave')?.addEventListener('click', () => {
    saveColumnConfiguration('deployments');
});

// Navegação
elements.navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = e.target.dataset.section;
        switchSection(section);
    });
});

// Namespace selector
elements.namespaceSelect.addEventListener('change', () => {
    if (currentConnectionId) {
        // Salvar preferência de namespace para este cluster
        if (currentContext) {
            const selectedNamespace = elements.namespaceSelect.value;
            saveNamespacePreference(currentContext, selectedNamespace);
        }

        // Adicionar classe de loading ao seletor
        elements.namespaceSelect.classList.add('loading');

        // Mostrar loading apenas se não estiver já carregando
        if (!elements.loadingIndicator.style.display || elements.loadingIndicator.style.display === 'none') {
            showLoading(true);
        }

        loadCurrentSection().finally(() => {
            // Remover classe de loading após carregamento
            elements.namespaceSelect.classList.remove('loading');
        });
    }
});

// Logs event listeners
elements.backToPodsBtn.addEventListener('click', () => {
    stopLogsStreaming();
    
    // Verificar se estamos vindo de um deployment ou pod individual
    const wasDeploymentMode = currentDeploymentName && currentDeploymentPods.length > 0;
    
    // Limpar variáveis
    currentDeploymentName = null;
    currentDeploymentNamespace = null;
    currentDeploymentPods = [];
    currentPodName = null;
    currentPodNamespace = null;
    
    // Voltar para a seção apropriada
    // switchSection() já chama loadCurrentSection() automaticamente
    if (wasDeploymentMode) {
        switchSection('deployments');
    } else {
        switchSection('pods');
    }
});

elements.containerSelect.addEventListener('change', async () => {
    if (currentPodName && currentPodNamespace) {
        // streamLogs() lê o container do select apenas ao abrir o stream, então
        // trocar de container exige derrubar o stream atual e abrir outro.
        stopLogsStreaming();
        clearLogs();
        await startLogsStreaming();
    }
});

// Pod Details event listeners
elements.backToPodsFromDetailsBtn.addEventListener('click', () => {
    switchSection('pods');
});

elements.viewPodLogsBtn.addEventListener('click', () => {
    if (currentPodName && currentPodNamespace) {
        // Navegar para a seção de logs
        switchSection('podLogs');
        // Inicializar os logs do pod
        showPodLogs(currentPodName, currentPodNamespace);
    }
});

// Pod YAML event listener
elements.viewPodYAMLBtn?.addEventListener('click', () => {
    if (currentPodName && currentPodNamespace) {
        showPodYaml(currentPodName, currentPodNamespace);
    }
});

// Service Details event listeners
elements.backToServicesFromDetailsBtn.addEventListener('click', () => {
    switchSection('services');
});

elements.viewServiceYAMLBtn.addEventListener('click', () => {
    if (currentServiceName && currentServiceNamespace) {
        showServiceYAML(currentServiceName, currentServiceNamespace);
    }
});

// Service YAML event listeners
elements.backToServicesFromYamlBtn.addEventListener('click', () => {
    switchSection('services');
});

// Pod YAML event listeners
elements.backToPodsFromYamlBtn.addEventListener('click', () => {
    switchSection('pods');
});

elements.copyYamlBtn.addEventListener('click', () => {
    copyYamlToClipboard();
});

elements.downloadYamlBtn.addEventListener('click', () => {
    downloadYaml();
});

elements.logsOptionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = elements.logsOptionsMenu;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

elements.pauseLogsBtn.addEventListener('click', () => {
    if (logsPaused) {
        resumeLogsStreaming();
    } else {
        pauseLogsStreaming();
    }
});

elements.clearLogsBtn.addEventListener('click', () => {
    clearLogs();
});

elements.lineWrapCheckbox.addEventListener('change', (e) => {
    logsOptions.lineWrap = e.target.checked;
    if (e.target.checked) {
        // Desmarcar scroll horizontal se quebra de linha estiver ativa
        elements.horizontalScrollCheckbox.checked = false;
        logsOptions.horizontalScroll = false;
    }
    updateLogsDisplay();
});

elements.logColoringCheckbox.addEventListener('change', (e) => {
    logsOptions.logColoring = e.target.checked;
    updateLogsDisplay();
});

elements.horizontalScrollCheckbox = document.getElementById('horizontalScrollCheckbox');
elements.horizontalScrollCheckbox.addEventListener('change', (e) => {
    logsOptions.horizontalScroll = e.target.checked;
    if (e.target.checked) {
        // Desmarcar quebra de linha se scroll horizontal estiver ativo
        elements.lineWrapCheckbox.checked = false;
        logsOptions.lineWrap = false;
    }
    updateLogsDisplay();
});

document.querySelectorAll('input[name="timestamp"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        logsOptions.timestamp = e.target.value;
        updateLogsDisplay();
    });
});

elements.downloadCsvBtn.addEventListener('click', () => downloadLogs('csv'));
elements.downloadTextBtn.addEventListener('click', () => downloadLogs('text'));
elements.copyCsvBtn.addEventListener('click', () => copyLogs('csv'));
elements.copyTextBtn.addEventListener('click', () => copyLogs('text'));

// Event listener para mudança de container (reiniciar streaming)
if (elements.containerSelect) {
    elements.containerSelect.addEventListener('change', () => {
        if (logsStreaming) {
            // Se estamos vendo logs de um deployment
            if (currentDeploymentName && currentDeploymentPods.length > 0) {
                startDeploymentLogsStreaming(currentDeploymentName, currentDeploymentNamespace, currentDeploymentPods);
            }
            // Se estamos vendo logs de um pod individual
            else if (currentPodName) {
                startLogsStreaming();
            }
        }
    });
}

// Enhanced terminal controls
elements.terminalSearchInput.addEventListener('input', (e) => {
    if (logViewer) {
        logViewer.search(e.target.value);
    }
});

elements.terminalSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (e.shiftKey) {
            elements.searchPrevBtn.click();
        } else {
            elements.searchNextBtn.click();
        }
    }
});

elements.searchPrevBtn.addEventListener('click', () => {
    if (logViewer) {
        logViewer.searchPrevious();
    }
});

elements.searchNextBtn.addEventListener('click', () => {
    if (logViewer) {
        logViewer.searchNext();
    }
});


elements.scrollTopBtn.addEventListener('click', () => {
    if (logViewer) {
        logViewer.scrollToTop();
    }
});

elements.scrollBottomBtn.addEventListener('click', () => {
    if (logViewer) {
        logViewer.scrollToBottom();
    }
});

// Fechar menu de opções ao clicar fora
document.addEventListener('click', (e) => {
    if (!elements.logsOptionsBtn.contains(e.target) && !elements.logsOptionsMenu.contains(e.target)) {
        elements.logsOptionsMenu.style.display = 'none';
    }
});

// Listeners para streaming de logs
ipcRenderer.on('log-stream-data', (event, { streamId, podName, log }) => {
    // Para deployments, aceitar qualquer streamId se estivermos em modo deployment
    const isDeploymentMode = currentDeploymentName && currentDeploymentPods.length > 0;
    if (!logsStreaming || logsPaused) return;
    if (!isDeploymentMode && streamId !== currentLogStreamId) return;

    // Remover mensagens de "aguardando" quando os primeiros logs reais chegarem
    const hadWaitingMessages = logsData.some(log => 
        log.id === 'waiting-logs' || 
        log.id === 'waiting-deployment-logs' ||
        log.id === 'start-deployment-logs' ||
        log.id === 'streaming-ready'
    );
    
    if (hadWaitingMessages) {
        logsData = logsData.filter(log => 
            log.id !== 'waiting-logs' && 
            log.id !== 'waiting-deployment-logs' &&
            log.id !== 'start-deployment-logs' &&
            log.id !== 'streaming-ready'
        );
        if (logViewer) {
            logViewer.clear();
            // Re-adicionar todos os logs exceto as mensagens de aguardando
            logsData.forEach(log => logViewer.addLog(log));
        }
    }

    const lines = log.split('\n').filter(line => line.trim() !== '');

    lines.forEach(line => {
        // Tenta extrair timestamp do Kubernetes
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s/);
        let timestamp;
        let message;
        let hasRealTimestamp = false;

        if (tsMatch) {
            timestamp = tsMatch[1];
            message = line.substring(tsMatch[0].length);
            hasRealTimestamp = true;
        } else {
            timestamp = new Date().toISOString();
            message = line;
        }

        const logEntry = {
            id: `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: timestamp,
            hasRealTimestamp: hasRealTimestamp,
            isApproximateTimestamp: !hasRealTimestamp,
            level: 'info',
            message: message,
            raw: line,
            podName: podName || currentPodName  // Usar podName do backend se disponível, senão currentPodName
        };

        if (message.toLowerCase().includes('error') || message.toLowerCase().includes('fatal')) {
            logEntry.level = 'error';
        } else if (message.toLowerCase().includes('warn') || message.toLowerCase().includes('warning')) {
            logEntry.level = 'warning';
        } else if (message.toLowerCase().includes('debug')) {
            logEntry.level = 'debug';
        }

        // Adicionar log aos dados e ao LogViewer
        addLogEntry(logEntry);
    });

    updateLogsStats();
});

ipcRenderer.on('log-stream-error', (event, { streamId, message }) => {
    const isDeploymentMode = currentDeploymentName && currentDeploymentPods.length > 0;
    if (!isDeploymentMode && streamId !== currentLogStreamId) return;
    console.error(`Log stream error for ${streamId}:`, message);
    const errorEntry = {
        id: 'stream-error',
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `STREAM ERROR: ${message}`,
        raw: `STREAM ERROR: ${message}`
    };
    addLogEntry(errorEntry);
    stopLogsStreaming(); // Stop on error
});

ipcRenderer.on('log-stream-end', (event, { streamId }) => {
    const isDeploymentMode = currentDeploymentName && currentDeploymentPods.length > 0;
    if (!isDeploymentMode && streamId !== currentLogStreamId) return;
    const endEntry = {
        id: 'stream-end',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Log stream finished.',
        raw: 'Log stream finished.'
    };
    addLogEntry(endEntry);

    currentLogStreamId = null;
    logsStreaming = false;
});

function initializeSections() {
    // Garantir que todas as seções estejam escondidas inicialmente
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    // Ativar apenas a seção de pods
    const podsSection = document.getElementById('podsSection');
    if (podsSection) {
        podsSection.classList.add('active');
    }

    // Garantir que o header esteja visível
    if (elements.dashboardHeader) {
        elements.dashboardHeader.classList.remove('hidden');
    }

    // Atualizar navegação
    elements.navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.dataset.section === 'pods') {
            link.classList.add('active');
        }
    });

    // Garantir que não há LogViewer ativo inicialmente
    if (logViewer) {
        try {
            logViewer.destroy();
        } catch (error) {
            console.warn('Erro ao destruir LogViewer na inicialização:', error);
        }
        logViewer = null;
    }

    // Limpar conteúdo de logs se houver
    const logsContent = document.getElementById('logsContent');
    if (logsContent) {
        logsContent.innerHTML = '';
    }
}

async function initializeApp() {
    try {
        // Limpar preferências antigas na inicialização
        clearOldPreferences();

        // Inicializar configurações de colunas
        initializeColumnPreferences();

        // Mostrar tela de setup por padrão
        showSetupScreen();

        // Inicializar botão de auto-refresh
        updateAutoRefreshButton(autoRefreshEnabled);

        // Garantir que apenas a seção de pods esteja ativa inicialmente
        initializeSections();

        // Carregar caminho padrão do kubeconfig
        const defaultPath = await ipcRenderer.invoke('get-kubeconfig-path');
        elements.kubeconfigPathInput.value = defaultPath;
        kubeconfigPath = defaultPath;

        // Tentar carregar configuração automaticamente
        await loadKubeconfig();
    } catch (error) {
        console.error('Erro ao inicializar:', error);
        showError('Erro ao inicializar aplicação: ' + error.message);
    }
}

async function selectKubeconfigFile() {
    try {
        const selectedPath = await ipcRenderer.invoke('select-kubeconfig-file');
        if (selectedPath) {
            elements.kubeconfigPathInput.value = selectedPath;
            kubeconfigPath = selectedPath;
            await loadKubeconfig();
        }
    } catch (error) {
        showError('Erro ao selecionar arquivo kubeconfig: ' + error.message);
    }
}

async function loadKubeconfig() {
    try {
        if (!kubeconfigPath) return;

        showLoading(true);

        const config = await ipcRenderer.invoke('load-kubeconfig', kubeconfigPath);

        // Limpar seleção anterior
        elements.clusterSelect.innerHTML = '<option value="">Selecione um cluster</option>';

        // Adicionar clusters disponíveis
        config.contexts.forEach(context => {
            const option = document.createElement('option');
            option.value = context.name;
            option.textContent = `${context.name} (${context.namespace})`;
            elements.clusterSelect.appendChild(option);
        });

        // Selecionar contexto atual se disponível
        if (config.currentContext) {
            elements.clusterSelect.value = config.currentContext;
        }

        elements.clusterSelect.disabled = false;
        elements.connectBtn.disabled = false;

        showLoading(false);
    } catch (error) {
        showError('Erro ao carregar kubeconfig: ' + error.message);
        showLoading(false);
    }
}

async function connectToCluster() {
    try {
        const selectedContext = elements.clusterSelect.value;
        if (!selectedContext || !kubeconfigPath) {
            showError('Por favor, selecione um cluster');
            return;
        }

        showLoading(true);

        const connection = await ipcRenderer.invoke('connect-to-cluster', kubeconfigPath, selectedContext);

        currentConnectionId = connection.connectionId;
        currentContext = connection.context;

        // Atualizar interface
        updateConnectionStatus(true);
        showDashboard();

        // Atualizar informações do cluster
        updateClusterInfo();

        // Carregar namespaces e dados iniciais (sem bloquear a transição)
        try {
            await loadNamespaces();
            await loadCurrentSection();
        } catch (error) {
            console.error('Erro ao carregar dados iniciais:', error);
            // Não mostrar erro aqui para não interromper a transição
        }

        // Iniciar auto-refresh quando conectado
        startAutoRefresh();

        showLoading(false);
    } catch (error) {
        showError('Erro ao conectar ao cluster: ' + error.message);
        showLoading(false);
    }
}

async function loadNamespaces() {
    try {
        const namespaces = await ipcRenderer.invoke('get-namespaces', currentConnectionId);

        // Limpar e adicionar namespaces ao dropdown
        elements.namespaceSelect.innerHTML = '<option value="all">Todos os namespaces</option>';

        namespaces.forEach(ns => {
            const option = document.createElement('option');
            option.value = ns.name;
            option.textContent = ns.name;
            elements.namespaceSelect.appendChild(option);
        });

        // Carregar preferência de namespace salva para este cluster
        if (currentContext) {
            const savedNamespace = loadNamespacePreference(currentContext);
            if (savedNamespace) {
                // Verificar se o namespace salvo ainda existe
                const namespaceExists = namespaces.some(ns => ns.name === savedNamespace) || savedNamespace === 'all';
                if (namespaceExists) {
                    elements.namespaceSelect.value = savedNamespace;
                    console.log(`Namespace preferido restaurado: ${savedNamespace}`);
                } else {
                    console.log(`Namespace preferido '${savedNamespace}' não encontrado, usando padrão`);
                }
            }
        }

        // Populate namespaces table if we're in the namespaces section
        if (currentSection === 'namespaces') {
            populateNamespacesTable(namespaces);
        }

        // Atualizar contador de namespaces
        elements.namespacesCount.textContent = `${namespaces.length} namespaces`;

    } catch (error) {
        console.error('Erro ao carregar namespaces:', error);
        throw error; // Re-throw para que seja capturado pelo loadCurrentSection
    }
}

function populateNamespacesTable(namespaces) {
    // Limpar tabela de namespaces
    elements.namespacesTableBody.innerHTML = '';

    if (namespaces.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="3" class="no-data">
                <div class="no-data-message">
                    <span class="no-data-icon">📁</span>
                    <p>Nenhum namespace encontrado</p>
                </div>
            </td>
        `;
        elements.namespacesTableBody.appendChild(row);
        return;
    }

    namespaces.forEach(ns => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="namespace-name">${ns.name}</td>
            <td><span class="status-${ns.status.toLowerCase()}">${ns.status}</span></td>
            <td>${ns.age}</td>
        `;
        elements.namespacesTableBody.appendChild(row);
    });
}

async function loadDeployments() {
    try {
        const namespace = elements.namespaceSelect.value;
        const deployments = await ipcRenderer.invoke('get-deployments', currentConnectionId, namespace);

        // Filtrar deployments se necessário
        const searchTerm = elements.searchInput.value.toLowerCase().trim();
        let filteredDeployments = deployments;

        if (searchTerm) {
            filteredDeployments = deployments.filter(deployment =>
                deployment.name.toLowerCase().includes(searchTerm) ||
                deployment.namespace.toLowerCase().includes(searchTerm) ||
                deployment.strategy.toLowerCase().includes(searchTerm)
            );
        }

        // Limpar tabela
        elements.deploymentsTableBody.innerHTML = '';

        // Verificar se há deployments para exibir
        if (filteredDeployments.length === 0) {
            const message = searchTerm
                ? 'Nenhum deployment encontrado com o termo de busca'
                : (elements.namespaceSelect.value === 'all'
                    ? 'Nenhum deployment encontrado em nenhum namespace'
                    : `Nenhum deployment encontrado no namespace "${elements.namespaceSelect.value}"`);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="9" class="no-data">
                    <div class="no-data-message">
                        <span class="no-data-icon">🚀</span>
                        <p>${message}</p>
                    </div>
                </td>
            `;
            elements.deploymentsTableBody.appendChild(row);
            elements.deploymentsCount.textContent = `0 deployments`;
            return;
        }

        // Adicionar deployments à tabela
        filteredDeployments.forEach(deployment => {
            const row = document.createElement('tr');
            row.dataset.deploymentName = deployment.name;
            row.dataset.deploymentNamespace = deployment.namespace;

            // Determinar status baseado nas réplicas
            const statusClass = deployment.readyReplicas === deployment.replicas && deployment.replicas > 0 
                ? 'running' 
                : (deployment.readyReplicas > 0 ? 'pending' : 'failed');
            const statusText = deployment.readyReplicas === deployment.replicas && deployment.replicas > 0
                ? 'Ready'
                : (deployment.readyReplicas > 0 ? 'Progressing' : 'Unavailable');

            // Namespace badge se visualizando todos os namespaces
            const namespaceDisplay = elements.namespaceSelect.value === 'all'
                ? `<span class="namespace-badge">${deployment.namespace}</span>`
                : deployment.namespace;

            // Imagens dos containers
            const images = deployment.containerImages
                .map(c => `<div class="container-image" title="${c.name}: ${c.image}">${c.image}</div>`)
                .join('');

            // Criar células baseadas na ordem das colunas visíveis
            const cells = [];
            
            // Definir a ordem das colunas conforme definido em DEPLOYMENTS_COLUMNS
            const columnOrder = [
                { key: 'name', content: `<td class="deployment-name" data-deployment-name="${deployment.name}" data-deployment-namespace="${deployment.namespace}"><span class="deployment-name-link">${deployment.name}</span></td>` },
                { key: 'namespace', content: `<td class="deployment-namespace">${namespaceDisplay}</td>` },
                { key: 'status', content: `<td><span class="status-${statusClass}">${statusText}</span></td>` },
                { key: 'ready', content: `<td><span class="${deployment.readyReplicas === deployment.replicas ? 'ready-ready' : 'ready-not-ready'}">${deployment.ready}</span></td>` },
                { key: 'upToDate', content: `<td>${deployment.upToDate}</td>` },
                { key: 'available', content: `<td>${deployment.available}</td>` },
                { key: 'age', content: `<td>${deployment.age}</td>` },
                { key: 'images', content: `<td class="deployment-images">${images || '-'}</td>` }
            ];
            
            // Adicionar apenas as colunas visíveis na ordem correta
            columnOrder.forEach(column => {
                if (DEPLOYMENTS_COLUMNS[column.key].visible) {
                    cells.push(column.content);
                }
            });

            row.innerHTML = cells.join('');
            
            // Adicionar event listeners
            const deploymentNameCell = row.querySelector('.deployment-name');
            if (deploymentNameCell) {
                // Context menu para nome do deployment
                deploymentNameCell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const deploymentName = deploymentNameCell.dataset.deploymentName;
                    const namespace = deploymentNameCell.dataset.deploymentNamespace;
                    showDeploymentContextMenu(e, deploymentName, namespace);
                });
            }
            
            // Click no nome do deployment para abrir detalhes
            const deploymentNameLink = row.querySelector('.deployment-name-link');
            if (deploymentNameLink) {
                deploymentNameLink.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const deploymentName = row.querySelector('.deployment-name').dataset.deploymentName;
                    const namespace = row.querySelector('.deployment-name').dataset.deploymentNamespace;
                    showDeploymentDetails(deploymentName, namespace);
                });
            }
            
            elements.deploymentsTableBody.appendChild(row);
        });

        // Adicionar event listeners aos botões
        elements.deploymentsTableBody.querySelectorAll('.logs-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                console.log(`Ver logs do deployment: ${name} no namespace: ${namespace}`);
                showToast(`Funcionalidade de logs em desenvolvimento`, 'info');
            });
        });

        elements.deploymentsTableBody.querySelectorAll('.details-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                showToast(`Funcionalidade de detalhes em desenvolvimento`, 'info');
            });
        });

        elements.deploymentsTableBody.querySelectorAll('.yaml-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                await showDeploymentYAML(name, namespace);
            });
        });

        // Atualizar contador
        elements.deploymentsCount.textContent = `${filteredDeployments.length} deployment${filteredDeployments.length !== 1 ? 's' : ''}`;
        
        // Atualizar breadcrumb se estivermos na seção de deployments
        if (currentSection === 'deployments') {
            updateBreadcrumbCount('deployments');
        }

    } catch (error) {
        console.error('Erro ao carregar deployments:', error);
        throw error;
    }
}

async function loadServices() {
    try {
        const namespace = elements.namespaceSelect.value;
        const services = await ipcRenderer.invoke('get-services', currentConnectionId, namespace);

        // Filtrar services se necessário
        const searchTerm = elements.searchInput.value.toLowerCase().trim();
        let filteredServices = services;

        if (searchTerm) {
            filteredServices = services.filter(service =>
                service.metadata.name.toLowerCase().includes(searchTerm) ||
                service.metadata.namespace.toLowerCase().includes(searchTerm) ||
                service.spec.type.toLowerCase().includes(searchTerm) ||
                (service.spec.clusterIP && service.spec.clusterIP.toLowerCase().includes(searchTerm))
            );
        }

        // Limpar tabela
        elements.servicesTableBody.innerHTML = '';

        // Verificar se há services para exibir
        if (filteredServices.length === 0) {
            const message = searchTerm
                ? 'Nenhum service encontrado com o termo de busca'
                : (elements.namespaceSelect.value === 'all'
                    ? 'Nenhum service encontrado em nenhum namespace'
                    : `Nenhum service encontrado no namespace "${elements.namespaceSelect.value}"`);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="8" class="no-data">
                    <div class="no-data-message">
                        <span class="no-data-icon">🔗</span>
                        <p>${message}</p>
                    </div>
                </td>
            `;
            elements.servicesTableBody.appendChild(row);
            elements.currentSectionCount.textContent = `0 services`;
            return;
        }

        // Adicionar services à tabela
        for (const service of filteredServices) {
            const row = document.createElement('tr');
            row.dataset.serviceName = service.metadata.name;
            row.dataset.serviceNamespace = service.metadata.namespace;

            // Calcular idade
            const age = calculateAge(service.metadata.creationTimestamp);
            
            // Formatar portas
            const ports = service.spec.ports ? service.spec.ports.map(port => 
                `${port.port}:${port.targetPort || port.port}/${port.protocol || 'TCP'}`
            ).join(', ') : '-';

            // Namespace badge se visualizando todos os namespaces
            const namespaceDisplay = elements.namespaceSelect.value === 'all'
                ? `<span class="namespace-badge">${service.metadata.namespace}</span>`
                : service.metadata.namespace;

            // Formatar External IP
            const externalIPs = service.spec.externalIPs && service.spec.externalIPs.length > 0 
                ? service.spec.externalIPs.join(', ') 
                : (service.spec.type === 'LoadBalancer' && service.status && service.status.loadBalancer && service.status.loadBalancer.ingress 
                    ? service.status.loadBalancer.ingress.map(ingress => ingress.ip || ingress.hostname).join(', ')
                    : '-');

            row.innerHTML = `
                <td><span class="service-name-link" data-service-name="${service.metadata.name}" data-service-namespace="${service.metadata.namespace}">${service.metadata.name}</span></td>
                <td>${namespaceDisplay}</td>
                <td>${service.spec.type}</td>
                <td>${service.spec.clusterIP || '-'}</td>
                <td>${externalIPs}</td>
                <td>${ports}</td>
                <td>${age}</td>
            `;
            
            // Adicionar evento de clique direito na linha para abrir menu de contexto
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showServiceContextMenu(e, service.metadata.name, service.metadata.namespace);
            });

            // Click no nome do service para abrir detalhes
            const serviceNameLink = row.querySelector('.service-name-link');
            if (serviceNameLink) {
                serviceNameLink.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const serviceName = serviceNameLink.dataset.serviceName;
                    const namespace = serviceNameLink.dataset.serviceNamespace;
                    showServiceDetails(serviceName, namespace);
                });
            }
            
            elements.servicesTableBody.appendChild(row);
        }

        // Atualizar contador
        elements.currentSectionCount.textContent = `${filteredServices.length} services`;

    } catch (error) {
        console.error('Erro ao carregar services:', error);
        throw error;
    }
}

function calculateAge(creationTimestamp) {
    if (!creationTimestamp) return '-';
    
    const now = new Date();
    const created = new Date(creationTimestamp);
    const diffMs = now - created;
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    if (diffMinutes > 0) return `${diffMinutes}m`;
    return '<1m';
}

// Abre um menu de contexto na posição do clique. Cada item é
// { icon, label, action }; action roda ao clicar, com o menu já fechado.
function showContextMenu(event, items) {
    event.stopPropagation();

    document.querySelector('.context-menu')?.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;
    menu.style.zIndex = '1000';

    const close = () => {
        menu.remove();
        document.removeEventListener('click', onDocumentClick);
    };

    const onDocumentClick = (e) => {
        if (!menu.contains(e.target)) close();
    };

    for (const { icon, label, action } of items) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';

        const iconEl = document.createElement('i');
        iconEl.className = `bi ${icon}`;
        item.append(iconEl, ` ${label}`);

        item.addEventListener('click', () => {
            close();
            action();
        });

        menu.appendChild(item);
    }

    document.body.appendChild(menu);

    // O clique que abriu o menu ainda está propagando; adiar evita fechá-lo na hora
    setTimeout(() => document.addEventListener('click', onDocumentClick), 100);
}

function showServiceContextMenu(event, serviceName, namespace) {
    showContextMenu(event, [
        { icon: 'bi-eye', label: 'Ver Detalhes', action: () => showServiceDetails(serviceName, namespace) },
        { icon: 'bi-file-code', label: 'Ver YAML', action: () => showServiceYAML(serviceName, namespace) }
    ]);
}

async function showServiceDetails(serviceName, namespace) {
    try {
        showLoading(true);
        
        // Armazenar service atual
        currentServiceName = serviceName;
        currentServiceNamespace = namespace;
        
        // Buscar detalhes do service
        const service = await ipcRenderer.invoke('get-service', currentConnectionId, serviceName, namespace);
        
        // Atualizar título
        elements.serviceDetailsTitle.textContent = `Detalhes do Service: ${serviceName}`;
        
        // Mostrar seção de detalhes
        switchSection('serviceDetails');
        
        // Preencher detalhes
        if (window.serviceDetails) {
            window.serviceDetails.showDetails(service);
        }
        
        showLoading(false);
    } catch (error) {
        console.error('Erro ao exibir detalhes do service:', error);
        showError(`Erro ao exibir detalhes: ${error.message}`);
        showLoading(false);
    }
}

async function showServiceYAML(serviceName, namespace) {
    try {
        showLoading(true);
        
        // Armazenar service atual
        currentServiceName = serviceName;
        currentServiceNamespace = namespace;
        
        // Atualizar título
        elements.serviceYamlTitle.textContent = `YAML do Service: ${serviceName}`;
        
        // Buscar YAML do service
        const yamlContent = await ipcRenderer.invoke('get-service-yaml', currentConnectionId, serviceName, namespace);
        
        if (!yamlContent) {
            showToast('Não foi possível obter o YAML do service', 'error');
            return;
        }
        
        // Mostrar seção de YAML
        switchSection('serviceYaml');

        renderYamlEditor('serviceYamlContent', yamlContent);

        setupYAMLButtons({
            backBtnId: 'backToServicesFromYamlBtn',
            copyBtnId: 'copyServiceYamlBtn',
            downloadBtnId: 'downloadServiceYamlBtn',
            backSection: 'services',
            name: serviceName,
            namespace,
            yaml: yamlContent
        });

        showLoading(false);
    } catch (error) {
        console.error('Erro ao exibir YAML do service:', error);
        showError(`Erro ao exibir YAML: ${error.message}`);
        showLoading(false);
    }
}


// Baixa conteúdo como arquivo via blob temporário.
function downloadBlob(content, filename, mimeType = 'text/plain') {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Renderiza YAML com realce de sintaxe no container indicado.
function renderYamlEditor(containerId, yamlContent) {
    const editorContainer = document.getElementById(containerId);
    if (!editorContainer) {
        console.error(`Container do editor YAML não encontrado: ${containerId}`);
        return;
    }

    editorContainer.innerHTML = '';

    const pre = document.createElement('pre');
    pre.className = 'line-numbers';
    const code = document.createElement('code');
    code.className = 'language-yaml';
    code.textContent = yamlContent;
    pre.appendChild(code);
    editorContainer.appendChild(pre);

    if (typeof Prism !== 'undefined') {
        Prism.highlightElement(code);
    }
}

// Devolve o botão sem os listeners de aberturas anteriores da tela.
function resetButton(id) {
    const btn = document.getElementById(id);
    if (!btn) return null;

    btn.replaceWith(btn.cloneNode(true));
    return document.getElementById(id);
}

// Liga os botões voltar/copiar/baixar de uma tela de YAML.
function setupYAMLButtons({ backBtnId, copyBtnId, downloadBtnId, backSection, name, namespace, yaml }) {
    resetButton(backBtnId)?.addEventListener('click', () => {
        switchSection(backSection);
        loadCurrentSection();
    });

    resetButton(copyBtnId)?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(yaml);
            showToast('YAML copiado para a área de transferência!', 'success');
        } catch (error) {
            console.error('Erro ao copiar YAML:', error);
            showToast('Erro ao copiar YAML', 'error');
        }
    });

    resetButton(downloadBtnId)?.addEventListener('click', () => {
        try {
            downloadBlob(yaml, `${name}-${namespace}.yaml`, 'text/yaml');
            showToast('YAML baixado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao baixar YAML:', error);
            showToast('Erro ao baixar YAML', 'error');
        }
    });
}

async function showDeploymentYAML(name, namespace) {
    try {
        showLoading(true);
        
        // Buscar YAML do deployment
        const yaml = await ipcRenderer.invoke('get-deployment-yaml', currentConnectionId, name, namespace);
        
        if (!yaml) {
            showToast('Não foi possível obter o YAML do deployment', 'error');
            return;
        }
        
        // Atualizar título
        const yamlTitle = document.getElementById('deploymentYAMLTitle');
        if (yamlTitle) {
            yamlTitle.textContent = `YAML: ${name} (${namespace})`;
        }
        
        // Armazenar conteúdo para botões
        currentDeploymentYamlContent = yaml;
        
        // Mudar para a seção de YAML
        switchSection('deploymentYAML');

        renderYamlEditor('deploymentYamlEditor', yaml);

        setupYAMLButtons({
            backBtnId: 'backToDeploymentDetailsBtn',
            copyBtnId: 'copyDeploymentYamlBtn',
            downloadBtnId: 'downloadDeploymentYamlBtn',
            backSection: 'deployments',
            name,
            namespace,
            yaml
        });

        showLoading(false);
    } catch (error) {
        console.error('Erro ao exibir YAML do deployment:', error);
        showError(`Erro ao exibir YAML: ${error.message}`);
    }
}

async function loadCurrentSection() {
    if (!currentConnectionId) return;

    try {
        showLoading(true);
        hideError();

        switch (currentSection) {
            case 'pods':
                updateTableHeaders('pods');
                await loadPods();
                break;
            case 'deployments':
                updateTableHeaders('deployments');
                await loadDeployments();
                break;
            case 'services':
                await loadServices();
                break;
            case 'namespaces':
                await loadNamespaces();
                break;
        }

        showLoading(false);
    } catch (error) {
        showError('Erro ao carregar dados: ' + error.message);
        showLoading(false);
    }
}

// Função para atualizar apenas os dados da tabela sem recriar estrutura
async function updatePodsData() {
    try {
        const namespace = elements.namespaceSelect.value;
        const pods = await ipcRenderer.invoke('get-pods', currentConnectionId, namespace);

        // Filtrar pods se necessário
        const searchTerm = elements.searchInput.value.toLowerCase().trim();
        let filteredPods = pods;

        if (searchTerm) {
            filteredPods = pods.filter(pod =>
                pod.name.toLowerCase().includes(searchTerm) ||
                pod.namespace.toLowerCase().includes(searchTerm) ||
                pod.status.toLowerCase().includes(searchTerm) ||
                pod.node?.toLowerCase().includes(searchTerm) ||
                pod.ip?.toLowerCase().includes(searchTerm)
            );
        }

        // Verificar se há pods para exibir
        if (filteredPods.length === 0) {
            // Limpar tabela se não há pods
            elements.podsTableBody.innerHTML = '';
            const namespaceInfo = elements.namespaceSelect.value === 'all'
                ? 'em nenhum namespace'
                : `no namespace "${elements.namespaceSelect.value}"`;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="10" class="no-data">
                    <div class="no-data-message">
                        <span class="no-data-icon">📦</span>
                        <p>Nenhum pod encontrado ${namespaceInfo}</p>
                    </div>
                </td>
            `;
            elements.podsTableBody.appendChild(row);
            elements.podsCount.textContent = `0 pods`;
            return;
        }

        // Buscar métricas de recursos para todos os pods em batch
        let podsWithMetrics;
        try {
            const batchResults = await ipcRenderer.invoke('get-pods-metrics-batch', currentConnectionId, filteredPods);
            podsWithMetrics = batchResults.map(result => ({ ...result.pod, metrics: result.metrics }));
        } catch (error) {
            console.error('Erro ao buscar métricas em batch, usando fallback individual:', error);
            // Fallback para chamadas individuais se o batch falhar
            podsWithMetrics = await Promise.all(
                filteredPods.map(async (pod) => {
                    try {
                        const metrics = await ipcRenderer.invoke('get-pod-metrics', currentConnectionId, pod.name, pod.namespace);
                        return { ...pod, metrics };
                    } catch (error) {
                        console.error(`Erro ao buscar métricas para pod ${pod.name}:`, error);
                        return { 
                            ...pod, 
                            metrics: {
                                cpu: { current: '0m', requests: null, percentage: 0 },
                                memory: { current: '0Mi', requests: null, percentage: 0 }
                            }
                        };
                    }
                })
            );
        }

        // Verificar se o número de colunas mudou (indicando mudança de configuração)
        const currentVisibleColumns = Object.values(PODS_COLUMNS).filter(col => col.visible).length;
        const existingRows = elements.podsTableBody.querySelectorAll('tr');
        const firstRow = existingRows[0];
        const currentColumnCount = firstRow ? firstRow.querySelectorAll('td').length : 0;
        
        // Se o número de colunas mudou, recriar todas as linhas
        if (currentColumnCount !== currentVisibleColumns && currentColumnCount > 0) {
            // Limpar tabela e recriar todas as linhas
            elements.podsTableBody.innerHTML = '';
            podsWithMetrics.forEach(pod => {
                const row = createPodRow(pod);
                elements.podsTableBody.appendChild(row);
            });
        } else {
            // Atualizar dados existentes ou criar novos
            await updateOrCreatePodRows(podsWithMetrics);
        }

        // Atualizar contador
        const namespaceInfo = elements.namespaceSelect.value === 'all'
            ? 'todos os namespaces'
            : `namespace: ${elements.namespaceSelect.value}`;
        elements.podsCount.textContent = `${filteredPods.length} pods`;

    } catch (error) {
        throw new Error('Erro ao atualizar dados dos pods: ' + error.message);
    }
}

// Função para atualizar ou criar linhas da tabela
async function updateOrCreatePodRows(podsWithMetrics) {
    const existingRows = Array.from(elements.podsTableBody.querySelectorAll('tr'));
    const podMap = new Map();
    
    // Criar mapa dos pods atuais
    podsWithMetrics.forEach(pod => {
        podMap.set(pod.name, pod);
    });

    // Atualizar linhas existentes
    existingRows.forEach(row => {
        const podNameCell = row.querySelector('.pod-name');
        if (podNameCell) {
            const podName = podNameCell.dataset.podName;
            const pod = podMap.get(podName);
            
            if (pod) {
                updatePodRow(row, pod);
                podMap.delete(podName); // Marcar como processado
            } else {
                // Pod não existe mais, remover linha
                row.remove();
            }
        }
    });

    // Adicionar novos pods
    for (const pod of podMap.values()) {
        const row = createPodRow(pod);
        elements.podsTableBody.appendChild(row);
    }
}

// Função para atualizar uma linha existente
function updatePodRow(row, pod) {
    // Destacar namespace quando visualizando todos os namespaces
    const namespaceDisplay = elements.namespaceSelect.value === 'all'
        ? `<span class="namespace-badge">${pod.namespace}</span>`
        : pod.namespace;

    // Renderizar barras de progresso de recursos
    const cpuBar = renderResourceProgressBar(
        pod.metrics.cpu.current,
        pod.metrics.cpu.requests,
        pod.metrics.cpu.percentage,
        'cpu',
        pod.metrics.cpu.limits
    );
    
    const memoryBar = renderResourceProgressBar(
        pod.metrics.memory.current,
        pod.metrics.memory.requests,
        pod.metrics.memory.percentage,
        'memory',
        pod.metrics.memory.limits
    );

    // Atualizar conteúdo das células baseado na ordem das colunas visíveis
    const cells = row.querySelectorAll('td');
    let cellIndex = 0;
    
    // Definir a ordem das colunas conforme definido em PODS_COLUMNS
    const columnOrder = [
        { key: 'name', update: (cell) => { cell.innerHTML = `<a href="#" class="pod-name-link" title="Ver detalhes">${pod.name}</a>`; } },
        { key: 'namespace', update: (cell) => { cell.innerHTML = namespaceDisplay; } },
        { key: 'status', update: (cell) => { cell.innerHTML = `<span class="status-${pod.status.toLowerCase()}">${pod.status}</span>`; } },
        { key: 'ready', update: (cell) => { cell.innerHTML = `<span class="ready-${pod.ready.includes('/0') ? 'not-ready' : 'ready'}">${pod.ready}</span>`; } },
        { key: 'restarts', update: (cell) => { cell.textContent = pod.restarts; } },
        { key: 'age', update: (cell) => { cell.textContent = pod.age; } },
        { key: 'cpuUsage', update: (cell) => { cell.innerHTML = cpuBar; } },
        { key: 'memoryUsage', update: (cell) => { cell.innerHTML = memoryBar; } },
        { key: 'node', update: (cell) => { cell.textContent = pod.node || '-'; } },
        { key: 'ip', update: (cell) => { cell.textContent = pod.ip || '-'; } }
    ];
    
    // Atualizar apenas as colunas visíveis na ordem correta
    columnOrder.forEach(column => {
        if (PODS_COLUMNS[column.key].visible && cells[cellIndex]) {
            column.update(cells[cellIndex]);
            cellIndex++;
        }
    });

    // Garantir que o link do nome do pod permaneça funcional após updates
    const podNameLink = row.querySelector('.pod-name-link');
    if (podNameLink) {
        const newLink = podNameLink.cloneNode(true);
        podNameLink.parentNode.replaceChild(newLink, podNameLink);
        newLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const podNameCell = row.querySelector('.pod-name');
            if (!podNameCell) return;
            const podNameVal = podNameCell.dataset.podName;
            const podNamespaceVal = podNameCell.dataset.podNamespace;
            if (podNameVal && podNamespaceVal) {
                showPodDetails(podNameVal, podNamespaceVal);
            }
        });
    }

    // Re-adicionar event listeners para as barras de progresso
    addProgressBarListeners(row);
}

// Função para criar uma nova linha
function createPodRow(pod) {
    const row = document.createElement('tr');

    // Destacar namespace quando visualizando todos os namespaces
    const namespaceDisplay = elements.namespaceSelect.value === 'all'
        ? `<span class="namespace-badge">${pod.namespace}</span>`
        : pod.namespace;

    // Renderizar barras de progresso de recursos
    const cpuBar = renderResourceProgressBar(
        pod.metrics.cpu.current,
        pod.metrics.cpu.requests,
        pod.metrics.cpu.percentage,
        'cpu',
        pod.metrics.cpu.limits
    );
    
    const memoryBar = renderResourceProgressBar(
        pod.metrics.memory.current,
        pod.metrics.memory.requests,
        pod.metrics.memory.percentage,
        'memory',
        pod.metrics.memory.limits
    );

    // Criar células baseadas na ordem das colunas visíveis
    const cells = [];
    
    // Definir a ordem das colunas conforme definido em PODS_COLUMNS
    const columnOrder = [
        { key: 'name', content: `<td class="pod-name" data-pod-name="${pod.name}" data-pod-namespace="${pod.namespace}"><a href="#" class="pod-name-link" title="Ver detalhes">${pod.name}</a></td>` },
        { key: 'namespace', content: `<td class="pod-namespace">${namespaceDisplay}</td>` },
        { key: 'status', content: `<td><span class="status-${pod.status.toLowerCase()}">${pod.status}</span></td>` },
        { key: 'ready', content: `<td><span class="ready-${pod.ready.includes('/0') ? 'not-ready' : 'ready'}">${pod.ready}</span></td>` },
        { key: 'restarts', content: `<td>${pod.restarts}</td>` },
        { key: 'age', content: `<td>${pod.age}</td>` },
        { key: 'cpuUsage', content: `<td class="resource-column">${cpuBar}</td>` },
        { key: 'memoryUsage', content: `<td class="resource-column">${memoryBar}</td>` },
        { key: 'node', content: `<td>${pod.node || '-'}</td>` },
        { key: 'ip', content: `<td>${pod.ip || '-'}</td>` }
    ];
    
    // Adicionar apenas as colunas visíveis na ordem correta
    columnOrder.forEach(column => {
        if (PODS_COLUMNS[column.key].visible) {
            cells.push(column.content);
        }
    });

    row.innerHTML = cells.join('');

    // Adicionar event listeners
    addPodRowListeners(row);
    
    return row;
}

// Função para adicionar event listeners a uma linha
function addPodRowListeners(row) {
    // Context menu para nome do pod
    const podNameCell = row.querySelector('.pod-name');
    if (podNameCell) {
        podNameCell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const cell = e.currentTarget;
            const podName = cell && cell.dataset ? cell.dataset.podName : null;
            const podNamespace = cell && cell.dataset ? cell.dataset.podNamespace : null;
            if (podName && podNamespace) {
                showPodContextMenu(e, podName, podNamespace);
            }
        });
    }

    // Click no nome do pod para abrir detalhes
    const podNameLink = row.querySelector('.pod-name-link');
    if (podNameLink) {
        podNameLink.addEventListener('click', (e) => {
            e.stopPropagation();
            const podName = row.querySelector('.pod-name').dataset.podName;
            const podNamespace = row.querySelector('.pod-name').dataset.podNamespace;
            showPodDetails(podName, podNamespace);
        });
    }

    // Event listeners para barras de progresso
    addProgressBarListeners(row);
}

// Função para adicionar event listeners às barras de progresso
function addProgressBarListeners(row) {
    row.querySelectorAll('.progress-bar').forEach(bar => {
        // Remover listeners existentes para evitar duplicação
        const newBar = bar.cloneNode(true);
        bar.parentNode.replaceChild(newBar, bar);
        
        newBar.addEventListener('mouseenter', (e) => {
            const tooltipContent = e.target.dataset.tooltip;
            const resourceType = e.target.dataset.resourceType;
            const current = e.target.dataset.current;
            const requests = e.target.dataset.requests;
            const percentage = e.target.dataset.percentage;
            
            const detailedContent = `
                <div class="tooltip-header">${resourceType.toUpperCase()} Usage</div>
                <div class="tooltip-content">
                    <div class="tooltip-row">
                        <span class="tooltip-label">Atual:</span>
                        <span class="tooltip-value">${current}</span>
                    </div>
                    ${requests !== 'N/A' ? `
                    <div class="tooltip-row">
                        <span class="tooltip-label">Requests:</span>
                        <span class="tooltip-value">${requests}</span>
                    </div>
                    ` : ''}
                    <div class="tooltip-row">
                        <span class="tooltip-label">Limits:</span>
                        <span class="tooltip-value">${e.target.dataset.limits || 'N/A'}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Uso vs Limits:</span>
                        <span class="tooltip-value">${percentage}</span>
                    </div>
                </div>
            `;
            
            createTooltip(detailedContent, e.pageX, e.pageY);
        });
        
        newBar.addEventListener('mouseleave', () => {
            removeTooltip();
        });
        
        newBar.addEventListener('mousemove', (e) => {
            const tooltip = document.getElementById('resource-tooltip');
            if (tooltip) {
                tooltip.style.left = `${e.pageX}px`;
                tooltip.style.top = `${e.pageY - 40}px`;
            }
        });
    });
}

async function loadPods() {
    try {
        const namespace = elements.namespaceSelect.value; // Passar o valor exato (incluindo 'all')
        const pods = await ipcRenderer.invoke('get-pods', currentConnectionId, namespace);

        // Preservar posição do scroll
        const tableContainer = elements.podsTableBody.closest('.table-container') || elements.podsTableBody.closest('.pods-table-wrapper');
        const scrollTop = tableContainer ? tableContainer.scrollTop : 0;

        // Limpar tabela
        elements.podsTableBody.innerHTML = '';

        // Filtrar pods se necessário
        const searchTerm = elements.searchInput.value.toLowerCase().trim();
        let filteredPods = pods;

        if (searchTerm) {
            filteredPods = pods.filter(pod =>
                pod.name.toLowerCase().includes(searchTerm) ||
                pod.namespace.toLowerCase().includes(searchTerm) ||
                pod.status.toLowerCase().includes(searchTerm) ||
                pod.node?.toLowerCase().includes(searchTerm) ||
                pod.ip?.toLowerCase().includes(searchTerm)
            );
        }

        // Verificar se há pods para exibir
        if (filteredPods.length === 0) {
            const row = document.createElement('tr');
            const namespaceInfo = elements.namespaceSelect.value === 'all'
                ? 'em nenhum namespace'
                : `no namespace "${elements.namespaceSelect.value}"`;
            row.innerHTML = `
                <td colspan="10" class="no-data">
                    <div class="no-data-message">
                        <span class="no-data-icon">📦</span>
                        <p>Nenhum pod encontrado ${namespaceInfo}</p>
                    </div>
                </td>
            `;
            elements.podsTableBody.appendChild(row);
            elements.podsCount.textContent = `0 pods`;
            return;
        }

        // Buscar métricas de recursos para todos os pods em batch
        let podsWithMetrics;
        try {
            const batchResults = await ipcRenderer.invoke('get-pods-metrics-batch', currentConnectionId, filteredPods);
            podsWithMetrics = batchResults.map(result => ({ ...result.pod, metrics: result.metrics }));
        } catch (error) {
            console.error('Erro ao buscar métricas em batch, usando fallback individual:', error);
            // Fallback para chamadas individuais se o batch falhar
            podsWithMetrics = await Promise.all(
                filteredPods.map(async (pod) => {
                    try {
                        const metrics = await ipcRenderer.invoke('get-pod-metrics', currentConnectionId, pod.name, pod.namespace);
                        return { ...pod, metrics };
                    } catch (error) {
                        console.error(`Erro ao buscar métricas para pod ${pod.name}:`, error);
                        return { 
                            ...pod, 
                            metrics: {
                                cpu: { current: '0m', requests: null, percentage: 0 },
                                memory: { current: '0Mi', requests: null, percentage: 0 }
                            }
                        };
                    }
                })
            );
        }

        // Adicionar pods à tabela usando a função que respeita configurações de colunas
        podsWithMetrics.forEach(pod => {
            const row = createPodRow(pod);
            elements.podsTableBody.appendChild(row);
        });

        // Adicionar event listeners para os botões de logs
        elements.podsTableBody.querySelectorAll('.logs-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const podName = e.target.dataset.podName;
                const podNamespace = e.target.dataset.podNamespace;
                showPodLogs(podName, podNamespace);
            });
        });

        // Event listeners para menu de contexto já são adicionados pela função addPodRowListeners

        // Adicionar event listeners para tooltips das barras de progresso
        elements.podsTableBody.querySelectorAll('.progress-bar').forEach(bar => {
            bar.addEventListener('mouseenter', (e) => {
                const tooltipContent = e.target.dataset.tooltip;
                const resourceType = e.target.dataset.resourceType;
                const current = e.target.dataset.current;
                const requests = e.target.dataset.requests;
                const percentage = e.target.dataset.percentage;
                
                // Criar conteúdo detalhado do tooltip
                const detailedContent = `
                    <div class="tooltip-header">${resourceType.toUpperCase()} Usage</div>
                    <div class="tooltip-content">
                        <div class="tooltip-row">
                            <span class="tooltip-label">Atual:</span>
                            <span class="tooltip-value">${current}</span>
                        </div>
                        ${requests !== 'N/A' ? `
                        <div class="tooltip-row">
                            <span class="tooltip-label">Requests:</span>
                            <span class="tooltip-value">${requests}</span>
                        </div>
                        ` : ''}
                        <div class="tooltip-row">
                            <span class="tooltip-label">Uso:</span>
                            <span class="tooltip-value">${percentage}</span>
                        </div>
                    </div>
                `;
                
                createTooltip(detailedContent, e.pageX, e.pageY);
            });
            
            bar.addEventListener('mouseleave', () => {
                removeTooltip();
            });
            
            bar.addEventListener('mousemove', (e) => {
                // Atualizar posição do tooltip enquanto o mouse se move
                const tooltip = document.getElementById('resource-tooltip');
                if (tooltip) {
                    tooltip.style.left = `${e.pageX}px`;
                    tooltip.style.top = `${e.pageY - 40}px`;
                }
            });
        });

        // Atualizar contador com informações do namespace
        const namespaceInfo = elements.namespaceSelect.value === 'all'
            ? 'todos os namespaces'
            : `namespace: ${elements.namespaceSelect.value}`;
        elements.podsCount.textContent = `${filteredPods.length} pods`;
        
        // Atualizar breadcrumb se estivermos na seção de pods
        if (currentSection === 'pods') {
            updateBreadcrumbCount('pods');
        }

    } catch (error) {
        throw new Error('Erro ao carregar pods: ' + error.message);
    }
}

function switchSection(section) {
    // Atualizar navegação
    elements.navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.dataset.section === section) {
            link.classList.add('active');
        }
    });

    // Atualizar seções
    document.querySelectorAll('.content-section').forEach(sectionEl => {
        sectionEl.classList.remove('active');
    });

    const targetSection = document.getElementById(section + 'Section');
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // Atualizar breadcrumb
    currentSection = section;
    elements.currentSectionSpan.textContent = section.charAt(0).toUpperCase() + section.slice(1);
    
    // Atualizar placeholder do campo de pesquisa baseado na seção
    updateSearchPlaceholder(section);
    
    // Atualizar contador do breadcrumb baseado na seção
    updateBreadcrumbCount(section);

    // Mostrar/ocultar botões de colunas baseado na seção
    const podsColumnBtn = document.getElementById('podsColumnSelectorBtn');
    const deploymentsColumnBtn = document.getElementById('deploymentsColumnSelectorBtn');
    
    if (podsColumnBtn && deploymentsColumnBtn) {
        if (section === 'pods') {
            podsColumnBtn.style.display = 'inline-flex';
            deploymentsColumnBtn.style.display = 'none';
        } else if (section === 'deployments') {
            podsColumnBtn.style.display = 'none';
            deploymentsColumnBtn.style.display = 'inline-flex';
        } else {
            podsColumnBtn.style.display = 'none';
            deploymentsColumnBtn.style.display = 'none';
        }
    }

    // Gerenciar visibilidade do dashboard header e auto-refresh baseado na seção
    const dashboardContent = document.querySelector('.dashboard-content');
    
    if (section === 'podLogs') {
        // Esconder header na seção de logs
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de logs
        stopAutoRefresh();
    } else if (section === 'podDetails') {
        // Esconder header na seção de detalhes do pod
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de detalhes
        stopAutoRefresh();
    } else if (section === 'podYaml') {
        // Esconder header na seção de YAML
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de YAML
        stopAutoRefresh();
    } else if (section === 'deploymentDetails') {
        // Esconder header na seção de detalhes de deployment
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de detalhes
        stopAutoRefresh();
    } else if (section === 'deploymentYAML') {
        // Esconder header na seção de YAML de deployment
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de YAML
        stopAutoRefresh();
    } else if (section === 'serviceDetails') {
        // Esconder header na seção de detalhes de service
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de detalhes
        stopAutoRefresh();
    } else if (section === 'serviceYaml') {
        // Esconder header na seção de YAML de service
        elements.dashboardHeader.classList.add('hidden');
        // Adicionar classe especial ao dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.add('logs-active');
        }
        // Pausar auto-refresh na seção de YAML
        stopAutoRefresh();
    } else {
        // Mostrar header nas outras seções
        elements.dashboardHeader.classList.remove('hidden');
        // Remover classe especial do dashboard-content
        if (dashboardContent) {
            dashboardContent.classList.remove('logs-active');
        }
        // Reativar auto-refresh se estava habilitado
        if (currentConnectionId && autoRefreshEnabled) {
            startAutoRefresh();
        }
    }

    // Carregar dados da nova seção
    if (currentConnectionId && section !== 'podLogs' && section !== 'podDetails' && section !== 'podYaml') {
        loadCurrentSection();
    }

    // Se mudou para seção de logs, redimensionar o terminal após a transição
    if (section === 'podLogs' && logViewer && logViewer.terminal) {
        setTimeout(() => {
            logViewer.resize();
        }, 300);
    }

    // Se mudou para seção de YAML, não precisa fazer nada especial
}

function refreshCurrentSection() {
    if (currentConnectionId) {
        loadCurrentSection();
    }
}

function updateSearchPlaceholder(section) {
    if (!elements.searchInput) return;
    
    switch (section) {
        case 'pods':
            elements.searchInput.placeholder = 'Buscar pods...';
            break;
        case 'deployments':
            elements.searchInput.placeholder = 'Buscar deployments...';
            break;
        case 'services':
            elements.searchInput.placeholder = 'Buscar services...';
            break;
        case 'namespaces':
            elements.searchInput.placeholder = 'Buscar namespaces...';
            break;
        default:
            elements.searchInput.placeholder = 'Buscar...';
    }
}

function updateBreadcrumbCount(section) {
    if (!elements.currentSectionCount) return;
    
    switch (section) {
        case 'pods':
            // Usar o contador de pods existente
            if (elements.podsCount) {
                elements.currentSectionCount.textContent = elements.podsCount.textContent;
            }
            break;
        case 'deployments':
            // Usar o contador de deployments
            if (elements.deploymentsCount) {
                elements.currentSectionCount.textContent = elements.deploymentsCount.textContent;
            }
            break;
        case 'services':
            // Usar o contador de services
            if (elements.servicesCount) {
                elements.currentSectionCount.textContent = elements.servicesCount.textContent;
            }
            break;
        case 'namespaces':
            // Usar o contador de namespaces
            if (elements.namespacesCount) {
                elements.currentSectionCount.textContent = elements.namespacesCount.textContent;
            }
            break;
        default:
            elements.currentSectionCount.textContent = '0 items';
    }
}

function filterCurrentSection() {
    if (currentSection === 'pods' && currentConnectionId) {
        loadPods();
    } else if (currentSection === 'deployments' && currentConnectionId) {
        loadDeployments();
    } else if (currentSection === 'services' && currentConnectionId) {
        loadServices();
    }
}

function showDashboard() {
    if (elements.setupScreen) {
        elements.setupScreen.classList.remove('active');
    }

    if (elements.dashboardScreen) {
        elements.dashboardScreen.classList.add('active');
    }

    if (elements.currentContextSpan) {
        elements.currentContextSpan.textContent = currentContext;
    }

    // Inicializar apenas se não há seção ativa
    const activeSections = document.querySelectorAll('.content-section.active');
    if (activeSections.length === 0) {
        // Ativar seção de pods por padrão apenas se nenhuma seção estiver ativa
        const podsSection = document.getElementById('podsSection');
        if (podsSection) {
            podsSection.classList.add('active');
        }
    }
}

function showSetupScreen() {
    elements.dashboardScreen.classList.remove('active');
    elements.setupScreen.classList.add('active');

    // Reset connection state
    currentConnectionId = null;
    currentContext = null;
    updateConnectionStatus(false);

    // Parar auto-refresh quando desconectado
    stopAutoRefresh();
}

function updateClusterInfo() {
    if (currentContext) {
        // Extrair informações do contexto (formato: context-name (namespace))
        const contextParts = currentContext.split(' (');
        const clusterName = contextParts[0];
        const namespace = contextParts[1] ? contextParts[1].replace(')', '') : 'default';

        elements.currentClusterName.textContent = clusterName;
        elements.currentClusterNamespace.textContent = `Namespace: ${namespace}`;
    }
}

function updateConnectionStatus(connected) {
    // Atualizar status na tela de setup
    const setupIndicator = elements.connectionStatus.querySelector('.status-indicator');
    const setupText = elements.connectionStatus.querySelector('span:last-child');

    // Atualizar status na sidebar principal
    const mainIndicator = elements.mainConnectionStatus.querySelector('.status-indicator');
    const mainText = elements.mainConnectionStatus.querySelector('span:last-child');

    if (connected) {
        if (setupIndicator) {
            setupIndicator.classList.remove('disconnected');
            setupIndicator.classList.add('connected');
            setupText.textContent = `Conectado (${currentContext})`;
        }
        if (mainIndicator) {
            mainIndicator.classList.remove('disconnected');
            mainIndicator.classList.add('connected');
            mainText.textContent = `Conectado (${currentContext})`;
        }
    } else {
        if (setupIndicator) {
            setupIndicator.classList.remove('connected');
            setupIndicator.classList.add('disconnected');
            setupText.textContent = 'Pronto para conectar';
        }
        if (mainIndicator) {
            mainIndicator.classList.remove('connected');
            mainIndicator.classList.add('disconnected');
            mainText.textContent = 'Desconectado';
        }
    }
}

function showLoading(show) {
    elements.loadingIndicator.style.display = show ? 'flex' : 'none';
}

function showError(message) {
    elements.errorText.textContent = message;
    elements.errorMessage.style.display = 'flex';
}

function hideError() {
    elements.errorMessage.style.display = 'none';
}

// Função para formatar recursos
function formatResource(resource) {
    if (!resource) return '0';

    const cpu = resource.requests?.cpu || resource.limits?.cpu || '0';
    const memory = resource.requests?.memory || resource.limits?.memory || '0';

    return {
        cpu: formatCPU(cpu),
        memory: formatMemory(memory)
    };
}

// Função para criar tooltip
function createTooltip(content, x, y) {
    // Remover tooltip anterior se existir
    const existingTooltip = document.getElementById('resource-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    // Criar novo tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'resource-tooltip';
    tooltip.className = 'resource-tooltip';
    tooltip.innerHTML = content;
    
    // Posicionar tooltip
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y - 40}px`; // Posicionar acima do mouse
    
    document.body.appendChild(tooltip);
    
    // Mostrar tooltip com animação
    setTimeout(() => {
        tooltip.classList.add('show');
    }, 10);
    
    return tooltip;
}

// Função para remover tooltip
function removeTooltip() {
    const tooltip = document.getElementById('resource-tooltip');
    if (tooltip) {
        tooltip.classList.remove('show');
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.remove();
            }
        }, 200);
    }
}

// Função para renderizar barra de progresso de recursos
function renderResourceProgressBar(current, requests, percentage, type, limits = null) {
    // Uso atual só existe com Metrics Server. Sem ele, mostrar N/D em vez de
    // uma barra — um valor estimado seria indistinguível de medição real.
    if (current === null) {
        const referenceValue = limits || requests;
        const tooltipContent = referenceValue
            ? `Uso atual indisponível (Metrics Server) — limite definido: ${referenceValue}`
            : 'Uso atual indisponível (Metrics Server)';

        return `
            <div class="resource-usage-cell">
                <div class="resource-value resource-value-unavailable" title="${tooltipContent}">N/D</div>
            </div>
        `;
    }

    // Uso medido, mas sem requests/limits não há denominador para uma barra.
    if (percentage === null) {
        return `
            <div class="resource-usage-cell">
                <div class="resource-value" title="Sem requests/limits definidos">${current}</div>
            </div>
        `;
    }

    const safePercentage = Math.min(100, Math.max(0, percentage));
    
    // Definir cores baseadas na porcentagem e tipo
    let barColor;
    if (safePercentage >= 90) {
        barColor = '#f14c4c'; // Vermelho para alto uso
    } else if (safePercentage >= 70) {
        barColor = '#ffa500'; // Laranja para uso médio-alto
    } else if (safePercentage >= 50) {
        barColor = '#ffd700'; // Amarelo para uso médio
    } else {
        barColor = '#8fbc8f'; // Verde para uso baixo
    }
    
    // Criar conteúdo do tooltip baseado nos limits (fallback para requests)
    const referenceValue = limits || requests;
    const tooltipContent = referenceValue 
        ? `${safePercentage}% de ${referenceValue}`
        : `${safePercentage}% (sem limits/requests definidos)`;
    
    return `
        <div class="resource-usage-cell">
            <div class="resource-value">${current}</div>
            <div class="progress-bar-container">
                <div class="progress-bar" 
                     data-tooltip="${tooltipContent}"
                     data-resource-type="${type}"
                     data-current="${current}"
                     data-requests="${requests || 'N/A'}"
                     data-limits="${limits || 'N/A'}"
                     data-percentage="${safePercentage}%">
                    <div class="progress-fill" style="width: ${safePercentage}%; background-color: ${barColor};"></div>
                </div>
            </div>
        </div>
    `;
}

function formatCPU(cpu) {
    if (cpu.endsWith('m')) {
        return cpu;
    } else if (cpu.endsWith('n')) {
        return (parseFloat(cpu) / 1000000) + 'm';
    } else {
        return (parseFloat(cpu) * 1000) + 'm';
    }
}

function formatMemory(memory) {
    if (memory.endsWith('Mi')) {
        return memory;
    } else if (memory.endsWith('Gi')) {
        return (parseFloat(memory) * 1024) + 'Mi';
    } else if (memory.endsWith('Ki')) {
        return (parseFloat(memory) / 1024) + 'Mi';
    } else {
        return memory;
    }
}

// Funções de logs
async function showPodLogs(podName, podNamespace) {
    try {
        // Parar streaming anterior se estiver ativo
        stopLogsStreaming();

        // Limpar informações de deployment
        currentDeploymentName = null;
        currentDeploymentNamespace = null;
        currentDeploymentPods = [];

        currentPodName = podName;
        currentPodNamespace = podNamespace;

        // Atualizar título
        if (elements.podLogsTitle) {
            elements.podLogsTitle.textContent = `${podName}`;
        }

        // Atualizar botão de voltar para pods
        const backBtn = document.getElementById('backToPodsBtn');
        if (backBtn) {
            backBtn.innerHTML = '<span class="btn-icon">←</span>';
        }

        // Limpar completamente logs anteriores
        clearLogs();

        // Sempre reinicializar o LogViewer para garantir que funcione corretamente
        initializeLogViewer();

        // Carregar containers do pod
        if (currentConnectionId) {
            await loadPodContainers();
        }

        // Mostrar seção de logs
        switchSection('podLogs');

        // Iniciar streaming de logs
        if (currentConnectionId) {
            startLogsStreaming();
        }
        
    } catch (error) {
        console.error('Erro em showPodLogs:', error);
        showError('Erro ao carregar logs: ' + error.message);
    }
}

function initializeLogViewer() {
    try {
        // Verificar se o elemento logsContent existe
        const logsContentElement = document.getElementById('logsContent');
        if (!logsContentElement) {
            console.error('Elemento logsContent não encontrado!');
            return;
        }
        
        // Destruir viewer anterior se existir
        if (logViewer) {
            logViewer.destroy();
        }

        // Criar novo LogViewer
        logViewer = new LogViewer('logsContent', {
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                selection: '#264f78'
            },
            fontSize: 12,
            fontFamily: 'Consolas, "Courier New", monospace'
        });

        logViewer.initialize();

        // Redimensionar apenas uma vez após inicialização
        setTimeout(() => {
            if (logViewer && logViewer.terminal) {
                logViewer.resize();
            }
        }, 300);

    } catch (error) {
        console.error('Erro ao inicializar LogViewer:', error);
        // Fallback para implementação anterior se houver erro
        const logsContent = document.getElementById('logsContent');
        if (logsContent) {
            logsContent.innerHTML = '<div style="padding: 20px; color: #f14c4c;">Erro ao inicializar terminal de logs. Usando modo de compatibilidade.</div>';
        }
    }
}

async function loadPodContainers() {
    try {
        const containers = await ipcRenderer.invoke('get-pod-containers', currentConnectionId, currentPodName, currentPodNamespace);

        // Verificar se o elemento containerSelect existe
        if (!elements.containerSelect) {
            console.error('Elemento containerSelect não encontrado!');
            return;
        }

        // Limpar e adicionar containers ao dropdown
        elements.containerSelect.innerHTML = '<option value="">Todos os containers</option>';

        containers.forEach(container => {
            const option = document.createElement('option');
            option.value = container.name;
            option.textContent = `${container.name}`;
            if (!container.ready) {
                option.textContent += ' [Não pronto]';
                option.disabled = true;
            }
            elements.containerSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Erro ao carregar containers do pod:', error);
        // Manter opção padrão "Todos os containers"
        if (elements.containerSelect) {
            elements.containerSelect.innerHTML = '<option value="">Todos os containers</option>';
        }
    }
}



async function startLogsStreaming() {
    if (!currentConnectionId || !currentPodName || !currentPodNamespace) return;

    try {
        logsStreaming = true;
        logsPaused = false;

        // Sem isto a taxa congelaria no último valor quando os logs parassem
        if (logsRateInterval) clearInterval(logsRateInterval);
        logsRateInterval = setInterval(updateLogsStats, 1000);

        // Atualizar botão de pausa
        elements.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';

        // Mostrar mensagem de aguardando logs
        const waitingEntry = {
            id: 'waiting-logs',
            timestamp: new Date().toISOString(),
            podName: currentPodName,
            level: 'info',
            message: `Aguardando logs do pod ${currentPodName}...`,
            raw: `Aguardando logs do pod ${currentPodName}`
        };
        addLogEntry(waitingEntry);

        // Iniciar streaming de logs em tempo real
        await streamLogs();

    } catch (error) {
        console.error('Erro ao iniciar streaming de logs:', error);
        showError('Erro ao carregar logs: ' + error.message);
    }
}

async function streamLogs() {
    if (!logsStreaming || currentLogStreamId) return; // Não iniciar se já estiver em streaming

    try {
        const selectedContainer = elements.containerSelect.value || null;

        // Iniciar o streaming no backend
        const result = await ipcRenderer.invoke(
            'stream-pod-logs',
            currentConnectionId,
            currentPodName,
            currentPodNamespace,
            selectedContainer,
            30 // sinceSeconds, para pegar os últimos 30s para começar
        );

        if (result && result.success) {
            currentLogStreamId = result.streamId;
        } else {
            throw new Error(result.message || 'Falha ao iniciar o streaming de logs.');
        }

    } catch (error) {
        console.error('Erro ao iniciar o streaming de logs:', error);
        const errorEntry = {
            id: 'stream-setup-error',
            timestamp: new Date().toISOString(),
            podName: currentPodName,
            level: 'error',
            message: `Erro ao configurar streaming: ${error.message}`,
            raw: `Erro: ${error.message}`
        };
        addLogEntry(errorEntry);
        logsStreaming = false;
    }
}

function addLogEntry(log) {
    // Adicionar log aos dados (para compatibilidade e exportação)
    logsData.push(log);
    logArrivalTimestamps.push(Date.now());

    // Limitar número total de logs em memória
    if (logsData.length > MAX_TOTAL_LOGS) {
        const logsToRemove = logsData.length - MAX_TOTAL_LOGS;
        logsData.splice(0, logsToRemove);
    }

    // Adicionar ao LogViewer se disponível (ele já gerencia o scroll automático)
    if (logViewer) {
        logViewer.addLog(log);
    } else {
        // Fallback para implementação anterior
        renderLogEntry(log);

        // Scroll para o final apenas se estivermos no final da lista
        const isAtBottom = elements.logsContent.scrollTop + elements.logsContent.clientHeight >= elements.logsContent.scrollHeight - 10;
        if (isAtBottom) {
            elements.logsContent.scrollTop = elements.logsContent.scrollHeight;
        }
    }
}

function renderLogEntry(log) {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${logsOptions.logColoring ? log.level : ''}`;
    logEntry.dataset.logId = log.id;

    // Usar flexbox para layout responsivo
    logEntry.style.display = 'flex';
    logEntry.style.flexWrap = 'wrap';
    logEntry.style.gap = '8px';
    logEntry.style.alignItems = 'flex-start';

    let content = '';

    if (logsOptions.timestamp !== 'off') {
        const date = new Date(log.timestamp);
        const timestamp = logsOptions.timestamp === 'utc'
            ? date.toISOString()
            : date.toLocaleString();

        // Indicar se o timestamp é aproximado
        const timestampClass = log.isApproximateTimestamp ? 'log-timestamp approximate' : 'log-timestamp';
        const timestampPrefix = log.isApproximateTimestamp ? '~' : '';
        content += `<span class="${timestampClass}">[${timestampPrefix}${timestamp}]</span>`;
    }

    // Usar podName em vez de podId para logs reais
    if (log.podName) {
        content += `<span class="log-pod-id">${log.podName}</span>`;
    }

    if (log.ip) {
        content += `<span class="log-ip">${log.ip}</span>`;
    }

    // Usar message ou raw dependendo do que estiver disponível
    const message = log.message || log.raw || '';
    content += `<span class="log-message">${escapeHtml(message)}</span>`;

    logEntry.innerHTML = content;

    // Aplicar quebra de linha ou scroll horizontal baseado nas opções
    if (logsOptions.horizontalScroll) {
        logEntry.style.whiteSpace = 'nowrap';
        logEntry.style.overflow = 'visible';
        logEntry.style.textOverflow = 'unset';
    } else if (logsOptions.lineWrap) {
        logEntry.style.whiteSpace = 'pre-wrap';
        logEntry.style.overflow = 'visible';
        logEntry.style.textOverflow = 'unset';
    } else {
        logEntry.style.whiteSpace = 'nowrap';
        logEntry.style.overflow = 'hidden';
        logEntry.style.textOverflow = 'ellipsis';
    }

    elements.logsContent.appendChild(logEntry);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateLogsStats() {
    let totalLogs = logsData.length;
    let stats = null;

    // Usar stats do LogViewer se disponível
    if (logViewer) {
        stats = logViewer.getStats();
        totalLogs = stats.total;
    }

    elements.logsCount.textContent = `${totalLogs} logs`;
    elements.logsRate.textContent = `${currentLogsRate()}/s`;
}

// Taxa real de logs: quantos chegaram na última janela, normalizado por segundo.
function currentLogsRate() {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    // Timestamps são monotônicos, então basta descartar o prefixo expirado
    const firstValid = logArrivalTimestamps.findIndex(ts => ts >= cutoff);
    logArrivalTimestamps = firstValid === -1 ? [] : logArrivalTimestamps.slice(firstValid);

    const rate = logArrivalTimestamps.length / (RATE_WINDOW_MS / 1000);
    return rate < 1 && rate > 0 ? rate.toFixed(1) : Math.round(rate);
}

function filterLogs() {
    const entries = elements.logsContent.querySelectorAll('.log-entry');

    entries.forEach(entry => {
        const text = entry.textContent.toLowerCase();
        const shouldShow = !logsFilter || text.includes(logsFilter);
        entry.style.display = shouldShow ? 'block' : 'none';
    });
}

function updateLogsDisplay() {
    // Com LogViewer, não precisamos renderizar manualmente
    // Os logs são adicionados automaticamente via addLog()
    if (logViewer && logsData.length > 0) {
        // Se por algum motivo o LogViewer não tem os logs, readicioná-los
        const stats = logViewer.getStats();
        if (stats.total === 0 && logsData.length > 0) {
            logsData.forEach(log => logViewer.addLog(log));
        }
    }
}

function pauseLogsStreaming() {
    logsPaused = true;
    elements.pauseLogsBtn.innerHTML = '<i class="bi bi-play"></i> Retomar';
}

function resumeLogsStreaming() {
    logsPaused = false;
    elements.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';
}

function stopLogsStreaming() {
    if (currentLogStreamId) {
        ipcRenderer.send('stop-stream-pod-logs', currentLogStreamId);
        currentLogStreamId = null;
    }

    // Limpar o intervalo de polling antigo, por segurança
    if (window.logsInterval) {
        clearInterval(window.logsInterval);
        window.logsInterval = null;
    }

    if (logsRateInterval) {
        clearInterval(logsRateInterval);
        logsRateInterval = null;
    }
    logArrivalTimestamps = [];

    logsStreaming = false;
    logsPaused = false;
    updateLogsStats();

    elements.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';

    // Limpar indicador de modo de logs
    const logsModeIndicator = document.getElementById('logsModeIndicator');
    if (logsModeIndicator) {
        logsModeIndicator.remove();
    }
}

function clearLogs() {
    logsData = [];
    logArrivalTimestamps = [];
    if (logViewer) {
        logViewer.clear();
    } else {
        elements.logsContent.innerHTML = '';
    }
    updateLogsStats();
}

// Funções para gerenciar configurações de colunas
function getColumnPreferencesKey(section) {
    return `kubedesk_columns_${section}_${currentContext?.cluster || 'default'}`;
}

function loadColumnPreferences(section) {
    const key = getColumnPreferencesKey(section);
    const saved = localStorage.getItem(key);
    
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (error) {
            console.error('Erro ao carregar preferências de colunas:', error);
        }
    }
    
    // Retornar configuração padrão
    return section === 'pods' ? { ...PODS_COLUMNS } : { ...DEPLOYMENTS_COLUMNS };
}

function saveColumnPreferences(section, preferences) {
    const key = getColumnPreferencesKey(section);
    try {
        localStorage.setItem(key, JSON.stringify(preferences));
    } catch (error) {
        console.error('Erro ao salvar preferências de colunas:', error);
    }
}

function initializeColumnSelector(section) {
    const isPods = section === 'pods';
    const columns = isPods ? PODS_COLUMNS : DEPLOYMENTS_COLUMNS;
    const preferences = loadColumnPreferences(section);
    
    // Aplicar preferências salvas
    Object.keys(columns).forEach(key => {
        if (preferences[key]) {
            columns[key].visible = preferences[key].visible;
        }
    });
    
    const modal = isPods ? elements.podsColumnSelectorModal : elements.deploymentsColumnSelectorModal;
    const checkboxesContainer = isPods ? elements.podsColumnCheckboxes : elements.deploymentsColumnCheckboxes;
    
    // Limpar container
    checkboxesContainer.innerHTML = '';
    
    // Criar checkboxes para cada coluna
    Object.entries(columns).forEach(([key, config]) => {
        const item = document.createElement('div');
        item.className = 'column-checkbox-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${section}_${key}`;
        checkbox.checked = config.visible;
        checkbox.disabled = config.required;
        
        const label = document.createElement('label');
        label.htmlFor = `${section}_${key}`;
        label.textContent = config.label;
        
        if (config.required) {
            label.style.color = '#a3a3a3';
            label.title = 'Coluna obrigatória';
        }
        
        item.appendChild(checkbox);
        item.appendChild(label);
        checkboxesContainer.appendChild(item);
    });
    
    // Event listeners para selecionar/desmarcar todas
    const selectAllBtn = document.getElementById(`${section}SelectAllColumns`);
    const deselectAllBtn = document.getElementById(`${section}DeselectAllColumns`);
    
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            checkboxesContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                checkbox.checked = true;
            });
        };
    }
    
    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            checkboxesContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                if (!checkbox.disabled) {
                    checkbox.checked = false;
                }
            });
        };
    }
}

function saveColumnConfiguration(section) {
    const isPods = section === 'pods';
    const columns = isPods ? PODS_COLUMNS : DEPLOYMENTS_COLUMNS;
    const checkboxesContainer = isPods ? elements.podsColumnCheckboxes : elements.deploymentsColumnCheckboxes;
    
    // Atualizar configurações
    Object.keys(columns).forEach(key => {
        const checkbox = checkboxesContainer.querySelector(`#${section}_${key}`);
        if (checkbox) {
            columns[key].visible = checkbox.checked;
        }
    });
    
    // Salvar preferências
    const preferences = {};
    Object.keys(columns).forEach(key => {
        preferences[key] = {
            visible: columns[key].visible,
            required: columns[key].required
        };
    });
    
    saveColumnPreferences(section, preferences);
    
    // Fechar modal
    const modal = isPods ? elements.podsColumnSelectorModal : elements.deploymentsColumnSelectorModal;
    modal.style.display = 'none';
    
    // Recarregar tabela completamente para aplicar mudanças
    if (currentSection === section) {
        // Atualizar cabeçalhos primeiro
        updateTableHeaders(section);
        
        // Limpar completamente o conteúdo da tabela
        if (section === 'pods') {
            elements.podsTableBody.innerHTML = '';
            loadPods();
        } else if (section === 'deployments') {
            elements.deploymentsTableBody.innerHTML = '';
            loadDeployments();
        }
    }
}

function updateTableHeaders(section) {
    const isPods = section === 'pods';
    const columns = isPods ? PODS_COLUMNS : DEPLOYMENTS_COLUMNS;
    const table = isPods ? 
        document.querySelector('.pods-table') : 
        document.querySelector('.deployments-table');
    
    if (!table) return;
    
    const thead = table.querySelector('thead tr');
    if (!thead) return;
    
    // Limpar cabeçalhos existentes
    thead.innerHTML = '';
    
    // Adicionar apenas colunas visíveis
    Object.entries(columns).forEach(([key, config]) => {
        if (config.visible) {
            const th = document.createElement('th');
            th.textContent = config.label;
            th.dataset.column = key;
            thead.appendChild(th);
        }
    });
}

function initializeColumnPreferences() {
    // Carregar preferências salvas para pods
    const podsPreferences = loadColumnPreferences('pods');
    Object.keys(PODS_COLUMNS).forEach(key => {
        if (podsPreferences[key]) {
            PODS_COLUMNS[key].visible = podsPreferences[key].visible;
        }
    });
    
    // Carregar preferências salvas para deployments
    const deploymentsPreferences = loadColumnPreferences('deployments');
    Object.keys(DEPLOYMENTS_COLUMNS).forEach(key => {
        if (deploymentsPreferences[key]) {
            DEPLOYMENTS_COLUMNS[key].visible = deploymentsPreferences[key].visible;
        }
    });
}

function clearLogsDisplay() {
    // Limpar completamente a visualização
    elements.logsContent.innerHTML = '';

    // Remover avisos de performance
    const performanceWarning = document.querySelector('.performance-warning');
    if (performanceWarning) {
        performanceWarning.remove();
    }

    // Remover indicador de modo de logs
    const logsModeIndicator = document.getElementById('logsModeIndicator');
    if (logsModeIndicator) {
        logsModeIndicator.remove();
    }

    // Resetar scroll
    elements.logsContent.scrollTop = 0;
}

function downloadLogs(format) {
    let content = '';
    const filename = `pod-${currentPodName}-logs.${format}`;

    // Usar LogViewer se disponível, senão usar logsData
    if (logViewer) {
        content = logViewer.exportLogs(format);
    } else {
        if (logsData.length === 0) {
            showError('Nenhum log para exportar');
            return;
        }

        if (format === 'csv') {
            content = 'Timestamp,Pod Name,IP,Message,Level,Raw\n';
            logsData.forEach(log => {
                const message = (log.message || '').replace(/"/g, '""');
                const raw = (log.raw || '').replace(/"/g, '""');
                const timestamp = log.isApproximateTimestamp ? `~${log.timestamp}` : log.timestamp;
                content += `"${timestamp}","${log.podName || ''}","${log.ip || ''}","${message}","${log.level}","${raw}"\n`;
            });
        } else {
            logsData.forEach(log => {
                const message = log.message || log.raw || '';
                const timestamp = log.isApproximateTimestamp ? `~${log.timestamp}` : log.timestamp;
                content += `[${timestamp}] ${log.podName || ''} ${log.ip || ''} ${message}\n`;
            });
        }
    }

    downloadBlob(content, filename, format === 'csv' ? 'text/csv' : 'text/plain');
}

function copyLogs(format) {
    if (logsData.length === 0) {
        showError('Nenhum log para copiar');
        return;
    }

    let content = '';

    if (format === 'csv') {
        content = 'Timestamp,Pod Name,IP,Message,Level,Raw\n';
        logsData.forEach(log => {
            const message = (log.message || '').replace(/"/g, '""');
            const raw = (log.raw || '').replace(/"/g, '""');
            const timestamp = log.isApproximateTimestamp ? `~${log.timestamp}` : log.timestamp;
            content += `"${timestamp}","${log.podName || ''}","${log.ip || ''}","${message}","${log.level}","${raw}"\n`;
        });
    } else {
        logsData.forEach(log => {
            const message = log.message || log.raw || '';
            const timestamp = log.isApproximateTimestamp ? `~${log.timestamp}` : log.timestamp;
            content += `[${timestamp}] ${log.podName || ''} ${log.ip || ''} ${message}\n`;
        });
    }

    navigator.clipboard.writeText(content).then(() => {
        // Mostrar feedback visual (opcional)
        console.log('Logs copiados para a área de transferência');
    }).catch(err => {
        showError('Erro ao copiar logs: ' + err.message);
    });
}

function showLogsModeIndicator(mode) {
    // Remover indicador anterior se existir
    const existingIndicator = document.getElementById('logsModeIndicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Criar novo indicador
    const indicator = document.createElement('div');
    indicator.id = 'logsModeIndicator';
    indicator.className = `logs-mode-indicator ${mode === 'histórico' ? 'historical' : 'realtime'}`;

    let icon, text, subtitle;
    if (mode === 'histórico') {
        icon = '<i class="bi bi-journal-text"></i>';
        text = 'Modo Histórico';
        subtitle = 'Últimos 5 minutos de logs';
    } else {
        icon = '<i class="bi bi-lightning"></i>';
        text = 'Modo Tempo Real';
        subtitle = 'Streaming ativo';
    }

    indicator.innerHTML = `
        <span class="mode-icon">${icon}</span>
        <span class="mode-text">${text}</span>
        <span class="mode-subtitle">${subtitle}</span>
    `;

    // Inserir no início do container de logs
    elements.logsContent.insertBefore(indicator, elements.logsContent.firstChild);
}

// Função para mostrar menu de contexto do pod
function showPodContextMenu(event, podName, podNamespace) {
    showContextMenu(event, [
        { icon: 'bi-file-text', label: 'Ver Logs', action: () => showPodLogs(podName, podNamespace) },
        { icon: 'bi-eye', label: 'Detalhes', action: () => showPodDetails(podName, podNamespace) },
        { icon: 'bi-file-code', label: 'YAML', action: () => showPodYaml(podName, podNamespace) },
        { icon: 'bi-arrow-clockwise', label: 'Reiniciar', action: () => reloadPod(podName, podNamespace) }
    ]);
}

// Função para mostrar menu de contexto de deployment
function showDeploymentContextMenu(event, deploymentName, deploymentNamespace) {
    showContextMenu(event, [
        { icon: 'bi-file-text', label: 'Ver Logs', action: () => showDeploymentLogs(deploymentName, deploymentNamespace) },
        { icon: 'bi-eye', label: 'Detalhes', action: () => showDeploymentDetails(deploymentName, deploymentNamespace) },
        { icon: 'bi-file-code', label: 'YAML', action: () => showDeploymentYAML(deploymentName, deploymentNamespace) },
        { icon: 'bi-arrow-clockwise', label: 'Reiniciar', action: () => restartDeployment(deploymentName, deploymentNamespace) },
        { icon: 'bi-arrows-fullscreen', label: 'Escalar', action: () => scaleDeployment(deploymentName, deploymentNamespace) }
    ]);
}

// Função para mostrar logs de um deployment (logs agregados de todos os pods)
async function showDeploymentLogs(deploymentName, deploymentNamespace) {
    try {
        showLoading(true);
        
        // Parar streaming anterior se estiver ativo
        stopLogsStreaming();
        
        // Limpar informações de pod individual
        currentPodName = null;
        currentPodNamespace = null;
        
        // Buscar pods do deployment
        const pods = await ipcRenderer.invoke('get-deployment-pods', currentConnectionId, deploymentName, deploymentNamespace);
        
        if (!pods || pods.length === 0) {
            showToast('Nenhum pod encontrado para este deployment', 'warning');
            showLoading(false);
            return;
        }
        
        // Armazenar informações para exibição
        currentDeploymentName = deploymentName;
        currentDeploymentNamespace = deploymentNamespace;
        currentDeploymentPods = pods;
        
        // Atualizar título
        if (elements.podLogsTitle) {
            elements.podLogsTitle.textContent = `${deploymentName} (${pods.length} pod${pods.length !== 1 ? 's' : ''})`;
        }
        
        // Atualizar botão de voltar
        const backBtn = document.getElementById('backToPodsBtn');
        if (backBtn) {
            backBtn.innerHTML = '<span class="btn-icon">←</span>';
        }
        
        // Limpar logs anteriores
        clearLogs();
        
        // Sempre reinicializar o LogViewer
        initializeLogViewer();
        
        // Mostrar seção de logs
        switchSection('podLogs');
        
        // Carregar pods e containers
        await loadDeploymentPodsAndContainers(pods);
        
        // Iniciar streaming de logs agregados
        if (currentConnectionId) {
            startDeploymentLogsStreaming(deploymentName, deploymentNamespace, pods);
        }
        
        showLoading(false);
    } catch (error) {
        console.error('Erro ao mostrar logs do deployment:', error);
        showError(`Erro ao carregar logs: ${error.message}`);
        showLoading(false);
    }
}

// Função para carregar pods e containers do deployment
async function loadDeploymentPodsAndContainers(pods) {
    try {
        if (!elements.containerSelect) {
            console.error('Elemento containerSelect não encontrado!');
            return;
        }

        // Limpar dropdown
        elements.containerSelect.innerHTML = '<option value="">Todos os pods e containers</option>';

        // Adicionar opção para ver todos os containers
        const allContainersOption = document.createElement('optgroup');
        allContainersOption.label = 'Filtrar por container (todos os pods)';
        
        // Coletar containers únicos de todos os pods
        const containerNames = new Set();
        
        for (const pod of pods) {
            try {
                const containers = await ipcRenderer.invoke('get-pod-containers', currentConnectionId, pod.name, pod.namespace);
                containers.forEach(container => {
                    containerNames.add(container.name);
                });
            } catch (error) {
                console.error(`Erro ao carregar containers do pod ${pod.name}:`, error);
            }
        }

        // Adicionar containers únicos
        Array.from(containerNames).sort().forEach(containerName => {
            const option = document.createElement('option');
            option.value = `container:${containerName}`;
            option.textContent = `📦 ${containerName}`;
            allContainersOption.appendChild(option);
        });
        
        if (containerNames.size > 0) {
            elements.containerSelect.appendChild(allContainersOption);
        }

        // Adicionar opção para filtrar por pod específico
        const podsOptgroup = document.createElement('optgroup');
        podsOptgroup.label = 'Filtrar por pod específico';
        
        pods.forEach(pod => {
            const option = document.createElement('option');
            option.value = `pod:${pod.name}`;
            // Truncar nome se for muito longo
            const displayName = pod.name.length > 30 ? 
                pod.name.substring(0, 27) + '...' : 
                pod.name;
            option.textContent = `🔷 ${displayName}`;
            option.title = pod.name; // Tooltip com nome completo
            podsOptgroup.appendChild(option);
        });
        
        elements.containerSelect.appendChild(podsOptgroup);

    } catch (error) {
        console.error('Erro ao carregar pods e containers do deployment:', error);
        if (elements.containerSelect) {
            elements.containerSelect.innerHTML = '<option value="">Todos os pods e containers</option>';
        }
    }
}

// Função para iniciar streaming de logs agregados do deployment
async function startDeploymentLogsStreaming(deploymentName, deploymentNamespace, pods) {
    if (logsStreaming) {
        stopLogsStreaming();
    }

    try {
        logsStreaming = true;
        logsPaused = false;

        // Atualizar botão de pausa
        if (elements.pauseLogsBtn) {
            elements.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';
        }

        // Limpar logs anteriores
        clearLogs();

        // Obter filtro selecionado
        const selectedFilter = elements.containerSelect ? elements.containerSelect.value : '';
        
        let podsToStream = pods;
        let containerFilter = '';
        let filterMessage = '';

        // Analisar o filtro selecionado
        if (selectedFilter) {
            if (selectedFilter.startsWith('pod:')) {
                // Filtrar por pod específico
                const podName = selectedFilter.substring(4);
                podsToStream = pods.filter(p => p.name === podName);
                filterMessage = ` (pod: ${podName})`;
            } else if (selectedFilter.startsWith('container:')) {
                // Filtrar por container específico em todos os pods
                containerFilter = selectedFilter.substring(10);
                filterMessage = ` (container: ${containerFilter})`;
            }
        }

        // Mostrar mensagem de início
        const startEntry = {
            id: 'start-deployment-logs',
            timestamp: new Date().toISOString(),
            podName: deploymentName,
            level: 'info',
            message: `📊 Iniciando streaming de logs do deployment ${deploymentName}${filterMessage} (${podsToStream.length} pod${podsToStream.length !== 1 ? 's' : ''})...`,
            raw: `Iniciando streaming de logs do deployment ${deploymentName}`
        };
        addLogEntry(startEntry);

        // Iniciar streaming para cada pod filtrado
        for (const pod of podsToStream) {
            try {
                const result = await ipcRenderer.invoke('stream-pod-logs', 
                    currentConnectionId, 
                    pod.name, 
                    pod.namespace, 
                    containerFilter || null,
                    30 // sinceSeconds para pegar logs recentes
                );
                
                if (!result || !result.success) {
                    throw new Error(result?.message || 'Falha ao iniciar streaming');
                }
            } catch (error) {
                console.error(`Erro ao iniciar streaming de logs do pod ${pod.name}:`, error);
                const errorEntry = {
                    id: `error-${pod.name}-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    podName: pod.name,
                    level: 'error',
                    message: `❌ Erro ao carregar logs do pod ${pod.name}: ${error.message}`,
                    raw: `Erro ao carregar logs do pod ${pod.name}`
                };
                addLogEntry(errorEntry);
            }
        }
        
    } catch (error) {
        console.error('Erro ao iniciar streaming de logs do deployment:', error);
        showError('Erro ao carregar logs: ' + error.message);
    }
}

// Função para mostrar detalhes de um deployment
async function showDeploymentDetails(deploymentName, deploymentNamespace) {
    try {
        showLoading(true);
        
        // Buscar detalhes do deployment
        const deploymentDetails = await ipcRenderer.invoke('get-deployment-details', currentConnectionId, deploymentName, deploymentNamespace);
        
        if (!deploymentDetails) {
            showError('Detalhes do deployment não encontrados');
            showLoading(false);
            return;
        }
        
        // Atualizar título
        const titleElement = document.getElementById('deploymentDetailsTitle');
        if (titleElement) {
            titleElement.textContent = `Detalhes do Deployment: ${deploymentName}`;
        }
        
        // Renderizar detalhes usando o container
        const detailsContainer = document.getElementById('deploymentDetailsContainer');
        if (detailsContainer) {
            renderDeploymentDetails(deploymentDetails, detailsContainer);
        }
        
        // Configurar botões de ação
        setupDeploymentDetailsButtons(deploymentName, deploymentNamespace);
        
        // Mostrar seção de detalhes
        switchSection('deploymentDetails');
        
        showLoading(false);
    } catch (error) {
        console.error('Erro ao carregar detalhes do deployment:', error);
        showError(`Erro ao carregar detalhes: ${error.message}`);
        showLoading(false);
    }
}

// Função para renderizar detalhes do deployment
function renderDeploymentDetails(deployment, container) {
    const d = deployment;
    
    // Calcular status geral
    const isReady = d.status.readyReplicas === d.status.replicas && d.status.replicas > 0;
    const statusClass = isReady ? 'running' : (d.status.readyReplicas > 0 ? 'pending' : 'failed');
    const statusText = isReady ? 'Ready' : (d.status.readyReplicas > 0 ? 'Progressing' : 'Unavailable');
    
    // Renderizar condições
    const conditionsHTML = d.status.conditions
        .map(condition => `
            <div class="condition-item">
                <div class="condition-header">
                    <span class="condition-type">${condition.type}</span>
                    <span class="condition-status status-${condition.status === 'True' ? 'running' : 'failed'}">
                        ${condition.status}
                    </span>
                </div>
                ${condition.reason ? `<div class="condition-reason">${condition.reason}</div>` : ''}
                ${condition.message ? `<div class="condition-message">${condition.message}</div>` : ''}
                <div class="condition-time">Última transição: ${new Date(condition.lastTransitionTime).toLocaleString('pt-BR')}</div>
            </div>
        `)
        .join('');
    
    // Renderizar containers
    const containersHTML = d.template.containers
        .map(container => `
            <div class="container-detail">
                <h4>${container.name}</h4>
                <div class="detail-row">
                    <span class="detail-label">Imagem:</span>
                    <span class="detail-value container-image-full">${container.image}</span>
                </div>
                ${container.ports && container.ports.length > 0 ? `
                    <div class="detail-row">
                        <span class="detail-label">Portas:</span>
                        <div class="ports-list">
                            ${container.ports.map(port => `
                                <div class="port-item">
                                    <span class="port-name">${port.name || '-'}:</span>
                                    <span class="port-value">${port.containerPort}/${port.protocol || 'TCP'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                ${container.resources && (container.resources.requests || container.resources.limits) ? `
                    <div class="detail-row">
                        <span class="detail-label">Recursos:</span>
                        <div class="resources-grid">
                            ${container.resources.requests ? `
                                <div class="resource-group">
                                    <span class="resource-label">Requests:</span>
                                    <div class="resource-values">
                                        ${container.resources.requests.cpu ? `<div>CPU: ${container.resources.requests.cpu}</div>` : ''}
                                        ${container.resources.requests.memory ? `<div>Memory: ${container.resources.requests.memory}</div>` : ''}
                                    </div>
                                </div>
                            ` : ''}
                            ${container.resources.limits ? `
                                <div class="resource-group">
                                    <span class="resource-label">Limits:</span>
                                    <div class="resource-values">
                                        ${container.resources.limits.cpu ? `<div>CPU: ${container.resources.limits.cpu}</div>` : ''}
                                        ${container.resources.limits.memory ? `<div>Memory: ${container.resources.limits.memory}</div>` : ''}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `)
        .join('');
    
    // Renderizar labels
    const labelsHTML = Object.entries(d.labels)
        .map(([key, value]) => `
            <div class="label-item">
                <span class="label-key">${key}:</span>
                <span class="label-value">${value}</span>
            </div>
        `)
        .join('') || '<p class="no-data-text">Nenhum label definido</p>';
    
    // Renderizar selector
    const selectorHTML = Object.entries(d.selector)
        .map(([key, value]) => `
            <div class="label-item">
                <span class="label-key">${key}:</span>
                <span class="label-value">${value}</span>
            </div>
        `)
        .join('') || '<p class="no-data-text">Nenhum selector definido</p>';
    
    // HTML completo
    container.innerHTML = `
        <div class="pod-details-content">
            <div class="details-section">
                <h3>Informações Básicas</h3>
                <div class="details-grid">
                    <div class="detail-row">
                        <span class="detail-label">Nome:</span>
                        <span class="detail-value">${d.name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Namespace:</span>
                        <span class="detail-value">${d.namespace}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Réplicas:</span>
                        <span class="detail-value">${d.status.replicas || 0} total, ${d.status.readyReplicas || 0} ready, ${d.status.updatedReplicas || 0} updated, ${d.status.availableReplicas || 0} available</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Estratégia:</span>
                        <span class="detail-value">${d.strategy.type || 'RollingUpdate'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Criado em:</span>
                        <span class="detail-value">${new Date(d.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <div class="detail-row full-width">
                        <span class="detail-label">UID:</span>
                        <span class="detail-value uid-text">${d.uid}</span>
                    </div>
                </div>
            </div>

            <div class="details-section">
                <h3>Condições</h3>
                <div class="conditions-list">
                    ${conditionsHTML}
                </div>
            </div>

            <div class="details-section">
                <h3>Selector</h3>
                <div class="labels-list">
                    ${selectorHTML}
                </div>
            </div>

            <div class="details-section">
                <h3>Labels</h3>
                <div class="labels-list">
                    ${labelsHTML}
                </div>
            </div>

            <div class="details-section">
                <h3>Template - Containers</h3>
                <div class="containers-list">
                    ${containersHTML}
                </div>
            </div>
        </div>
    `;
}

// Função para configurar botões de ação nos detalhes do deployment
function setupDeploymentDetailsButtons(deploymentName, deploymentNamespace) {
    // Botão voltar
    const backBtn = document.getElementById('backToDeploymentsBtn');
    if (backBtn) {
        backBtn.replaceWith(backBtn.cloneNode(true));
        const newBackBtn = document.getElementById('backToDeploymentsBtn');
        newBackBtn.addEventListener('click', () => {
            switchSection('deployments');
            loadCurrentSection();
        });
    }
    
    // Botão ver logs
    const logsBtn = document.getElementById('viewDeploymentLogsBtn');
    if (logsBtn) {
        logsBtn.replaceWith(logsBtn.cloneNode(true));
        const newLogsBtn = document.getElementById('viewDeploymentLogsBtn');
        newLogsBtn.addEventListener('click', async () => {
            await showDeploymentLogs(deploymentName, deploymentNamespace);
        });
    }
    
    // Botão ver YAML
    const yamlBtn = document.getElementById('viewDeploymentYAMLBtn');
    if (yamlBtn) {
        yamlBtn.replaceWith(yamlBtn.cloneNode(true));
        const newYamlBtn = document.getElementById('viewDeploymentYAMLBtn');
        newYamlBtn.addEventListener('click', async () => {
            await showDeploymentYAML(deploymentName, deploymentNamespace);
        });
    }
}

// Função para reiniciar um deployment
async function restartDeployment(deploymentName, deploymentNamespace) {
    try {
        const confirmed = confirm(`Deseja realmente reiniciar o deployment "${deploymentName}"?\n\nIsso irá reiniciar todos os pods do deployment.`);
        if (!confirmed) return;
        
        showLoading(true);
        await ipcRenderer.invoke('restart-deployment', currentConnectionId, deploymentName, deploymentNamespace);
        showToast(`Deployment "${deploymentName}" reiniciado com sucesso!`, 'success');
        
        // Recarregar lista de deployments
        await loadDeployments();
    } catch (error) {
        console.error('Erro ao reiniciar deployment:', error);
        showError(`Erro ao reiniciar deployment: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Função para escalar um deployment
async function scaleDeployment(deploymentName, deploymentNamespace) {
    try {
        // Buscar número atual de réplicas
        const deployments = await ipcRenderer.invoke('get-deployments', currentConnectionId, deploymentNamespace);
        const deployment = deployments.find(d => d.name === deploymentName);
        
        if (!deployment) {
            showError('Deployment não encontrado');
            return;
        }
        
        const currentReplicas = deployment.replicas || 0;
        
        // Mostrar modal
        showScaleModal(deploymentName, deploymentNamespace, currentReplicas);
    } catch (error) {
        console.error('Erro ao escalar deployment:', error);
        showError(`Erro ao escalar deployment: ${error.message}`);
    }
}

// Função para mostrar o modal de escalar deployment
function showScaleModal(deploymentName, deploymentNamespace, currentReplicas) {
    const modal = document.getElementById('scaleModal');
    const deploymentNameEl = document.getElementById('scaleDeploymentName');
    const namespaceEl = document.getElementById('scaleDeploymentNamespace');
    const currentReplicasEl = document.getElementById('scaleCurrentReplicas');
    const newReplicasInput = document.getElementById('scaleNewReplicas');
    const confirmBtn = document.getElementById('scaleConfirmBtn');
    const cancelBtn = document.getElementById('scaleCancelBtn');
    const closeBtn = document.getElementById('scaleModalClose');
    
    // Preencher informações
    deploymentNameEl.textContent = deploymentName;
    namespaceEl.textContent = deploymentNamespace;
    currentReplicasEl.textContent = currentReplicas;
    newReplicasInput.value = currentReplicas;
    
    // Mostrar modal
    modal.classList.add('show');
    newReplicasInput.focus();
    newReplicasInput.select();
    
    // Função para fechar modal
    const closeModal = () => {
        modal.classList.remove('show');
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        closeBtn.replaceWith(closeBtn.cloneNode(true));
    };
    
    // Handler para confirmar
    const handleConfirm = async () => {
        const replicas = parseInt(newReplicasInput.value, 10);
        
        if (isNaN(replicas) || replicas < 0) {
            showError('Número de réplicas inválido');
            return;
        }
        
        closeModal();
        
        try {
            showLoading(true);
            await ipcRenderer.invoke('scale-deployment', currentConnectionId, deploymentName, deploymentNamespace, replicas);
            showToast(`Deployment "${deploymentName}" escalado para ${replicas} réplica(s)!`, 'success');
            
            // Recarregar lista de deployments
            await loadDeployments();
        } catch (error) {
            console.error('Erro ao escalar deployment:', error);
            showError(`Erro ao escalar deployment: ${error.message}`);
        } finally {
            showLoading(false);
        }
    };
    
    // Event listeners
    document.getElementById('scaleConfirmBtn').addEventListener('click', handleConfirm);
    document.getElementById('scaleCancelBtn').addEventListener('click', closeModal);
    document.getElementById('scaleModalClose').addEventListener('click', closeModal);
    
    // Fechar ao clicar fora do modal
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Confirmar ao pressionar Enter
    newReplicasInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleConfirm();
        }
    });
    
    // Fechar ao pressionar Escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

// Função para mostrar detalhes do pod
async function showPodDetails(podName, podNamespace) {
    try {
        
        // Mostrar loading
        showLoading(true);
        
        // Buscar detalhes do pod
        const podDetails = await ipcRenderer.invoke('get-pod-details', currentConnectionId, podName, podNamespace);
        
        if (podDetails) {
            // Atualizar título
            elements.podDetailsTitle.textContent = `Detalhes do Pod: ${podName}`;
            
            // Preencher informações básicas
            elements.podDetailName.textContent = podDetails.metadata.name;
            elements.podDetailNamespace.textContent = podDetails.metadata.namespace;
            
            // Status com badge colorido
            const status = podDetails.status.phase;
            elements.podDetailStatus.textContent = status;
            elements.podDetailStatus.className = `status-badge ${status.toLowerCase()}`;
            
            // Idade
            const age = await ipcRenderer.invoke('calculate-age', podDetails.metadata.creationTimestamp);
            elements.podDetailAge.textContent = age;
            
            // IP do pod
            elements.podDetailIP.textContent = podDetails.status.podIP || '-';
            
            // Node
            elements.podDetailNode.textContent = podDetails.spec.nodeName || '-';
            
            // Containers
            await renderPodContainers(podDetails);
            
            // Labels
            renderPodLabels(podDetails.metadata.labels || {});
            
            // Environment Variables
            renderPodEnvVars(podDetails);
            
            // Annotations
            renderPodAnnotations(podDetails.metadata.annotations || {});
            
            // Atualizar variáveis globais
            currentPodName = podName;
            currentPodNamespace = podNamespace;
            
            // Mostrar seção de detalhes
            switchSection('podDetails');
            
        } else {
            showError('Pod não encontrado');
        }
        
    } catch (error) {
        console.error('Erro ao carregar detalhes do pod:', error);
        showError('Erro ao carregar detalhes do pod: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Função para recarregar pod (placeholder)
function reloadPod(podName, podNamespace) {
    showError(`Recarregar pod ${podName} em ${podNamespace} - Funcionalidade em desenvolvimento`);
}

// Função para mostrar YAML do pod
async function showPodYaml(podName, podNamespace) {
    try {
        // Mostrar loading
        showLoading(true);
        
        // Buscar YAML do pod
        const yamlContent = await ipcRenderer.invoke('get-pod-yaml', currentConnectionId, podName, podNamespace);
        
        if (yamlContent) {
            // Atualizar título
            elements.podYamlTitle.textContent = `YAML: ${podName}`;
            
            // Armazenar conteúdo
            currentYamlContent = yamlContent;
            
            // Atualizar variáveis globais
            currentPodName = podName;
            currentPodNamespace = podNamespace;
            
            // Mostrar seção de YAML
            switchSection('podYaml');
            
            // Inicializar Monaco Editor
            initializeYamlEditor(yamlContent);
        } else {
            showError('YAML do pod não encontrado');
        }
        
    } catch (error) {
        console.error('Erro ao carregar YAML do pod:', error);
        showError('Erro ao carregar YAML do pod: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Função para inicializar o editor YAML com Prism.js
function initializeYamlEditor(yamlContent) {
    // Limpar container
    elements.yamlEditor.innerHTML = '';

    try {
        const pre = document.createElement('pre');
        pre.className = 'line-numbers';
        const code = document.createElement('code');
        code.className = 'language-yaml';
        code.textContent = yamlContent;
        pre.appendChild(code);
        elements.yamlEditor.appendChild(pre);
        if (typeof Prism !== 'undefined') {
            Prism.highlightElement(code);
        }
    } catch (error) {
        console.error('Erro ao criar editor YAML:', error);
        elements.yamlEditor.innerHTML = '<div style="padding: 20px; color: #f14c4c;">Erro ao criar editor: ' + error.message + '</div>';
    }
}

// Função para copiar YAML para área de transferência
function copyYamlToClipboard() {
    if (!currentYamlContent) {
        showError('Nenhum YAML para copiar');
        return;
    }

    navigator.clipboard.writeText(currentYamlContent).then(() => {
        showToast('YAML copiado para a área de transferência', 'success');
    }).catch(err => {
        showError('Erro ao copiar YAML: ' + err.message);
    });
}

// Função para baixar YAML
function downloadYaml() {
    if (!currentYamlContent) {
        showError('Nenhum YAML para baixar');
        return;
    }

    downloadBlob(currentYamlContent, `pod-${currentPodName}-${currentPodNamespace}.yaml`, 'text/yaml');
    showToast('YAML baixado com sucesso', 'success');
}

// Renderiza um bloco de recurso (CPU/memória) de um container nos detalhes do pod.
function renderContainerResource(label, usage) {
    const showBar = usage.percentage !== null && (usage.hasRequests || usage.hasLimits);

    const allocation = `
        <div class="resource-allocation">
            <span>Allocation</span>
            <span>Requests: ${usage.request}</span>
            ${usage.hasLimits ? `<span>Limits: ${usage.limit}</span>` : ''}
        </div>
    `;

    return `
        <div class="resource-usage">
            <div class="resource-header">
                <span class="resource-label">${label}</span>
                <span class="resource-value${usage.current === null ? ' resource-value-unavailable' : ''}"
                      ${usage.current === null ? 'title="Uso atual indisponível (Metrics Server)"' : ''}>${usage.current ?? 'N/D'}</span>
            </div>
            ${showBar ? `
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${usage.percentage}%"></div>
            </div>
            ` : ''}
            ${allocation}
        </div>
    `;
}

// Monta o descritor de uso de um container. current/percentage nulos significam
// que o Metrics Server não respondeu — nesse caso a UI mostra N/D e omite a
// barra, em vez de exibir um número que o usuário não conseguiria auditar.
function buildContainerUsage(metric, requestValue, limitValue) {
    return {
        current: metric?.current ?? null,
        percentage: metric?.percentage ?? null,
        request: requestValue || '-',
        limit: limitValue || '-',
        hasRequests: !!requestValue,
        hasLimits: !!limitValue
    };
}


// Função auxiliar para converter CPU para millicores (copiada do main.js)
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

// Função auxiliar para converter memória para Mi (copiada do main.js)
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

// Função para renderizar containers do pod
async function renderPodContainers(podDetails) {
    const containersList = elements.podContainersList;
    containersList.innerHTML = '';
    
    if (podDetails.spec.containers) {
        // Buscar métricas reais do pod (usando batch para melhor performance)
        let podMetrics = null;
        try {
            // Tentar usar batch primeiro (mais eficiente)
            const batchResults = await ipcRenderer.invoke('get-pods-metrics-batch', currentConnectionId, [{
                name: podDetails.metadata.name,
                namespace: podDetails.metadata.namespace
            }]);
            
            if (batchResults && batchResults.length > 0) {
                podMetrics = batchResults[0].metrics;
            }
        } catch (error) {
            console.warn('Erro ao buscar métricas em batch, tentando individual:', error);
            // Fallback para chamada individual
            try {
                podMetrics = await ipcRenderer.invoke('get-pod-metrics', currentConnectionId, podDetails.metadata.name, podDetails.metadata.namespace);
            } catch (individualError) {
                console.warn('Erro ao buscar métricas individuais para detalhes do pod:', individualError);
            }
        }

        for (const container of podDetails.spec.containers) {
            const containerDiv = document.createElement('div');
            containerDiv.className = 'container-item';
            
            // Status do container
            const containerStatus = podDetails.status.containerStatuses?.find(cs => cs.name === container.name);
            const status = containerStatus?.ready ? 'Running' : 'Pending';
            const statusClass = containerStatus?.ready ? 'running' : 'pending';
            
            // Recursos
            const requests = container.resources?.requests || {};
            const limits = container.resources?.limits || {};
            
            // O uso vem do Metrics Server; requests/limits vêm do spec do container.
            // As métricas são do pod inteiro, então são repetidas para cada container.
            const cpuUsage = buildContainerUsage(podMetrics?.cpu, requests.cpu, limits.cpu);
            const memoryUsage = buildContainerUsage(podMetrics?.memory, requests.memory, limits.memory);

            containerDiv.innerHTML = `
                <div class="container-header">
                    <div class="container-name">${container.name}</div>
                    <div class="container-status ${statusClass}">${status}</div>
                </div>
                <div class="container-details">
                    <div class="container-detail">
                        <label>Imagem:</label>
                        <span>${container.image}</span>
                    </div>
                    
                    <!-- CPU Usage -->
                    ${renderContainerResource('CPU Usage', cpuUsage)}

                    <!-- Memory Usage -->
                    ${renderContainerResource('Memory Usage', memoryUsage)}

                    <div class="container-detail">
                        <label>Restarts:</label>
                        <span>${containerStatus?.restartCount || 0}</span>
                    </div>
                </div>
            `;
            
            containersList.appendChild(containerDiv);
        }
    }
}

// Função para renderizar labels do pod
function renderPodLabels(labels) {
    const labelsList = elements.podLabelsList;
    labelsList.innerHTML = '';
    
    Object.entries(labels).forEach(([key, value]) => {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'label-item';
        labelDiv.innerHTML = `<span class="label-key">${key}:</span> <span class="label-value">${value}</span>`;
        labelsList.appendChild(labelDiv);
    });
    
    if (Object.keys(labels).length === 0) {
        labelsList.innerHTML = '<div class="no-data">Nenhum label encontrado</div>';
    }
}

// Função para renderizar variáveis de ambiente do pod
function renderPodEnvVars(podDetails) {
    const envVarsList = elements.podEnvVarsList;
    envVarsList.innerHTML = '';
    
    if (podDetails.spec.containers) {
        podDetails.spec.containers.forEach((container, containerIndex) => {
            const containerDiv = document.createElement('div');
            containerDiv.className = 'env-container';
            
            const containerHeader = document.createElement('div');
            containerHeader.className = 'env-container-header';
            containerHeader.innerHTML = `
                <span class="env-container-name">${container.name}</span>
                <span class="env-container-count">${container.env ? container.env.length : 0} variáveis</span>
            `;
            
            const envVarsDiv = document.createElement('div');
            envVarsDiv.className = 'env-vars-grid';
            
            if (container.env && container.env.length > 0) {
                container.env.forEach(envVar => {
                    const envVarDiv = document.createElement('div');
                    envVarDiv.className = 'env-var-item';
                    
                    let value = '';
                    if (envVar.value) {
                        value = envVar.value;
                    } else if (envVar.valueFrom) {
                        if (envVar.valueFrom.secretKeyRef) {
                            value = `Secret: ${envVar.valueFrom.secretKeyRef.name}/${envVar.valueFrom.secretKeyRef.key}`;
                        } else if (envVar.valueFrom.configMapKeyRef) {
                            value = `ConfigMap: ${envVar.valueFrom.configMapKeyRef.name}/${envVar.valueFrom.configMapKeyRef.key}`;
                        } else if (envVar.valueFrom.fieldRef) {
                            value = `Field: ${envVar.valueFrom.fieldRef.fieldPath}`;
                        } else if (envVar.valueFrom.resourceFieldRef) {
                            value = `Resource: ${envVar.valueFrom.resourceFieldRef.resource}`;
                        } else {
                            value = 'Complex reference';
                        }
                    } else {
                        value = '-';
                    }
                    
                    envVarDiv.innerHTML = `
                        <div class="env-var-key">${envVar.name}</div>
                        <div class="env-var-value">${value}</div>
                    `;
                    
                    envVarsDiv.appendChild(envVarDiv);
                });
            } else {
                envVarsDiv.innerHTML = '<div class="no-data">Nenhuma variável de ambiente definida</div>';
            }
            
            containerDiv.appendChild(containerHeader);
            containerDiv.appendChild(envVarsDiv);
            envVarsList.appendChild(containerDiv);
        });
    } else {
        envVarsList.innerHTML = '<div class="no-data">Nenhum container encontrado</div>';
    }
}

// Função para renderizar annotations do pod
function renderPodAnnotations(annotations) {
    const annotationsList = elements.podAnnotationsList;
    annotationsList.innerHTML = '';
    
    Object.entries(annotations).forEach(([key, value]) => {
        const annotationDiv = document.createElement('div');
        annotationDiv.className = 'annotation-item';
        annotationDiv.innerHTML = `<span class="label-key">${key}:</span> <span class="label-value">${value}</span>`;
        annotationsList.appendChild(annotationDiv);
    });
    
    if (Object.keys(annotations).length === 0) {
        annotationsList.innerHTML = '<div class="no-data">Nenhuma annotation encontrada</div>';
    }
}


// Auto-refresh functions
function startAutoRefresh() {
    // Parar qualquer interval anterior
    stopAutoRefresh();

    if (!autoRefreshEnabled) return;

    autoRefreshInterval = setInterval(async () => {
        // Só atualizar se estiver conectado e não estiver na seção de logs ou YAML
        if (currentConnectionId && currentSection !== 'podLogs' && currentSection !== 'deploymentLogs' && currentSection !== 'deploymentYAML') {
            try {
                await loadCurrentSectionSilently();
            } catch (error) {
                console.error('Erro no auto-refresh:', error);
                // Em caso de erro, parar o auto-refresh para evitar spam
                if (error.message.includes('Conexão não encontrada')) {
                    stopAutoRefresh();
                    showError('Conexão perdida. Reconecte ao cluster.');
                }
            }
        }
    }, AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function toggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled;

    if (autoRefreshEnabled && currentConnectionId) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }

    return autoRefreshEnabled;
}

// Versão silenciosa do loadCurrentSection que não mostra loading
async function loadCurrentSectionSilently() {
    if (!currentConnectionId) return;

    try {
        switch (currentSection) {
            case 'pods':
                // Usar updatePodsData para preservar scroll e atualizar apenas dados
                await updatePodsData();
                break;
            case 'deployments':
                await loadDeployments();
                break;
            case 'services':
                await loadServices();
                break;
            case 'namespaces':
                await loadNamespaces();
                break;
        }
    } catch (error) {
        throw error; // Re-throw para que seja capturado pelo auto-refresh
    }
}

// Handler para o botão de auto-refresh
function handleAutoRefreshToggle() {
    const enabled = toggleAutoRefresh();
    updateAutoRefreshButton(enabled);

    // Mostrar feedback visual
    const message = enabled ? 'Auto-atualização ativada (10s)' : 'Auto-atualização desativada';
    const type = enabled ? 'success' : 'info';

    // Mostrar toast notification
    showToast(message, type);
}

// Atualizar aparência do botão de auto-refresh
function updateAutoRefreshButton(enabled) {
    if (enabled) {
        elements.autoRefreshBtn.classList.remove('auto-refresh-disabled');
        elements.autoRefreshBtn.classList.add('auto-refresh-enabled');
        elements.autoRefreshBtn.title = 'Auto-atualização ativa (10s) - Clique para desativar';
        elements.autoRefreshBtn.innerHTML = '<i class="bi bi-alarm auto-refresh-icon"></i> Auto';
    } else {
        elements.autoRefreshBtn.classList.remove('auto-refresh-enabled');
        elements.autoRefreshBtn.classList.add('auto-refresh-disabled');
        elements.autoRefreshBtn.title = 'Auto-atualização desativada - Clique para ativar';
        elements.autoRefreshBtn.innerHTML = '<i class="bi bi-pause auto-refresh-icon"></i> Auto';
    }
}

// Função simples para mostrar toast (opcional)
function showToast(message, type = 'info') {
    // Remover toast anterior se existir
    const existingToast = document.getElementById('toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Criar novo elemento de toast
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = `toast-notification ${type}`;
    toast.textContent = message;

    // Adicionar ao body
    document.body.appendChild(toast);

    // Forçar reflow para garantir que a animação funcione
    toast.offsetHeight;

    // Mostrar toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Remover toast após 3 segundos
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// Adicionar funções ao escopo global para uso em onclick handlers
window.showPodLogs = showPodLogs;
window.showPodDetails = showPodDetails;
window.showPodYaml = showPodYaml;
window.reloadPod = reloadPod;
window.showDeploymentLogs = showDeploymentLogs;
window.showDeploymentDetails = showDeploymentDetails;
window.showDeploymentYAML = showDeploymentYAML;
window.restartDeployment = restartDeployment;
window.scaleDeployment = scaleDeployment;

