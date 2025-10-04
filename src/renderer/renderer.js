const { ipcRenderer } = require('electron');
const LogViewer = require('./components/LogViewer');

// Estado da aplicação
let currentConnectionId = null;
let currentContext = null;
let kubeconfigPath = null;
let currentSection = 'pods';

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
    followLogsBtn: document.getElementById('followLogsBtn'),
    scrollTopBtn: document.getElementById('scrollTopBtn'),
    scrollBottomBtn: document.getElementById('scrollBottomBtn')
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

elements.followLogsBtn.addEventListener('click', () => {
    if (logViewer) {
        const following = logViewer.toggleFollow();
        elements.followLogsBtn.classList.toggle('following', following);
        elements.followLogsBtn.innerHTML = following
            ? '<span>📍</span> Seguir'
            : '<span>📍</span> Parado';
    }
});

elements.scrollTopBtn.addEventListener('click', () => {
    if (logViewer) {
        logViewer.scrollToTop();
        elements.followLogsBtn.classList.remove('following');
        elements.followLogsBtn.innerHTML = '<span>📍</span> Parado';
    }
});

elements.scrollBottomBtn.addEventListener('click', () => {
    if (logViewer) {
        logViewer.scrollToBottom();
        elements.followLogsBtn.classList.add('following');
        elements.followLogsBtn.innerHTML = '<span>📍</span> Seguir';
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

        // Adicionar ao LogViewer se disponível
        if (logViewer) {
            logViewer.addLog(logEntry);
        }

        // Manter compatibilidade com sistema anterior
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
    console.log(`Log stream ${streamId} ended.`);
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

async function loadPods() {
    try {
        const namespace = elements.namespaceSelect.value; // Passar o valor exato (incluindo 'all')
        const pods = await ipcRenderer.invoke('get-pods', currentConnectionId, namespace);

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
                <td colspan="8" class="no-data">
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

        // Adicionar pods à tabela
        filteredPods.forEach(pod => {
            const row = document.createElement('tr');

            // Destacar namespace quando visualizando todos os namespaces
            const namespaceDisplay = elements.namespaceSelect.value === 'all'
                ? `<span class="namespace-badge">${pod.namespace}</span>`
                : pod.namespace;

            row.innerHTML = `
                <td class="pod-name" data-pod-name="${pod.name}" data-pod-namespace="${pod.namespace}">${pod.name}</td>
                <td class="pod-namespace">${namespaceDisplay}</td>
                <td><span class="status-${pod.status.toLowerCase()}">${pod.status}</span></td>
                <td><span class="ready-${pod.ready.includes('/0') ? 'not-ready' : 'ready'}">${pod.ready}</span></td>
                <td>${pod.restarts}</td>
                <td>${pod.age}</td>
                <td>${pod.node || '-'}</td>
                <td>${pod.ip || '-'}</td>
                <td>
                    <div class="pod-actions">
                        <a href="#" class="action-btn logs-btn" data-pod-name="${pod.name}" data-pod-namespace="${pod.namespace}" title="Ver logs">
                            📋
                        </a>
                    </div>
                </td>
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

    document.getElementById(section + 'Section').classList.add('active');

    // Atualizar breadcrumb
    currentSection = section;
    elements.currentSectionSpan.textContent = section.charAt(0).toUpperCase() + section.slice(1);

    // Gerenciar visibilidade do dashboard header e auto-refresh baseado na seção
    if (section === 'podLogs') {
        // Esconder header na seção de logs
        elements.dashboardHeader.classList.add('hidden');
        // Pausar auto-refresh na seção de logs
        stopAutoRefresh();
    } else {
        // Mostrar header nas outras seções
        elements.dashboardHeader.classList.remove('hidden');
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

    // Garantir que as seções estejam no estado correto
    initializeSections();
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
    // Parar streaming anterior se estiver ativo
    stopLogsStreaming();

    currentPodName = podName;
    currentPodNamespace = podNamespace;

    // Atualizar título
    elements.podLogsTitle.textContent = `${podName}`;

    // Limpar completamente logs anteriores
    clearLogs();

    // Sempre reinicializar o LogViewer para garantir que funcione corretamente
    initializeLogViewer();

    // Carregar containers do pod
    await loadPodContainers();

    // Mostrar seção de logs
    switchSection('podLogs');

    // Iniciar streaming de logs
    startLogsStreaming();
}

function initializeLogViewer() {
    try {
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
        elements.logsContent.innerHTML = '<div style="padding: 20px; color: #f14c4c;">Erro ao inicializar terminal de logs. Usando modo de compatibilidade.</div>';
    }
}

async function loadPodContainers() {
    try {
        const containers = await ipcRenderer.invoke('get-pod-containers', currentConnectionId, currentPodName, currentPodNamespace);

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
    }
}



async function startLogsStreaming() {
    if (!currentConnectionId || !currentPodName || !currentPodNamespace) return;

    try {
        logsStreaming = true;
        logsPaused = false;

        // Atualizar botão de pausa
        elements.pauseLogsBtn.innerHTML = '<span class="btn-icon">⏸️</span> Pausar';

        // Carregar logs iniciais
        await loadInitialLogs();

        // Iniciar streaming de logs reais
        await streamLogs();

    } catch (error) {
        console.error('Erro ao iniciar streaming de logs:', error);
        showError('Erro ao carregar logs: ' + error.message);
    }
}

async function loadInitialLogs() {
    try {
        const selectedContainer = elements.containerSelect.value || null;

        console.log(`Carregando logs iniciais para pod: ${currentPodName} no namespace: ${currentPodNamespace}`);

        // Buscar apenas os logs dos últimos 5 minutos (300 segundos) com limite de linhas
        const logs = await ipcRenderer.invoke('get-pod-logs', currentConnectionId, currentPodName, currentPodNamespace, selectedContainer, 100, 300);

        // Limpar logs anteriores
        logsData = [];

        if (logs.length > 0) {
            // Adicionar todos os logs aos dados primeiro
            logsData = logs;

            // Adicionar logs ao LogViewer se disponível
            if (logViewer) {
                logs.forEach(log => {
                    logViewer.addLog(log);
                });
            }

            updateLogsStats();

            console.log(`Logs iniciais carregados: ${logs.length} entradas`);

        } else {
            // Se não houver logs, mostrar mensagem informativa
            console.log('Nenhum log encontrado no carregamento inicial - aguardando novos logs...');

            const noLogsEntry = {
                id: 'no-logs',
                timestamp: new Date().toISOString(),
                podName: currentPodName,
                level: 'info',
                message: `Aguardando logs do pod ${currentPodName}...`,
                raw: `Aguardando logs do pod ${currentPodName}`
            };
            logsData = [noLogsEntry];

            if (logViewer) {
                logViewer.addLog(noLogsEntry);
            }
        }

    } catch (error) {
        console.error('Erro ao carregar logs iniciais:', error);
        // Se não conseguir carregar logs reais, mostrar mensagem informativa
        const errorEntry = {
            id: 'error-logs',
            timestamp: new Date().toISOString(),
            podName: currentPodName,
            level: 'error',
            message: `Erro ao carregar logs: ${error.message}`,
            raw: `Erro: ${error.message}`
        };
        logsData = [errorEntry];

        if (logViewer) {
            logViewer.addLog(errorEntry);
        } else {
            renderLogEntry(errorEntry);
        }
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
            console.log(`Streaming de logs iniciado com ID: ${currentLogStreamId}`);
            console.log('Modo tempo real ativado');

            // Remover mensagem de "aguardando" se ainda estiver lá
            const waitingMessage = elements.logsContent.querySelector('[data-log-id="no-logs"]');
            if (waitingMessage) {
                waitingMessage.remove();
                logsData = logsData.filter(log => log.id !== 'no-logs');
            }
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

    // Atualizar botão de seguir baseado no LogViewer
    if (logViewer && stats) {
        elements.followLogsBtn.classList.toggle('following', stats.following);
        elements.followLogsBtn.innerHTML = stats.following
            ? '<span>📍</span> Seguir'
            : '<span>📍</span> Parado';
    }
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
    elements.pauseLogsBtn.innerHTML = '<span class="btn-icon">▶️</span> Retomar';
}

function resumeLogsStreaming() {
    logsPaused = false;
    elements.pauseLogsBtn.innerHTML = '<span class="btn-icon">⏸️</span> Pausar';
}

function stopLogsStreaming() {
    if (currentLogStreamId) {
        ipcRenderer.send('stop-stream-pod-logs', currentLogStreamId);
        console.log(`Pedido para parar o stream de logs: ${currentLogStreamId}`);
        currentLogStreamId = null;
    }

    // Limpar o intervalo de polling antigo, por segurança
    if (window.logsInterval) {
        clearInterval(window.logsInterval);
        window.logsInterval = null;
    }

    logsStreaming = false;
    logsPaused = false;

    elements.pauseLogsBtn.innerHTML = '<span class="btn-icon">⏸️</span> Pausar';

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
        icon = '📜';
        text = 'Modo Histórico';
        subtitle = 'Últimos 5 minutos de logs';
    } else {
        icon = '⚡';
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

// Função para mostrar detalhes do pod (placeholder)
function showPodDetails(podName, podNamespace) {
    showError(`Detalhes do pod ${podName} em ${podNamespace} - Funcionalidade em desenvolvimento`);
}

// Função para recarregar pod (placeholder)
function reloadPod(podName, podNamespace) {
    showError(`Recarregar pod ${podName} em ${podNamespace} - Funcionalidade em desenvolvimento`);
}

// Auto-refresh functions
function startAutoRefresh() {
    // Parar qualquer interval anterior
    stopAutoRefresh();

    if (!autoRefreshEnabled) return;

    console.log('Iniciando auto-refresh a cada', AUTO_REFRESH_INTERVAL / 1000, 'segundos');

    autoRefreshInterval = setInterval(async () => {
        // Só atualizar se estiver conectado e não estiver na seção de logs
        if (currentConnectionId && currentSection !== 'podLogs') {
            try {
                console.log('Auto-refresh: atualizando seção', currentSection);
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
        console.log('Parando auto-refresh');
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
    console.log(message);

    // Mostrar toast notification
    showToast(message, type);
}

// Atualizar aparência do botão de auto-refresh
function updateAutoRefreshButton(enabled) {
    if (enabled) {
        elements.autoRefreshBtn.classList.remove('auto-refresh-disabled');
        elements.autoRefreshBtn.classList.add('auto-refresh-enabled');
        elements.autoRefreshBtn.title = 'Auto-atualização ativa (10s) - Clique para desativar';
        elements.autoRefreshBtn.innerHTML = '<span class="auto-refresh-icon">⏱️</span> Auto';
    } else {
        elements.autoRefreshBtn.classList.remove('auto-refresh-enabled');
        elements.autoRefreshBtn.classList.add('auto-refresh-disabled');
        elements.autoRefreshBtn.title = 'Auto-atualização desativada - Clique para ativar';
        elements.autoRefreshBtn.innerHTML = '<span class="auto-refresh-icon">⏸️</span> Auto';
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