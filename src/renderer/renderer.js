"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Estado global
let currentConnectionId = null;
let currentContextName = null;
let currentSection = 'pods';
// Elementos DOM
const elements = {
    kubeconfigPathInput: document.getElementById('kubeconfigPath'),
    selectConfigBtn: document.getElementById('selectConfigBtn'),
    clusterSelect: document.getElementById('clusterSelect'),
    connectBtn: document.getElementById('connectBtn'),
    setupScreen: document.getElementById('setupScreen'),
    dashboardScreen: document.getElementById('dashboardScreen'),
    namespaceSelect: document.getElementById('namespaceSelect'),
    searchInput: document.getElementById('searchInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    podsTableBody: document.getElementById('podsTableBody'),
    deploymentsTableBody: document.getElementById('deploymentsTableBody'),
    servicesTableBody: document.getElementById('servicesTableBody'),
    namespacesTableBody: document.getElementById('namespacesTableBody'),
    currentContext: document.getElementById('currentContext'),
    currentSection: document.getElementById('currentSection'),
    currentSectionCount: document.getElementById('currentSectionCount'),
    navLinks: document.querySelectorAll('.nav-link')
};
// Função para carregar caminho padrão do kubeconfig
async function loadDefaultKubeconfigPath() {
    try {
        const defaultPath = await electron_1.ipcRenderer.invoke('get-kubeconfig-path');
        if (elements.kubeconfigPathInput && defaultPath) {
            elements.kubeconfigPathInput.value = defaultPath;
            // Tentar carregar o kubeconfig automaticamente se o arquivo existir
            try {
                await loadKubeconfig(defaultPath);
            }
            catch (error) {
                const err = error;
                console.log('Arquivo padrão não encontrado ou inválido:', err.message);
            }
        }
    }
    catch (error) {
        console.error('Erro ao carregar caminho padrão:', error);
    }
}
// Função para selecionar arquivo kubeconfig
async function selectKubeconfigFile() {
    try {
        const filePath = await electron_1.ipcRenderer.invoke('select-kubeconfig-file');
        if (filePath && elements.kubeconfigPathInput) {
            elements.kubeconfigPathInput.value = filePath;
            await loadKubeconfig(filePath);
        }
    }
    catch (error) {
        console.error('Erro ao selecionar arquivo:', error);
        const err = error;
        alert('Erro ao selecionar arquivo: ' + err.message);
    }
}
// Função para carregar kubeconfig
async function loadKubeconfig(configPath) {
    try {
        const kubeconfig = await electron_1.ipcRenderer.invoke('load-kubeconfig', configPath);
        // Limpar select de clusters
        if (elements.clusterSelect) {
            elements.clusterSelect.innerHTML = '<option value="">Selecione um cluster</option>';
            // Adicionar contextos ao select
            if (kubeconfig.contexts && kubeconfig.contexts.length > 0) {
                kubeconfig.contexts.forEach(context => {
                    const option = document.createElement('option');
                    option.value = context.name;
                    option.textContent = context.name;
                    if (context.name === kubeconfig.currentContext) {
                        option.selected = true;
                    }
                    elements.clusterSelect.appendChild(option);
                });
                elements.clusterSelect.disabled = false;
                // Habilitar botão de conectar se houver contexto selecionado
                if (elements.connectBtn) {
                    elements.connectBtn.disabled = !elements.clusterSelect.value;
                }
            }
        }
    }
    catch (error) {
        console.error('Erro ao carregar kubeconfig:', error);
        const err = error;
        alert('Erro ao carregar kubeconfig: ' + err.message);
    }
}
// Função para carregar namespaces
async function loadNamespaces() {
    if (!currentConnectionId)
        return;
    try {
        const namespaces = await electron_1.ipcRenderer.invoke('get-namespaces', currentConnectionId);
        if (elements.namespaceSelect) {
            elements.namespaceSelect.innerHTML = '<option value="all">Todos os namespaces</option>';
            namespaces.forEach(ns => {
                const option = document.createElement('option');
                option.value = ns.name;
                option.textContent = ns.name;
                elements.namespaceSelect.appendChild(option);
            });
        }
    }
    catch (error) {
        console.error('Erro ao carregar namespaces:', error);
    }
}
// Função para carregar a seção atual
async function loadCurrentSection() {
    if (!currentConnectionId)
        return;
    try {
        switch (currentSection) {
            case 'pods':
                await loadPods();
                break;
            case 'deployments':
                await loadDeployments();
                break;
            case 'services':
                // TODO: Implementar carregamento de services
                break;
            case 'namespaces':
                await loadNamespacesTable();
                break;
        }
    }
    catch (error) {
        console.error('Erro ao carregar seção:', error);
    }
}
// Função para carregar pods
async function loadPods() {
    if (!currentConnectionId)
        return;
    try {
        const namespace = elements.namespaceSelect?.value || 'all';
        const pods = await electron_1.ipcRenderer.invoke('get-pods', currentConnectionId, namespace);
        if (elements.podsTableBody) {
            elements.podsTableBody.innerHTML = '';
            if (pods.length === 0) {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="10" style="text-align: center; padding: 20px;">Nenhum pod encontrado</td>';
                elements.podsTableBody.appendChild(row);
            }
            else {
                pods.forEach(pod => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
            <td><a href="#" class="pod-name-link" data-pod-name="${pod.name}" data-pod-namespace="${pod.namespace}">${pod.name}</a></td>
            <td>${pod.namespace}</td>
            <td><span class="status-${pod.status.toLowerCase()}">${pod.status}</span></td>
            <td>${pod.ready}</td>
            <td>${pod.restarts}</td>
            <td>${pod.age}</td>
            <td>-</td>
            <td>-</td>
            <td>${pod.node || '-'}</td>
            <td>${pod.ip || '-'}</td>
          `;
                    elements.podsTableBody.appendChild(row);
                });
            }
            // Atualizar contador
            if (elements.currentSectionCount) {
                elements.currentSectionCount.textContent = `${pods.length} pods`;
            }
        }
    }
    catch (error) {
        console.error('Erro ao carregar pods:', error);
    }
}
// Função para carregar deployments
async function loadDeployments() {
    if (!currentConnectionId)
        return;
    try {
        const namespace = elements.namespaceSelect?.value || 'all';
        const deployments = await electron_1.ipcRenderer.invoke('get-deployments', currentConnectionId, namespace);
        if (elements.deploymentsTableBody) {
            elements.deploymentsTableBody.innerHTML = '';
            if (deployments.length === 0) {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="8" style="text-align: center; padding: 20px;">Nenhum deployment encontrado</td>';
                elements.deploymentsTableBody.appendChild(row);
            }
            else {
                deployments.forEach(deployment => {
                    const row = document.createElement('tr');
                    const status = deployment.readyReplicas === deployment.replicas && deployment.readyReplicas > 0 ? 'Running' : 'Pending';
                    const images = deployment.containerImages.map(c => c.image).join(', ');
                    row.innerHTML = `
            <td>${deployment.name}</td>
            <td>${deployment.namespace}</td>
            <td><span class="status-${status.toLowerCase()}">${status}</span></td>
            <td>${deployment.ready}</td>
            <td>${deployment.upToDate}</td>
            <td>${deployment.available}</td>
            <td>${deployment.age}</td>
            <td>${images || '-'}</td>
          `;
                    elements.deploymentsTableBody.appendChild(row);
                });
            }
            // Atualizar contador
            if (elements.currentSectionCount) {
                elements.currentSectionCount.textContent = `${deployments.length} deployments`;
            }
        }
    }
    catch (error) {
        console.error('Erro ao carregar deployments:', error);
    }
}
// Função para carregar tabela de namespaces
async function loadNamespacesTable() {
    if (!currentConnectionId)
        return;
    try {
        const namespaces = await electron_1.ipcRenderer.invoke('get-namespaces', currentConnectionId);
        if (elements.namespacesTableBody) {
            elements.namespacesTableBody.innerHTML = '';
            namespaces.forEach(ns => {
                const row = document.createElement('tr');
                row.innerHTML = `
          <td>${ns.name}</td>
          <td><span class="status-${ns.status.toLowerCase()}">${ns.status}</span></td>
          <td>${ns.age}</td>
        `;
                elements.namespacesTableBody.appendChild(row);
            });
        }
    }
    catch (error) {
        console.error('Erro ao carregar namespaces:', error);
    }
}
// Função para trocar de seção
function switchSection(section) {
    currentSection = section;
    // Atualizar navegação
    if (elements.navLinks) {
        elements.navLinks.forEach(link => {
            link.classList.remove('active');
            const linkSection = link.getAttribute('data-section');
            if (linkSection === section) {
                link.classList.add('active');
            }
        });
    }
    // Atualizar seções
    document.querySelectorAll('.content-section').forEach(sectionEl => {
        sectionEl.classList.remove('active');
    });
    const targetSection = document.getElementById(section + 'Section');
    if (targetSection) {
        targetSection.classList.add('active');
    }
    // Atualizar breadcrumb
    if (elements.currentSection) {
        elements.currentSection.textContent = section.charAt(0).toUpperCase() + section.slice(1);
    }
    // Carregar dados da seção
    if (currentConnectionId) {
        loadCurrentSection();
    }
}
// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Carregar caminho padrão ao inicializar
    await loadDefaultKubeconfigPath();
    // Event listener para botão de selecionar arquivo
    if (elements.selectConfigBtn) {
        elements.selectConfigBtn.addEventListener('click', selectKubeconfigFile);
    }
    // Event listener para mudança no select de cluster
    if (elements.clusterSelect) {
        elements.clusterSelect.addEventListener('change', () => {
            if (elements.connectBtn) {
                elements.connectBtn.disabled = !elements.clusterSelect.value;
            }
        });
    }
    // Event listener para botão de conectar
    if (elements.connectBtn) {
        elements.connectBtn.addEventListener('click', async () => {
            const configPath = elements.kubeconfigPathInput?.value;
            const contextName = elements.clusterSelect?.value;
            if (!configPath || !contextName) {
                alert('Por favor, selecione um arquivo kubeconfig e um cluster');
                return;
            }
            try {
                const result = await electron_1.ipcRenderer.invoke('connect-to-cluster', configPath, contextName);
                if (result.connected) {
                    // Salvar informações da conexão
                    currentConnectionId = result.connectionId;
                    currentContextName = result.context;
                    // Atualizar informações no sidebar
                    if (elements.currentContext) {
                        elements.currentContext.textContent = result.context;
                    }
                    // Esconder tela de setup e mostrar dashboard
                    if (elements.setupScreen) {
                        elements.setupScreen.classList.remove('active');
                    }
                    if (elements.dashboardScreen) {
                        elements.dashboardScreen.classList.add('active');
                    }
                    // Carregar dados iniciais
                    await loadNamespaces();
                    await loadCurrentSection();
                }
            }
            catch (error) {
                const err = error;
                alert('Erro ao conectar: ' + err.message);
            }
        });
    }
    // Atualizar referências aos elementos de navegação
    elements.navLinks = document.querySelectorAll('.nav-link');
    if (elements.navLinks) {
        elements.navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = e.target;
                const navLink = target.closest('.nav-link');
                const section = navLink?.getAttribute('data-section');
                if (section) {
                    switchSection(section);
                }
            });
        });
    }
    // Event listener para mudança de namespace
    if (elements.namespaceSelect) {
        elements.namespaceSelect.addEventListener('change', () => {
            if (currentConnectionId) {
                loadCurrentSection();
            }
        });
    }
    // Event listener para botão de atualizar
    if (elements.refreshBtn) {
        elements.refreshBtn.addEventListener('click', () => {
            if (currentConnectionId) {
                loadCurrentSection();
            }
        });
    }
});
//# sourceMappingURL=renderer.js.map