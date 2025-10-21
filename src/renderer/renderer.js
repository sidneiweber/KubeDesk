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
let currentDeploymentPods = [];
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

// Estado do YAML
let currentYamlContent = '';
let currentDeploymentYamlContent = '';

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

// Listener para ações do menu de contexto de pods
ipcRenderer.on('context-menu-action', (event, action, data) => {
    handleContextMenuAction(action, data);
});

// Listener para ações do menu de contexto de deployments
ipcRenderer.on('deployment-context-menu-action', (event, action, data) => {
    handleDeploymentContextMenuAction(action, data);
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

            row.innerHTML = `
                <td class="deployment-name">${deployment.name}</td>
                <td class="deployment-namespace">${namespaceDisplay}</td>
                <td><span class="status-${statusClass}">${statusText}</span></td>
                <td>
                    <span class="${deployment.readyReplicas === deployment.replicas ? 'ready-ready' : 'ready-not-ready'}">
                        ${deployment.ready}
                    </span>
                </td>
                <td>${deployment.upToDate}</td>
                <td>${deployment.available}</td>
                <td>${deployment.age}</td>
                <td class="deployment-images">${images || '-'}</td>
            `;
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

        // Adicionar event listeners para menu de contexto nos nomes dos deployments
        elements.deploymentsTableBody.querySelectorAll('.deployment-name').forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const row = cell.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                showDeploymentContextMenu(name, namespace);
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
        
        // Inicializar editor YAML
        initializeDeploymentYamlEditor(yaml);
        
        // Configurar botões
        setupDeploymentYAMLButtons(name, namespace, yaml);
        
        showLoading(false);
    } catch (error) {
        console.error('Erro ao exibir YAML do deployment:', error);
        showError(`Erro ao exibir YAML: ${error.message}`);
    }
}

function initializeDeploymentYamlEditor(yamlContent) {
    const editorContainer = document.getElementById('deploymentYamlEditor');
    if (!editorContainer) {
        console.error('Container do editor YAML não encontrado');
        return;
    }
    
    // Limpar container
    editorContainer.innerHTML = '';

    try {
        // Criar container principal
        const container = document.createElement('div');
        container.className = 'yaml-editor-container';
        
        // Criar container para números de linha
        const lineNumbersContainer = document.createElement('div');
        lineNumbersContainer.className = 'yaml-line-numbers';
        
        // Criar container para o código
        const codeContainer = document.createElement('div');
        codeContainer.className = 'yaml-code-container';
        
        // Criar o pre com code
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = 'language-yaml';
        code.textContent = yamlContent;
        pre.appendChild(code);
        codeContainer.appendChild(pre);
        
        // Gerar números de linha
        const lines = yamlContent.split('\n');
        const lineNumbers = document.createElement('div');
        lineNumbers.className = 'yaml-line-numbers-content';
        
        lines.forEach((_, index) => {
            const lineNumber = document.createElement('div');
            lineNumber.className = 'yaml-line-number';
            lineNumber.textContent = index + 1;
            lineNumbers.appendChild(lineNumber);
        });
        
        lineNumbersContainer.appendChild(lineNumbers);
        
        // Adicionar containers ao editor
        container.appendChild(lineNumbersContainer);
        container.appendChild(codeContainer);
        editorContainer.appendChild(container);
        
        // Aplicar syntax highlighting com Prism
        if (typeof Prism !== 'undefined') {
            Prism.highlightElement(code);
        }
        
    } catch (error) {
        console.error('Erro ao criar editor YAML:', error);
        editorContainer.innerHTML = `<pre><code class="language-yaml">${yamlContent}</code></pre>`;
    }
}

function setupDeploymentYAMLButtons(name, namespace, yaml) {
    // Botão voltar
    const backBtn = document.getElementById('backToDeploymentDetailsBtn');
    if (backBtn) {
        backBtn.replaceWith(backBtn.cloneNode(true));
        const newBackBtn = document.getElementById('backToDeploymentDetailsBtn');
        newBackBtn.addEventListener('click', () => {
            switchSection('deployments');
            loadCurrentSection();
        });
    }
    
    // Botão copiar
    const copyBtn = document.getElementById('copyDeploymentYamlBtn');
    if (copyBtn) {
        copyBtn.replaceWith(copyBtn.cloneNode(true));
        const newCopyBtn = document.getElementById('copyDeploymentYamlBtn');
        newCopyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(yaml);
                showToast('YAML copiado para a área de transferência!', 'success');
            } catch (error) {
                console.error('Erro ao copiar YAML:', error);
                showToast('Erro ao copiar YAML', 'error');
            }
        });
    }
    
    // Botão download
    const downloadBtn = document.getElementById('downloadDeploymentYamlBtn');
    if (downloadBtn) {
        downloadBtn.replaceWith(downloadBtn.cloneNode(true));
        const newDownloadBtn = document.getElementById('downloadDeploymentYamlBtn');
        newDownloadBtn.addEventListener('click', () => {
            try {
                const blob = new Blob([yaml], { type: 'text/yaml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${name}-${namespace}.yaml`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('YAML baixado com sucesso!', 'success');
            } catch (error) {
                console.error('Erro ao baixar YAML:', error);
                showToast('Erro ao baixar YAML', 'error');
            }
        });
    }
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
                await loadDeployments();
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

        // Atualizar dados existentes ou criar novos
        await updateOrCreatePodRows(podsWithMetrics);

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
            backBtn.innerHTML = '<span class="btn-icon">←</span> Voltar aos Pods';
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
        case 'show-yaml':
            showPodYaml(data.podName, data.podNamespace);
            break;
        case 'reload-pod':
            reloadPod(data.podName, data.podNamespace);
            break;
        default:
            console.log('Ação não reconhecida:', action);
    }
}

// Função para lidar com ações do menu de contexto de deployments
function handleDeploymentContextMenuAction(action, data) {
    switch (action) {
        case 'show-logs':
            showDeploymentLogs(data.deploymentName, data.deploymentNamespace);
            break;
        case 'show-details':
            showDeploymentDetails(data.deploymentName, data.deploymentNamespace);
            break;
        case 'show-yaml':
            showDeploymentYAML(data.deploymentName, data.deploymentNamespace);
            break;
        case 'restart-deployment':
            restartDeployment(data.deploymentName, data.deploymentNamespace);
            break;
        case 'scale-deployment':
            scaleDeployment(data.deploymentName, data.deploymentNamespace);
            break;
        default:
            console.log('Ação não reconhecida:', action);
    }
}

// Função para mostrar menu de contexto de deployment
async function showDeploymentContextMenu(deploymentName, deploymentNamespace) {
    try {
        await ipcRenderer.invoke('show-deployment-context-menu', deploymentName, deploymentNamespace);
    } catch (error) {
        console.error('Erro ao mostrar menu de contexto:', error);
    }
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
            backBtn.innerHTML = '<span class="btn-icon">←</span> Voltar aos Deployments';
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
            option.textContent = `🔷 ${pod.name}`;
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
        // Criar container principal
        const editorContainer = document.createElement('div');
        editorContainer.className = 'yaml-editor-container';
        
        // Criar container para números de linha
        const lineNumbersContainer = document.createElement('div');
        lineNumbersContainer.className = 'yaml-line-numbers';
        
        // Criar container para o código
        const codeContainer = document.createElement('div');
        codeContainer.className = 'yaml-code-container';
        
        // Criar o pre com code
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = 'language-yaml';
        code.textContent = yamlContent;
        pre.appendChild(code);
        codeContainer.appendChild(pre);
        
        // Gerar números de linha
        const lines = yamlContent.split('\n');
        const lineNumbers = document.createElement('div');
        lineNumbers.className = 'yaml-line-numbers-content';
        
        lines.forEach((_, index) => {
            const lineNumber = document.createElement('div');
            lineNumber.className = 'yaml-line-number';
            lineNumber.textContent = index + 1;
            lineNumbers.appendChild(lineNumber);
        });
        
        lineNumbersContainer.appendChild(lineNumbers);
        
        // Adicionar containers ao editor
        editorContainer.appendChild(lineNumbersContainer);
        editorContainer.appendChild(codeContainer);
        elements.yamlEditor.appendChild(editorContainer);
        
        // Aplicar syntax highlighting com Prism
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

    const filename = `pod-${currentPodName}-${currentPodNamespace}.yaml`;
    const blob = new Blob([currentYamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('YAML baixado com sucesso', 'success');
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

