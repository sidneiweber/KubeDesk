// Garantir que estamos usando o require do Node.js, não do AMD loader do Monaco
const nodeRequire = window.nodeRequire || window.require || require;
const { ipcRenderer } = nodeRequire('electron');
const LogsScreen = nodeRequire('./components/Logs/LogsScreen');
const { formatAge } = nodeRequire('../shared/formatAge');
const { computePodStatus, podStatusClass } = nodeRequire('../shared/podStatus');
const { escapeHtml, downloadBlob } = nodeRequire('./utils/dom');

// Exposto para os componentes carregados via <script>, que não têm um require
// com caminho relativo confiável a partir de components/.
window.formatAge = formatAge;

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

// Última listagem recebida de cada seção. A busca filtra sobre isto: antes,
// cada tecla digitada disparava uma listagem completa no cluster (duas, no
// caso de pods, por causa das métricas).
const sectionCache = {};

function cacheSection(section, items) {
    sectionCache[section] = items;
    return items;
}

// ---------------------------------------------------------------------------
// Ordenação por coluna
// ---------------------------------------------------------------------------

// { [seção]: { column, direction } }. Sem entrada = ordem que o cluster devolveu.
const sortState = {};

// Data como número, para ordenar Age de verdade: comparar "10m" com "2d" como
// texto colocaria o pod mais novo no fim.
function timeValue(timestamp) {
    const parsed = timestamp ? new Date(timestamp).getTime() : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
}

// Fração de containers prontos, para "1/3" vir antes de "2/3".
function readyValue(readyCount, total) {
    return total > 0 ? readyCount / total : -1;
}

// Como extrair o valor comparável de cada coluna, por seção. Colunas ausentes
// aqui simplesmente não ordenam.
const SORT_ACCESSORS = {
    pods: {
        name: p => p.name,
        namespace: p => p.namespace,
        status: p => p.status,
        ready: p => readyValue(p.readyCount, p.totalContainers),
        restarts: p => p.restarts,
        age: p => timeValue(p.creationTimestamp),
        cpuUsage: p => p.metrics?.cpu?.percentage ?? -1,
        memoryUsage: p => p.metrics?.memory?.percentage ?? -1,
        node: p => p.node,
        ip: p => p.ip
    },
    deployments: {
        name: d => d.name,
        namespace: d => d.namespace,
        status: d => readyValue(d.readyReplicas, d.replicas),
        ready: d => readyValue(d.readyReplicas, d.replicas),
        upToDate: d => d.upToDate,
        available: d => d.available,
        age: d => timeValue(d.creationTimestamp),
        images: d => d.containerImages?.[0]?.image
    },
    services: {
        name: s => s.metadata.name,
        namespace: s => s.metadata.namespace,
        type: s => s.spec.type,
        clusterIP: s => s.spec.clusterIP,
        externalIP: s => (s.spec.externalIPs || []).join(','),
        ports: s => s.spec.ports?.length ?? 0,
        age: s => timeValue(s.metadata.creationTimestamp)
    },
    ingresses: {
        name: i => i.name,
        namespace: i => i.namespace,
        className: i => i.className,
        hosts: i => i.hosts.join(','),
        address: i => i.addresses.join(','),
        ports: i => i.ports.length,
        age: i => timeValue(i.creationTimestamp)
    },
    endpoints: {
        name: e => e.name,
        namespace: e => e.namespace,
        addresses: e => e.addresses.length,
        age: e => timeValue(e.creationTimestamp)
    },
    namespaces: {
        name: n => n.name,
        status: n => n.status,
        age: n => timeValue(n.creationTimestamp)
    }
};

// Devolve uma cópia ordenada; a lista em cache não é mexida, para a ordem
// original continuar disponível.
function sortItems(section, items) {
    const state = sortState[section];
    const accessor = state && SORT_ACCESSORS[section]?.[state.column];
    if (!accessor) return items;

    const factor = state.direction === 'desc' ? -1 : 1;

    return [...items].sort((a, b) => {
        const left = accessor(a);
        const right = accessor(b);

        if (left === right) return 0;
        // Valores ausentes vão sempre para o fim, independente da direção
        if (left === undefined || left === null) return 1;
        if (right === undefined || right === null) return -1;

        const result = typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' });

        return result * factor;
    });
}

// Clique no cabeçalho alterna asc -> desc -> sem ordenação.
function toggleSort(section, column) {
    if (!SORT_ACCESSORS[section]?.[column]) return;

    const current = sortState[section];

    if (!current || current.column !== column) {
        sortState[section] = { column, direction: 'asc' };
    } else if (current.direction === 'asc') {
        sortState[section] = { column, direction: 'desc' };
    } else {
        delete sortState[section];
    }

    SECTION_LOADERS[section]?.({ fromCache: true });
}

// Marca a coluna ordenada no cabeçalho. `aria-sort` é o que leitores de tela
// anunciam, e a seta do CSS pendura nele.
function updateSortIndicators(section) {
    const table = document.querySelector(`#${section}Section table`);
    if (!table) return;

    const state = sortState[section];

    table.querySelectorAll('thead th').forEach(th => {
        const column = th.dataset.column;
        const sortable = Boolean(SORT_ACCESSORS[section]?.[column]);

        th.classList.toggle('sortable', sortable);
        if (sortable && !th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0');

        if (sortable && state && state.column === column) {
            th.setAttribute('aria-sort', state.direction === 'asc' ? 'ascending' : 'descending');
        } else {
            th.removeAttribute('aria-sort');
        }
    });
}

// Recurso aberto nas telas de detalhes/YAML. O estado da tela de logs vive
// dentro de LogsScreen.
let currentPodName = null;
let currentPodNamespace = null;
let currentServiceName = null;
let currentServiceNamespace = null;

// Estado do YAML
let currentYamlContent = '';
let currentDeploymentYamlContent = '';

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
    dismissErrorBtn: document.getElementById('dismissErrorBtn'),

    // Seções de conteúdo
    podsSection: document.getElementById('podsSection'),
    deploymentsSection: document.getElementById('deploymentsSection'),
    servicesSection: document.getElementById('servicesSection'),
    ingressesSection: document.getElementById('ingressesSection'),
    endpointsSection: document.getElementById('endpointsSection'),
    namespacesSection: document.getElementById('namespacesSection'),
    podLogsSection: document.getElementById('podLogsSection'),
    podDetailsSection: document.getElementById('podDetailsSection'),

    // Tabelas
    podsTableBody: document.getElementById('podsTableBody'),
    deploymentsTableBody: document.getElementById('deploymentsTableBody'),
    servicesTableBody: document.getElementById('servicesTableBody'),
    ingressesTableBody: document.getElementById('ingressesTableBody'),
    endpointsTableBody: document.getElementById('endpointsTableBody'),
    namespacesTableBody: document.getElementById('namespacesTableBody'),

    // Contadores
    podsCount: document.getElementById('podsCount'),
    deploymentsCount: document.getElementById('deploymentsCount'),
    servicesCount: document.getElementById('servicesCount'),
    ingressesCount: document.getElementById('ingressesCount'),
    endpointsCount: document.getElementById('endpointsCount'),
    namespacesCount: document.getElementById('namespacesCount'),

    // Logs (o restante dos elementos da tela é resolvido pelo LogsScreen)
    backToPodsBtn: document.getElementById('backToPodsBtn'),

    // Column selectors
    podsColumnSelectorBtn: document.getElementById('podsColumnSelectorBtn'),
    deploymentsColumnSelectorBtn: document.getElementById('deploymentsColumnSelectorBtn'),
    podsColumnSelectorModal: document.getElementById('podsColumnSelectorModal'),
    deploymentsColumnSelectorModal: document.getElementById('deploymentsColumnSelectorModal'),
    podsColumnCheckboxes: document.getElementById('podsColumnCheckboxes'),
    deploymentsColumnCheckboxes: document.getElementById('deploymentsColumnCheckboxes'),

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

// Tela de logs. Recebe por injeção tudo o que precisa do renderer, para não
// depender de nenhuma variável global deste arquivo.
const logsScreen = new LogsScreen({
    ipcRenderer,
    getConnectionId: () => currentConnectionId,
    switchSection: (section) => switchSection(section),
    showError: (message) => showError(message),
    showToast: (message, type) => showToast(message, type),
    showLoading: (show) => showLoading(show)
});
logsScreen.mount();

// Event Listeners
document.addEventListener('DOMContentLoaded', initializeApp);

elements.selectConfigBtn.addEventListener('click', selectKubeconfigFile);
elements.connectBtn.addEventListener('click', connectToCluster);
elements.refreshBtn.addEventListener('click', refreshCurrentSection);
elements.autoRefreshBtn.addEventListener('click', handleAutoRefreshToggle);
elements.searchInput.addEventListener('input', filterCurrentSection);

elements.dismissErrorBtn.addEventListener('click', hideError);

// Nomes clicáveis são <span role="button">: sem isto, o teclado alcança mas
// não aciona
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;

    const target = e.target.closest('span[role="button"][tabindex]');
    if (!target) return;

    e.preventDefault();
    target.click();
});

// Atalhos globais. Antes só o modal de escala e a busca do terminal
// respondiam a teclas.
document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        elements.searchInput.focus();
        elements.searchInput.select();
        return;
    }

    if (e.key === 'F5') {
        e.preventDefault();
        refreshCurrentSection();
        return;
    }

    if (e.key !== 'Escape') return;

    // Escape na busca limpa o termo antes de sair da tela
    if (e.target === elements.searchInput && elements.searchInput.value) {
        elements.searchInput.value = '';
        filterCurrentSection();
        return;
    }

    if (typing) return;

    hideError();
    goBackFromDetailScreen();
});

// De qual listagem cada tela de detalhe/YAML veio.
const PARENT_SECTION = {
    podLogs: 'pods',
    podDetails: 'pods',
    podYaml: 'pods',
    deploymentDetails: 'deployments',
    deploymentYAML: 'deployments',
    serviceDetails: 'services',
    serviceYaml: 'services',
    ingressYaml: 'ingresses',
    endpointYaml: 'endpoints'
};

// Escape volta para a listagem de origem, como o botão de voltar da tela.
function goBackFromDetailScreen() {
    const parent = PARENT_SECTION[currentSection];
    if (!parent) return;

    if (currentSection === 'podLogs') {
        const wasDeploymentMode = logsScreen.isDeploymentMode();
        logsScreen.close();
        switchSection(wasDeploymentMode ? 'deployments' : 'pods');
        return;
    }

    switchSection(parent);
}

// Ordenação: clique ou Enter/Espaço no cabeçalho
for (const section of Object.keys(SORT_ACCESSORS)) {
    const table = document.querySelector(`#${section}Section table`);
    if (!table) continue;

    const thead = table.querySelector('thead');

    thead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-column]');
        if (th) toggleSort(section, th.dataset.column);
    });

    thead.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;

        const th = e.target.closest('th[data-column]');
        if (!th) return;

        e.preventDefault();
        toggleSort(section, th.dataset.column);
    });
}

// Botões de ação das linhas, por delegação: as linhas são recriadas a cada
// atualização, então ligar listener em cada botão seria refeito toda hora
elements.podsTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    e.stopPropagation();
    const { podName, podNamespace } = btn.closest('tr').dataset;

    if (btn.dataset.action === 'logs') logsScreen.showPod(podName, podNamespace);
    else if (btn.dataset.action === 'details') showPodDetails(podName, podNamespace);
    else if (btn.dataset.action === 'yaml') showPodYaml(podName, podNamespace);
});

elements.deploymentsTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    e.stopPropagation();
    const { deploymentName, deploymentNamespace } = btn.closest('tr').dataset;

    if (btn.dataset.action === 'logs') logsScreen.showDeployment(deploymentName, deploymentNamespace);
    else if (btn.dataset.action === 'details') showDeploymentDetails(deploymentName, deploymentNamespace);
    else if (btn.dataset.action === 'yaml') showDeploymentYAML(deploymentName, deploymentNamespace);
    else if (btn.dataset.action === 'scale') scaleDeployment(deploymentName, deploymentNamespace);
});

elements.servicesTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    e.stopPropagation();
    const { serviceName, serviceNamespace } = btn.closest('tr').dataset;

    if (btn.dataset.action === 'details') showServiceDetails(serviceName, serviceNamespace);
    else if (btn.dataset.action === 'yaml') showServiceYAML(serviceName, serviceNamespace);
});

elements.ingressesTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    e.stopPropagation();
    const { ingressName, ingressNamespace } = btn.closest('tr').dataset;
    if (btn.dataset.action === 'yaml') showIngressYAML(ingressName, ingressNamespace);
});

elements.endpointsTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    e.stopPropagation();
    const { endpointName, endpointNamespace } = btn.closest('tr').dataset;
    if (btn.dataset.action === 'yaml') showEndpointYAML(endpointName, endpointNamespace);
});
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

// Voltar dos logs para a listagem de origem
elements.backToPodsBtn.addEventListener('click', () => {
    const wasDeploymentMode = logsScreen.isDeploymentMode();
    logsScreen.close();

    currentPodName = null;
    currentPodNamespace = null;

    // switchSection() já chama loadCurrentSection() automaticamente
    switchSection(wasDeploymentMode ? 'deployments' : 'pods');
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
        logsScreen.showPod(currentPodName, currentPodNamespace);
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

    // Garantir que não há terminal de logs de uma sessão anterior
    logsScreen.destroyViewer();
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

async function loadNamespaces({ fromCache = false } = {}) {
    try {
        const namespaces = fromCache && sectionCache.namespaces
            ? sectionCache.namespaces
            : cacheSection('namespaces', await ipcRenderer.invoke('get-namespaces', currentConnectionId));

        // Limpar e adicionar namespaces ao dropdown. O select lista sempre
        // todos: quem filtra a tabela é a busca, não o seletor
        const selected = elements.namespaceSelect.value;
        elements.namespaceSelect.innerHTML = '<option value="all">Todos os namespaces</option>';

        namespaces.forEach(ns => {
            const option = document.createElement('option');
            option.value = ns.name;
            option.textContent = ns.name;
            elements.namespaceSelect.appendChild(option);
        });

        if (selected) elements.namespaceSelect.value = selected;

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
            // A busca vale aqui também: o placeholder já prometia "Buscar
            // namespaces...", mas nada filtrava
            const searchTerm = elements.searchInput.value.toLowerCase().trim();
            const filtered = searchTerm
                ? namespaces.filter(ns =>
                    ns.name.toLowerCase().includes(searchTerm) ||
                    ns.status.toLowerCase().includes(searchTerm))
                : namespaces;

            updateSortIndicators('namespaces');
            populateNamespacesTable(sortItems('namespaces', filtered));
            setSectionCount('namespacesCount', `${filtered.length} namespaces`);
        } else {
            elements.namespacesCount.textContent = `${namespaces.length} namespaces`;
        }

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

async function loadDeployments({ fromCache = false } = {}) {
    try {
        const namespace = elements.namespaceSelect.value;
        const deployments = fromCache && sectionCache.deployments
            ? sectionCache.deployments
            : cacheSection('deployments', await ipcRenderer.invoke('get-deployments', currentConnectionId, namespace));

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
        updateSortIndicators('deployments');

        sortItems('deployments', filteredDeployments).forEach(deployment => {
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
                { key: 'name', content: `<td class="deployment-name" data-deployment-name="${deployment.name}" data-deployment-namespace="${deployment.namespace}"><span class="deployment-name-link" role="button" tabindex="0">${deployment.name}</span></td>` },
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

            cells.push(rowActionsCell(DEPLOYMENT_ROW_ACTIONS));

            row.innerHTML = cells.join('');

            // Menu de contexto na linha inteira, não só na célula do nome
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showDeploymentContextMenu(e, row.dataset.deploymentName, row.dataset.deploymentNamespace);
            });
            
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

async function loadServices({ fromCache = false } = {}) {
    try {
        const namespace = elements.namespaceSelect.value;
        const services = fromCache && sectionCache.services
            ? sectionCache.services
            : cacheSection('services', await ipcRenderer.invoke('get-services', currentConnectionId, namespace));

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
        updateSortIndicators('services');

        for (const service of sortItems('services', filteredServices)) {
            const row = document.createElement('tr');
            row.dataset.serviceName = service.metadata.name;
            row.dataset.serviceNamespace = service.metadata.namespace;

            // Calcular idade
            const age = formatAge(service.metadata.creationTimestamp);
            
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
                <td><span class="service-name-link" role="button" tabindex="0" data-service-name="${service.metadata.name}" data-service-namespace="${service.metadata.namespace}">${service.metadata.name}</span></td>
                <td>${namespaceDisplay}</td>
                <td>${service.spec.type}</td>
                <td>${service.spec.clusterIP || '-'}</td>
                <td>${externalIPs}</td>
                <td>${ports}</td>
                <td>${age}</td>
                ${rowActionsCell([
                    { action: 'details', icon: 'bi-eye', label: 'Ver detalhes' },
                    { action: 'yaml', icon: 'bi-file-code', label: 'Ver YAML' }
                ])}
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


// Escreve o total no breadcrumb e no contador oculto da seção, que é a fonte
// lida por updateBreadcrumbCount ao voltar para ela.
function setSectionCount(counterKey, text) {
    elements.currentSectionCount.textContent = text;
    if (elements[counterKey]) elements[counterKey].textContent = text;
}

// Linha de "nenhum resultado" para as tabelas de listagem.
function appendEmptyRow(tbody, { colspan, icon, message }) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td colspan="${colspan}" class="no-data">
            <div class="no-data-message">
                <span class="no-data-icon">${icon}</span>
                <p>${message}</p>
            </div>
        </td>
    `;
    tbody.appendChild(row);
}

// Mensagem de lista vazia levando em conta busca e namespace selecionados.
function emptyListMessage(kind, searchTerm) {
    if (searchTerm) return `Nenhum ${kind} encontrado com o termo de busca`;

    return elements.namespaceSelect.value === 'all'
        ? `Nenhum ${kind} encontrado em nenhum namespace`
        : `Nenhum ${kind} encontrado no namespace "${elements.namespaceSelect.value}"`;
}

// Namespace como badge quando a lista mistura vários namespaces.
function namespaceCell(namespace) {
    return elements.namespaceSelect.value === 'all'
        ? `<span class="namespace-badge">${escapeHtml(namespace)}</span>`
        : escapeHtml(namespace);
}

async function loadIngresses({ fromCache = false } = {}) {
    try {
        const namespace = elements.namespaceSelect.value;
        const ingresses = fromCache && sectionCache.ingresses
            ? sectionCache.ingresses
            : cacheSection('ingresses', await ipcRenderer.invoke('get-ingresses', currentConnectionId, namespace));

        const searchTerm = elements.searchInput.value.toLowerCase().trim();
        const filtered = searchTerm
            ? ingresses.filter(ingress =>
                ingress.name.toLowerCase().includes(searchTerm) ||
                ingress.namespace.toLowerCase().includes(searchTerm) ||
                ingress.className.toLowerCase().includes(searchTerm) ||
                ingress.hosts.some(host => host.toLowerCase().includes(searchTerm)))
            : ingresses;

        elements.ingressesTableBody.innerHTML = '';

        if (filtered.length === 0) {
            appendEmptyRow(elements.ingressesTableBody, {
                colspan: 7,
                icon: '🌐',
                message: emptyListMessage('ingress', searchTerm)
            });
            setSectionCount('ingressesCount', '0 ingresses');
            return;
        }

        updateSortIndicators('ingresses');

        for (const ingress of sortItems('ingresses', filtered)) {
            const row = document.createElement('tr');
            row.dataset.ingressName = ingress.name;
            row.dataset.ingressNamespace = ingress.namespace;

            // Address vazio significa ingress ainda não programado pelo controller
            const address = ingress.addresses.length > 0 ? ingress.addresses.join(', ') : '-';

            row.innerHTML = `
                <td><span class="resource-name-link" role="button" tabindex="0">${escapeHtml(ingress.name)}</span></td>
                <td>${namespaceCell(ingress.namespace)}</td>
                <td>${escapeHtml(ingress.className)}</td>
                <td>${escapeHtml(ingress.hosts.join(', ') || '-')}</td>
                <td>${escapeHtml(address)}</td>
                <td>${escapeHtml(ingress.ports.join(', '))}</td>
                <td>${ingress.age}</td>
                ${rowActionsCell([{ action: 'yaml', icon: 'bi-file-code', label: 'Ver YAML' }])}
            `;

            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e, [
                    { icon: 'bi-file-code', label: 'Ver YAML', action: () => showIngressYAML(ingress.name, ingress.namespace) }
                ]);
            });

            row.querySelector('.resource-name-link').addEventListener('click', (e) => {
                e.stopPropagation();
                showIngressYAML(ingress.name, ingress.namespace);
            });

            elements.ingressesTableBody.appendChild(row);
        }

        setSectionCount('ingressesCount', `${filtered.length} ingresses`);
    } catch (error) {
        console.error('Erro ao carregar ingresses:', error);
        throw error;
    }
}

async function loadEndpoints({ fromCache = false } = {}) {
    try {
        const namespace = elements.namespaceSelect.value;
        const endpoints = fromCache && sectionCache.endpoints
            ? sectionCache.endpoints
            : cacheSection('endpoints', await ipcRenderer.invoke('get-endpoints', currentConnectionId, namespace));

        const searchTerm = elements.searchInput.value.toLowerCase().trim();
        const filtered = searchTerm
            ? endpoints.filter(endpoint =>
                endpoint.name.toLowerCase().includes(searchTerm) ||
                endpoint.namespace.toLowerCase().includes(searchTerm) ||
                endpoint.addresses.some(address => address.toLowerCase().includes(searchTerm)))
            : endpoints;

        elements.endpointsTableBody.innerHTML = '';

        if (filtered.length === 0) {
            appendEmptyRow(elements.endpointsTableBody, {
                colspan: 4,
                icon: '🔌',
                message: emptyListMessage('endpoint', searchTerm)
            });
            setSectionCount('endpointsCount', '0 endpoints');
            return;
        }

        updateSortIndicators('endpoints');

        for (const endpoint of sortItems('endpoints', filtered)) {
            const row = document.createElement('tr');
            row.dataset.endpointName = endpoint.name;
            row.dataset.endpointNamespace = endpoint.namespace;

            // Sem endereços prontos o kubectl mostra <none>; se existirem pods
            // não prontos, dizemos quantos são para diferenciar dos sem backend
            const addresses = endpoint.addresses.length > 0
                ? endpoint.addresses.join(', ')
                : (endpoint.notReadyCount > 0
                    ? `<none> (${endpoint.notReadyCount} não pronto(s))`
                    : '<none>');

            row.innerHTML = `
                <td><span class="resource-name-link" role="button" tabindex="0">${escapeHtml(endpoint.name)}</span></td>
                <td>${namespaceCell(endpoint.namespace)}</td>
                <td class="endpoint-addresses">${escapeHtml(addresses)}</td>
                <td>${endpoint.age}</td>
                ${rowActionsCell([{ action: 'yaml', icon: 'bi-file-code', label: 'Ver YAML' }])}
            `;

            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e, [
                    { icon: 'bi-file-code', label: 'Ver YAML', action: () => showEndpointYAML(endpoint.name, endpoint.namespace) }
                ]);
            });

            row.querySelector('.resource-name-link').addEventListener('click', (e) => {
                e.stopPropagation();
                showEndpointYAML(endpoint.name, endpoint.namespace);
            });

            elements.endpointsTableBody.appendChild(row);
        }

        setSectionCount('endpointsCount', `${filtered.length} endpoints`);
    } catch (error) {
        console.error('Erro ao carregar endpoints:', error);
        throw error;
    }
}

async function showIngressYAML(name, namespace) {
    await showNetworkingYAML({
        channel: 'get-ingress-yaml',
        section: 'ingressYaml',
        titleId: 'ingressYamlTitle',
        titleLabel: 'Ingress',
        containerId: 'ingressYamlContent',
        buttons: {
            backBtnId: 'backToIngressesFromYamlBtn',
            copyBtnId: 'copyIngressYamlBtn',
            downloadBtnId: 'downloadIngressYamlBtn',
            backSection: 'ingresses'
        },
        name,
        namespace
    });
}

async function showEndpointYAML(name, namespace) {
    await showNetworkingYAML({
        channel: 'get-endpoint-yaml',
        section: 'endpointYaml',
        titleId: 'endpointYamlTitle',
        titleLabel: 'Endpoint',
        containerId: 'endpointYamlContent',
        buttons: {
            backBtnId: 'backToEndpointsFromYamlBtn',
            copyBtnId: 'copyEndpointYamlBtn',
            downloadBtnId: 'downloadEndpointYamlBtn',
            backSection: 'endpoints'
        },
        name,
        namespace
    });
}

// Busca o YAML de um recurso de rede e o exibe na sua tela dedicada.
async function showNetworkingYAML({ channel, section, titleId, titleLabel, containerId, buttons, name, namespace }) {
    try {
        showLoading(true);

        const yamlContent = await ipcRenderer.invoke(channel, currentConnectionId, name, namespace);

        if (!yamlContent) {
            showToast(`Não foi possível obter o YAML do ${titleLabel.toLowerCase()}`, 'error');
            showLoading(false);
            return;
        }

        const title = document.getElementById(titleId);
        if (title) title.textContent = `YAML do ${titleLabel}: ${name}`;

        switchSection(section);

        renderYamlEditor(containerId, yamlContent);

        setupYAMLButtons({ ...buttons, name, namespace, yaml: yamlContent });

        showLoading(false);
    } catch (error) {
        console.error(`Erro ao exibir YAML do ${titleLabel.toLowerCase()}:`, error);
        showError(`Erro ao exibir YAML: ${error.message}`);
        showLoading(false);
    }
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
            case 'ingresses':
                await loadIngresses();
                break;
            case 'endpoints':
                await loadEndpoints();
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
        { key: 'status', update: (cell) => { cell.innerHTML = podStatusCell(pod); } },
        { key: 'ready', update: (cell) => { cell.innerHTML = podReadyCell(pod); } },
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
// Célula de ações da linha. As ações antes existiam só no menu de botão
// direito, sem nenhuma pista visual de que estavam lá.
function rowActionsCell(actions) {
    const buttons = actions.map(({ action, icon, label }) =>
        `<button type="button" class="action-btn" data-action="${action}" title="${label}" aria-label="${label}"><i class="bi ${icon}"></i></button>`
    ).join('');

    return `<td class="row-actions">${buttons}</td>`;
}

const POD_ROW_ACTIONS = [
    { action: 'logs', icon: 'bi-file-text', label: 'Ver logs' },
    { action: 'details', icon: 'bi-eye', label: 'Ver detalhes' },
    { action: 'yaml', icon: 'bi-file-code', label: 'Ver YAML' }
];

const DEPLOYMENT_ROW_ACTIONS = [
    { action: 'logs', icon: 'bi-file-text', label: 'Ver logs' },
    { action: 'details', icon: 'bi-eye', label: 'Ver detalhes' },
    { action: 'yaml', icon: 'bi-file-code', label: 'Ver YAML' },
    { action: 'scale', icon: 'bi-arrows-fullscreen', label: 'Escalar' }
];

// Célula de status: a cor vem do motivo (CrashLoopBackOff, Terminating...),
// não da fase.
function podStatusCell(pod) {
    return `<span class="status-${podStatusClass(pod.status)}" title="${escapeHtml(pod.status)}">${escapeHtml(pod.status)}</span>`;
}

// Célula de ready: vermelho enquanto faltar algum container pronto.
function podReadyCell(pod) {
    const allReady = pod.totalContainers > 0 && pod.readyCount === pod.totalContainers;
    return `<span class="ready-${allReady ? 'ready' : 'not-ready'}">${pod.ready}</span>`;
}

function createPodRow(pod) {
    const row = document.createElement('tr');
    row.dataset.podName = pod.name;
    row.dataset.podNamespace = pod.namespace;

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
        { key: 'status', content: `<td>${podStatusCell(pod)}</td>` },
        { key: 'ready', content: `<td>${podReadyCell(pod)}</td>` },
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

    cells.push(rowActionsCell(POD_ROW_ACTIONS));

    row.innerHTML = cells.join('');

    // Adicionar event listeners
    addPodRowListeners(row);
    
    return row;
}

// Função para adicionar event listeners a uma linha
function addPodRowListeners(row) {
    // Menu de contexto na linha inteira, não só na célula do nome
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPodContextMenu(e, row.dataset.podName, row.dataset.podNamespace);
    });

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

// Lista os pods já com as métricas. Buscamos as métricas de todos, e não só
// dos filtrados, porque é isso que permite refiltrar sem voltar ao cluster.
async function fetchPodsWithMetrics() {
    const namespace = elements.namespaceSelect.value; // Valor exato, incluindo 'all'
    const pods = await ipcRenderer.invoke('get-pods', currentConnectionId, namespace);

    try {
        const batchResults = await ipcRenderer.invoke('get-pods-metrics-batch', currentConnectionId, pods);
        return batchResults.map(result => ({ ...result.pod, metrics: result.metrics }));
    } catch (error) {
        console.error('Erro ao buscar métricas em batch, usando fallback individual:', error);
        // Fallback para chamadas individuais se o batch falhar
        return Promise.all(pods.map(async (pod) => {
            try {
                return { ...pod, metrics: await ipcRenderer.invoke('get-pod-metrics', currentConnectionId, pod.name, pod.namespace) };
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
        }));
    }
}

async function loadPods({ fromCache = false } = {}) {
    try {
        const pods = fromCache && sectionCache.pods
            ? sectionCache.pods
            : cacheSection('pods', await fetchPodsWithMetrics());

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

        // Adicionar pods à tabela usando a função que respeita configurações de colunas
        updateSortIndicators('pods');

        sortItems('pods', filteredPods).forEach(pod => {
            const row = createPodRow(pod);
            elements.podsTableBody.appendChild(row);
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
    } else if (section === 'serviceYaml' || section === 'ingressYaml' || section === 'endpointYaml') {
        // Esconder header nas seções de YAML de service/ingress/endpoint
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
    if (section === 'podLogs') {
        setTimeout(() => logsScreen.resize(), 300);
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
        case 'ingresses':
            elements.searchInput.placeholder = 'Buscar ingresses...';
            break;
        case 'endpoints':
            elements.searchInput.placeholder = 'Buscar endpoints...';
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
        case 'ingresses':
            // Usar o contador de ingresses
            if (elements.ingressesCount) {
                elements.currentSectionCount.textContent = elements.ingressesCount.textContent;
            }
            break;
        case 'endpoints':
            // Usar o contador de endpoints
            if (elements.endpointsCount) {
                elements.currentSectionCount.textContent = elements.endpointsCount.textContent;
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

// Digitar na busca só refiltra o que já está carregado — nenhuma chamada ao
// cluster.
const SECTION_LOADERS = {
    pods: loadPods,
    deployments: loadDeployments,
    services: loadServices,
    ingresses: loadIngresses,
    endpoints: loadEndpoints,
    namespaces: loadNamespaces
};

function filterCurrentSection() {
    if (!currentConnectionId) return;

    SECTION_LOADERS[currentSection]?.({ fromCache: true });
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

    // Ações ficam sempre no fim e fora do seletor de colunas
    const actionsHeader = document.createElement('th');
    actionsHeader.className = 'actions-column';
    actionsHeader.textContent = 'Ações';
    thead.appendChild(actionsHeader);
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

// Função para mostrar menu de contexto do pod
function showPodContextMenu(event, podName, podNamespace) {
    showContextMenu(event, [
        { icon: 'bi-file-text', label: 'Ver Logs', action: () => logsScreen.showPod(podName, podNamespace) },
        { icon: 'bi-eye', label: 'Detalhes', action: () => showPodDetails(podName, podNamespace) },
        { icon: 'bi-file-code', label: 'YAML', action: () => showPodYaml(podName, podNamespace) },
        { icon: 'bi-arrow-clockwise', label: 'Reiniciar', action: () => reloadPod(podName, podNamespace) }
    ]);
}

// Função para mostrar menu de contexto de deployment
function showDeploymentContextMenu(event, deploymentName, deploymentNamespace) {
    showContextMenu(event, [
        { icon: 'bi-file-text', label: 'Ver Logs', action: () => logsScreen.showDeployment(deploymentName, deploymentNamespace) },
        { icon: 'bi-eye', label: 'Detalhes', action: () => showDeploymentDetails(deploymentName, deploymentNamespace) },
        { icon: 'bi-file-code', label: 'YAML', action: () => showDeploymentYAML(deploymentName, deploymentNamespace) },
        { icon: 'bi-arrow-clockwise', label: 'Reiniciar', action: () => restartDeployment(deploymentName, deploymentNamespace) },
        { icon: 'bi-arrows-fullscreen', label: 'Escalar', action: () => scaleDeployment(deploymentName, deploymentNamespace) }
    ]);
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
            await logsScreen.showDeployment(deploymentName, deploymentNamespace);
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
            
            // Status com badge colorido, pelo mesmo cálculo usado na lista
            const { status } = computePodStatus(podDetails);
            elements.podDetailStatus.textContent = status;
            elements.podDetailStatus.className = `status-badge ${podStatusClass(status)}`;
            
            // Idade
            const age = formatAge(podDetails.metadata.creationTimestamp);
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
            renderYamlEditor('yamlEditor', yamlContent);
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
            case 'ingresses':
                await loadIngresses();
                break;
            case 'endpoints':
                await loadEndpoints();
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

