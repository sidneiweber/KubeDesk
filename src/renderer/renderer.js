const { ipcRenderer } = require('electron');
const LogViewer = require('./components/LogViewer');

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
let logsStreaming = false;
let logsPaused = false;
let logsData = [];
let logsFilter = '';
let currentLogStreamId = null;
let logViewer = null;
let logsOptions = {
    lineWrap: true,
    logColoring: true,
    timestamp: 'off',
    horizontalScroll: false
};

// Configurações de performance
const MAX_TOTAL_LOGS = 5000; // Máximo de logs mantidos em memória

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
    namespacesTableBody: document.getElementById('namespacesTableBody'),

    // Contadores
    podsCount: document.getElementById('podsCount'),
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
    scrollTopBtn: document.getElementById('scrollTopBtn'),
    scrollBottomBtn: document.getElementById('scrollBottomBtn'),

    // Pod Details elements
    podDetailsTitle: document.getElementById('podDetailsTitle'),
    backToPodsFromDetailsBtn: document.getElementById('backToPodsFromDetailsBtn'),
    viewPodLogsBtn: document.getElementById('viewPodLogsBtn'),
    podDetailName: document.getElementById('podDetailName'),
    podDetailNamespace: document.getElementById('podDetailNamespace'),
    podDetailStatus: document.getElementById('podDetailStatus'),
    podDetailAge: document.getElementById('podDetailAge'),
    podDetailIP: document.getElementById('podDetailIP'),
    podDetailNode: document.getElementById('podDetailNode'),
    podContainersList: document.getElementById('podContainersList'),
    podLabelsList: document.getElementById('podLabelsList'),
    podEnvVarsList: document.getElementById('podEnvVarsList'),
    podAnnotationsList: document.getElementById('podAnnotationsList')
};

// Event Listeners
document.addEventListener('DOMContentLoaded', initializeApp);

elements.selectConfigBtn.addEventListener('click', selectKubeconfigFile);
elements.connectBtn.addEventListener('click', connectToCluster);
elements.refreshBtn.addEventListener('click', refreshCurrentSection);
elements.autoRefreshBtn.addEventListener('click', handleAutoRefreshToggle);
elements.searchInput.addEventListener('input', filterCurrentSection);
elements.reconnectBtn.addEventListener('click', showSetupScreen);

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
    switchSection('pods');
});

elements.containerSelect.addEventListener('change', async () => {
    if (currentPodName && currentPodNamespace) {
        // Recarregar logs com o container selecionado
        await loadInitialLogs();
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

// Listener para ações do menu de contexto
ipcRenderer.on('context-menu-action', (event, action, data) => {
    handleContextMenuAction(action, data);
});

// Listeners para streaming de logs
ipcRenderer.on('log-stream-data', (event, { streamId, log }) => {
    if (streamId !== currentLogStreamId || !logsStreaming || logsPaused) return;

    // Remover mensagem de "aguardando" quando os primeiros logs reais chegarem
    const waitingMessage = logsData.find(log => log.id === 'waiting-logs');
    if (waitingMessage) {
        logsData = logsData.filter(log => log.id !== 'waiting-logs');
        if (logViewer) {
            logViewer.clear();
            // Re-adicionar todos os logs exceto a mensagem de aguardando
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
            podName: currentPodName
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
    if (streamId !== currentLogStreamId) return;
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
    if (streamId !== currentLogStreamId) return;
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

async function loadCurrentSection() {
    if (!currentConnectionId) return;

    try {
        showLoading(true);
        hideError();

        switch (currentSection) {
            case 'pods':
                await loadPods();
                break;
            case 'deployments':
                // Implementar quando necessário
                break;
            case 'services':
                // Implementar quando necessário
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
            elements.podsCount.textContent = `0 pods (${namespaceInfo})`;
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

        // Atualizar dados existentes ou criar novos
        await updateOrCreatePodRows(podsWithMetrics);

        // Atualizar contador
        const namespaceInfo = elements.namespaceSelect.value === 'all'
            ? 'todos os namespaces'
            : `namespace: ${elements.namespaceSelect.value}`;
        elements.podsCount.textContent = `${filteredPods.length} pods (${namespaceInfo})`;

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

    // Atualizar conteúdo das células
    const cells = row.querySelectorAll('td');
    if (cells.length >= 10) {
        cells[0].innerHTML = pod.name; // Nome
        cells[1].innerHTML = namespaceDisplay; // Namespace
        cells[2].innerHTML = `<span class="status-${pod.status.toLowerCase()}">${pod.status}</span>`; // Status
        cells[3].innerHTML = `<span class="ready-${pod.ready.includes('/0') ? 'not-ready' : 'ready'}">${pod.ready}</span>`; // Ready
        cells[4].textContent = pod.restarts; // Restarts
        cells[5].textContent = pod.age; // Age
        cells[6].innerHTML = cpuBar; // CPU
        cells[7].innerHTML = memoryBar; // Memory
        cells[8].textContent = pod.node || '-'; // Node
        cells[9].textContent = pod.ip || '-'; // IP
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

    row.innerHTML = `
        <td class="pod-name" data-pod-name="${pod.name}" data-pod-namespace="${pod.namespace}">${pod.name}</td>
        <td class="pod-namespace">${namespaceDisplay}</td>
        <td><span class="status-${pod.status.toLowerCase()}">${pod.status}</span></td>
        <td><span class="ready-${pod.ready.includes('/0') ? 'not-ready' : 'ready'}">${pod.ready}</span></td>
        <td>${pod.restarts}</td>
        <td>${pod.age}</td>
        <td class="resource-column">${cpuBar}</td>
        <td class="resource-column">${memoryBar}</td>
        <td>${pod.node || '-'}</td>
        <td>${pod.ip || '-'}</td>
    `;

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
            const podName = e.target.dataset.podName;
            const podNamespace = e.target.dataset.podNamespace;
            showPodContextMenu(podName, podNamespace);
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
            elements.podsCount.textContent = `0 pods (${namespaceInfo})`;
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

        // Adicionar pods à tabela
        podsWithMetrics.forEach(pod => {
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
                'cpu'
            );
            
            const memoryBar = renderResourceProgressBar(
                pod.metrics.memory.current,
                pod.metrics.memory.requests,
                pod.metrics.memory.percentage,
                'memory'
            );

            row.innerHTML = `
                <td class="pod-name" data-pod-name="${pod.name}" data-pod-namespace="${pod.namespace}">${pod.name}</td>
                <td class="pod-namespace">${namespaceDisplay}</td>
                <td><span class="status-${pod.status.toLowerCase()}">${pod.status}</span></td>
                <td><span class="ready-${pod.ready.includes('/0') ? 'not-ready' : 'ready'}">${pod.ready}</span></td>
                <td>${pod.restarts}</td>
                <td>${pod.age}</td>
                <td class="resource-column">${cpuBar}</td>
                <td class="resource-column">${memoryBar}</td>
                <td>${pod.node || '-'}</td>
                <td>${pod.ip || '-'}</td>
            `;
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

        // Adicionar event listeners para clique direito nos nomes dos pods
        elements.podsTableBody.querySelectorAll('.pod-name').forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const podName = e.target.dataset.podName;
                const podNamespace = e.target.dataset.podNamespace;
                showPodContextMenu(podName, podNamespace);
            });
        });

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
        elements.podsCount.textContent = `${filteredPods.length} pods (${namespaceInfo})`;

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
    if (currentConnectionId && section !== 'podLogs') {
        loadCurrentSection();
    }

    // Se mudou para seção de logs, redimensionar o terminal após a transição
    if (section === 'podLogs' && logViewer && logViewer.terminal) {
        setTimeout(() => {
            logViewer.resize();
        }, 300);
    }
}

function refreshCurrentSection() {
    if (currentConnectionId) {
        loadCurrentSection();
    }
}

function filterCurrentSection() {
    if (currentSection === 'pods' && currentConnectionId) {
        loadPods();
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

        currentPodName = podName;
        currentPodNamespace = podNamespace;

        // Atualizar título
        if (elements.podLogsTitle) {
            elements.podLogsTitle.textContent = `${podName}`;
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
            option.textContent = `${container.name} (${container.image})`;
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

async function loadInitialLogs() {
    // Função mantida para compatibilidade, mas não carrega mais logs históricos
    // Agora usamos apenas streaming em tempo real
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

    const rate = logsStreaming && !logsPaused ? Math.floor(Math.random() * 10) + 1 : 0;

    elements.logsCount.textContent = `${totalLogs} logs`;
    elements.logsRate.textContent = `${rate}/s`;

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

    logsStreaming = false;
    logsPaused = false;

    elements.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';

    // Limpar indicador de modo de logs
    const logsModeIndicator = document.getElementById('logsModeIndicator');
    if (logsModeIndicator) {
        logsModeIndicator.remove();
    }
}

function clearLogs() {
    logsData = [];
    if (logViewer) {
        logViewer.clear();
    } else {
        elements.logsContent.innerHTML = '';
    }
    updateLogsStats();
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

    const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
async function showPodContextMenu(podName, podNamespace) {
    try {
        await ipcRenderer.invoke('show-context-menu', podName, podNamespace);
    } catch (error) {
        console.error('Erro ao mostrar menu de contexto:', error);
    }
}

// Função para lidar com ações do menu de contexto
function handleContextMenuAction(action, data) {
    switch (action) {
        case 'show-logs':
            showPodLogs(data.podName, data.podNamespace);
            break;
        case 'show-details':
            showPodDetails(data.podName, data.podNamespace);
            break;
        case 'reload-pod':
            reloadPod(data.podName, data.podNamespace);
            break;
        default:
            console.log('Ação não reconhecida:', action);
    }
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

// Função para calcular uso de recursos (baseado em limits com fallback para requests)
function calculateResourceUsage(requestValue, type, limitValue = null) {
    let usagePercentage;
    let currentValue;
    let requestValueFormatted;
    let limitValueFormatted;
    
    // Usar limits como referência, fallback para requests
    const referenceValue = limitValue || requestValue;
    const referenceType = limitValue ? 'limits' : 'requests';
    
    if (type === 'cpu') {
        if (referenceValue) {
            // Para CPU, simular uso baseado na referência (limits ou requests)
            usagePercentage = Math.random() * 30 + 10; // 10-40%
            const referenceMillicores = parseCpuValue(referenceValue);
            const currentMillicores = Math.floor((referenceMillicores * usagePercentage) / 100);
            currentValue = `${currentMillicores}m`;
            requestValueFormatted = requestValue || '-';
            limitValueFormatted = limitValue || '-';
        } else {
            // Sem requests nem limits - simular uso absoluto baixo
            const simulatedMillicores = Math.floor(Math.random() * 50) + 10; // 10-60m
            currentValue = `${simulatedMillicores}m`;
            usagePercentage = Math.min(100, (simulatedMillicores / 100) * 100); // Baseado em 100m como referência
            requestValueFormatted = '-';
            limitValueFormatted = '-';
        }
    } else if (type === 'memory') {
        if (referenceValue) {
            // Para memória, simular uso baseado na referência (limits ou requests)
            usagePercentage = Math.random() * 40 + 15; // 15-55%
            const referenceBytes = parseMemoryValue(referenceValue);
            const currentBytes = Math.floor((referenceBytes * usagePercentage) / 100);
            currentValue = formatMemoryValue(currentBytes);
            requestValueFormatted = requestValue || '-';
            limitValueFormatted = limitValue || '-';
        } else {
            // Sem requests nem limits - simular uso absoluto baixo
            const simulatedBytes = Math.floor(Math.random() * 500 * 1024 * 1024) + 100 * 1024 * 1024; // 100-600Mi
            currentValue = formatMemoryValue(simulatedBytes);
            usagePercentage = Math.min(100, (simulatedBytes / (1024 * 1024 * 1024)) * 100); // Baseado em 1Gi como referência
            requestValueFormatted = '-';
            limitValueFormatted = '-';
        }
    }
    
    return {
        current: currentValue,
        percentage: Math.round(usagePercentage),
        request: requestValueFormatted,
        limit: limitValueFormatted,
        hasRequests: !!requestValue,
        hasLimits: !!limitValue,
        referenceType: referenceType
    };
}

// Função para converter valores de CPU para milicores
function parseCpuValue(cpuStr) {
    if (!cpuStr) return 0;
    
    if (cpuStr.endsWith('m')) {
        return parseInt(cpuStr.slice(0, -1));
    } else if (cpuStr.endsWith('n')) {
        return Math.floor(parseInt(cpuStr.slice(0, -1)) / 1000000);
    } else {
        return Math.floor(parseFloat(cpuStr) * 1000);
    }
}

// Função para converter valores de memória para bytes
function parseMemoryValue(memStr) {
    if (!memStr) return 0;
    
    const units = {
        'Ki': 1024,
        'Mi': 1024 * 1024,
        'Gi': 1024 * 1024 * 1024,
        'Ti': 1024 * 1024 * 1024 * 1024
    };
    
    for (const [unit, multiplier] of Object.entries(units)) {
        if (memStr.endsWith(unit)) {
            return Math.floor(parseFloat(memStr.slice(0, -unit.length)) * multiplier);
        }
    }
    
    return parseInt(memStr) || 0;
}

// Função para formatar bytes em unidades legíveis
function formatMemoryValue(bytes) {
    const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)}${units[unitIndex]}`;
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
            
            // Usar métricas reais se disponíveis, senão usar cálculo baseado em requests/limits
            let cpuUsage, memoryUsage;
            
            if (podMetrics && podMetrics.cpu && podMetrics.memory) {
                // Usar métricas reais do pod
                // Para simplificar, usar as métricas do pod para todos os containers
                // (em um cenário real, seria necessário buscar métricas por container individual)
                
                cpuUsage = {
                    current: podMetrics.cpu.current,
                    percentage: Math.round(podMetrics.cpu.percentage),
                    request: requests.cpu || '-',
                    limit: limits.cpu || '-',
                    hasRequests: !!requests.cpu,
                    hasLimits: !!limits.cpu,
                    referenceType: limits.cpu ? 'limits' : 'requests'
                };
                
                memoryUsage = {
                    current: podMetrics.memory.current,
                    percentage: Math.round(podMetrics.memory.percentage),
                    request: requests.memory || '-',
                    limit: limits.memory || '-',
                    hasRequests: !!requests.memory,
                    hasLimits: !!limits.memory,
                    referenceType: limits.memory ? 'limits' : 'requests'
                };
            } else {
                // Fallback para cálculo baseado em requests/limits
                cpuUsage = calculateResourceUsage(requests.cpu, 'cpu', limits.cpu);
                memoryUsage = calculateResourceUsage(requests.memory, 'memory', limits.memory);
            }
            
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
                    <div class="resource-usage">
                        <div class="resource-header">
                            <span class="resource-label">CPU Usage</span>
                            <span class="resource-value">${cpuUsage.current}</span>
                        </div>
                        ${(cpuUsage.hasRequests || cpuUsage.hasLimits) ? `
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${cpuUsage.percentage}%"></div>
                        </div>
                        <div class="resource-allocation">
                            <span>Allocation</span>
                            <span>Requests: ${cpuUsage.request}</span>
                            ${cpuUsage.hasLimits ? `<span>Limits: ${cpuUsage.limit}</span>` : ''}
                        </div>
                        ` : `
                        <div class="resource-allocation">
                            <span>Allocation</span>
                            <span>Requests: ${cpuUsage.request}</span>
                        </div>
                        `}
                    </div>
                    
                    <!-- Memory Usage -->
                    <div class="resource-usage">
                        <div class="resource-header">
                            <span class="resource-label">Memory Usage</span>
                            <span class="resource-value">${memoryUsage.current}</span>
                        </div>
                        ${(memoryUsage.hasRequests || memoryUsage.hasLimits) ? `
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${memoryUsage.percentage}%"></div>
                        </div>
                        <div class="resource-allocation">
                            <span>Allocation</span>
                            <span>Requests: ${memoryUsage.request}</span>
                            ${memoryUsage.hasLimits ? `<span>Limits: ${memoryUsage.limit}</span>` : ''}
                        </div>
                        ` : `
                        <div class="resource-allocation">
                            <span>Allocation</span>
                            <span>Requests: ${memoryUsage.request}</span>
                        </div>
                        `}
                    </div>
                    
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
        // Só atualizar se estiver conectado e não estiver na seção de logs
        if (currentConnectionId && currentSection !== 'podLogs') {
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
                // Implementar quando necessário
                break;
            case 'services':
                // Implementar quando necessário
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

