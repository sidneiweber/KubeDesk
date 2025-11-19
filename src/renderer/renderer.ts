import { ipcRenderer } from 'electron';
import { DeploymentSummary, PodSummary } from '../main/services/types';

// Interfaces
interface KubeConfig {
  clusters: Array<{ name: string; server: string }>;
  contexts: Array<{ name: string; cluster: string; user: string; namespace?: string }>;
  currentContext: string;
}

interface Namespace {
  name: string;
  status: string;
  age: string;
}

interface ConnectionResult {
  connected: boolean;
  context: string;
  connectionId: string;
}

interface DOMElements {
  kubeconfigPathInput: HTMLInputElement | null;
  selectConfigBtn: HTMLButtonElement | null;
  clusterSelect: HTMLSelectElement | null;
  connectBtn: HTMLButtonElement | null;
  setupScreen: HTMLElement | null;
  dashboardScreen: HTMLElement | null;
  namespaceSelect: HTMLSelectElement | null;
  searchInput: HTMLInputElement | null;
  refreshBtn: HTMLButtonElement | null;
  podsTableBody: HTMLTableSectionElement | null;
  deploymentsTableBody: HTMLTableSectionElement | null;
  servicesTableBody: HTMLTableSectionElement | null;
  namespacesTableBody: HTMLTableSectionElement | null;
  currentContext: HTMLElement | null;
  currentSection: HTMLElement | null;
  currentSectionCount: HTMLElement | null;
  navLinks: NodeListOf<HTMLElement>;
}

// Estado global
let currentConnectionId: string | null = null;
let currentContextName: string | null = null;
let currentSection: 'pods' | 'deployments' | 'services' | 'namespaces' = 'pods';

// Elementos DOM
const elements: DOMElements = {
  kubeconfigPathInput: document.getElementById('kubeconfigPath') as HTMLInputElement | null,
  selectConfigBtn: document.getElementById('selectConfigBtn') as HTMLButtonElement | null,
  clusterSelect: document.getElementById('clusterSelect') as HTMLSelectElement | null,
  connectBtn: document.getElementById('connectBtn') as HTMLButtonElement | null,
  setupScreen: document.getElementById('setupScreen'),
  dashboardScreen: document.getElementById('dashboardScreen'),
  namespaceSelect: document.getElementById('namespaceSelect') as HTMLSelectElement | null,
  searchInput: document.getElementById('searchInput') as HTMLInputElement | null,
  refreshBtn: document.getElementById('refreshBtn') as HTMLButtonElement | null,
  podsTableBody: document.getElementById('podsTableBody') as HTMLTableSectionElement | null,
  deploymentsTableBody: document.getElementById('deploymentsTableBody') as HTMLTableSectionElement | null,
  servicesTableBody: document.getElementById('servicesTableBody') as HTMLTableSectionElement | null,
  namespacesTableBody: document.getElementById('namespacesTableBody') as HTMLTableSectionElement | null,
  currentContext: document.getElementById('currentContext'),
  currentSection: document.getElementById('currentSection'),
  currentSectionCount: document.getElementById('currentSectionCount'),
  navLinks: document.querySelectorAll('.nav-link')
};

// Função para carregar caminho padrão do kubeconfig
async function loadDefaultKubeconfigPath(): Promise<void> {
  try {
    const defaultPath: string = await ipcRenderer.invoke('get-kubeconfig-path');
    if (elements.kubeconfigPathInput && defaultPath) {
      elements.kubeconfigPathInput.value = defaultPath;
      // Tentar carregar o kubeconfig automaticamente se o arquivo existir
      try {
        await loadKubeconfig(defaultPath);
      } catch (error) {
        const err = error as Error;
        console.log('Arquivo padrão não encontrado ou inválido:', err.message);
      }
    }
  } catch (error) {
    console.error('Erro ao carregar caminho padrão:', error);
  }
}

// Função para selecionar arquivo kubeconfig
async function selectKubeconfigFile(): Promise<void> {
  try {
    const filePath: string | null = await ipcRenderer.invoke('select-kubeconfig-file');
    if (filePath && elements.kubeconfigPathInput) {
      elements.kubeconfigPathInput.value = filePath;
      await loadKubeconfig(filePath);
    }
  } catch (error) {
    console.error('Erro ao selecionar arquivo:', error);
    const err = error as Error;
    alert('Erro ao selecionar arquivo: ' + err.message);
  }
}

// Função para carregar kubeconfig
async function loadKubeconfig(configPath: string): Promise<void> {
  try {
    const kubeconfig: KubeConfig = await ipcRenderer.invoke('load-kubeconfig', configPath);
    
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
          elements.clusterSelect!.appendChild(option);
        });
        elements.clusterSelect.disabled = false;
        
        // Habilitar botão de conectar se houver contexto selecionado
        if (elements.connectBtn) {
          elements.connectBtn.disabled = !elements.clusterSelect.value;
        }
      }
    }
  } catch (error) {
    console.error('Erro ao carregar kubeconfig:', error);
    const err = error as Error;
    alert('Erro ao carregar kubeconfig: ' + err.message);
  }
}

// Função para carregar namespaces
async function loadNamespaces(): Promise<void> {
  if (!currentConnectionId) return;
  
  try {
    const namespaces: Namespace[] = await ipcRenderer.invoke('get-namespaces', currentConnectionId);
    
    if (elements.namespaceSelect) {
      elements.namespaceSelect.innerHTML = '<option value="all">Todos os namespaces</option>';
      
      namespaces.forEach(ns => {
        const option = document.createElement('option');
        option.value = ns.name;
        option.textContent = ns.name;
        elements.namespaceSelect!.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Erro ao carregar namespaces:', error);
  }
}

// Função para carregar a seção atual
async function loadCurrentSection(): Promise<void> {
  if (!currentConnectionId) return;
  
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
  } catch (error) {
    console.error('Erro ao carregar seção:', error);
  }
}

// Função para carregar pods
async function loadPods(): Promise<void> {
  if (!currentConnectionId) return;
  
  try {
    const namespace: string = elements.namespaceSelect?.value || 'all';
    const pods: PodSummary[] = await ipcRenderer.invoke('get-pods', currentConnectionId, namespace);
    
    if (elements.podsTableBody) {
      elements.podsTableBody.innerHTML = '';
      
      if (pods.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="10" style="text-align: center; padding: 20px;">Nenhum pod encontrado</td>';
        elements.podsTableBody.appendChild(row);
      } else {
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
          elements.podsTableBody!.appendChild(row);
        });
      }
      
      // Atualizar contador
      if (elements.currentSectionCount) {
        elements.currentSectionCount.textContent = `${pods.length} pods`;
      }
    }
  } catch (error) {
    console.error('Erro ao carregar pods:', error);
  }
}

// Função para carregar deployments
async function loadDeployments(): Promise<void> {
  if (!currentConnectionId) return;
  
  try {
    const namespace: string = elements.namespaceSelect?.value || 'all';
    const deployments: DeploymentSummary[] = await ipcRenderer.invoke('get-deployments', currentConnectionId, namespace);
    
    if (elements.deploymentsTableBody) {
      elements.deploymentsTableBody.innerHTML = '';
      
      if (deployments.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="8" style="text-align: center; padding: 20px;">Nenhum deployment encontrado</td>';
        elements.deploymentsTableBody.appendChild(row);
      } else {
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
          elements.deploymentsTableBody!.appendChild(row);
        });
      }
      
      // Atualizar contador
      if (elements.currentSectionCount) {
        elements.currentSectionCount.textContent = `${deployments.length} deployments`;
      }
    }
  } catch (error) {
    console.error('Erro ao carregar deployments:', error);
  }
}

// Função para carregar tabela de namespaces
async function loadNamespacesTable(): Promise<void> {
  if (!currentConnectionId) return;
  
  try {
    const namespaces: Namespace[] = await ipcRenderer.invoke('get-namespaces', currentConnectionId);
    
    if (elements.namespacesTableBody) {
      elements.namespacesTableBody.innerHTML = '';
      
      namespaces.forEach(ns => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${ns.name}</td>
          <td><span class="status-${ns.status.toLowerCase()}">${ns.status}</span></td>
          <td>${ns.age}</td>
        `;
        elements.namespacesTableBody!.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Erro ao carregar namespaces:', error);
  }
}

// Função para trocar de seção
function switchSection(section: 'pods' | 'deployments' | 'services' | 'namespaces'): void {
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
        elements.connectBtn.disabled = !elements.clusterSelect!.value;
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
        const result: ConnectionResult = await ipcRenderer.invoke('connect-to-cluster', configPath, contextName);
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
      } catch (error) {
        const err = error as Error;
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
        const target = e.target as HTMLElement;
        const navLink = target.closest('.nav-link') as HTMLElement;
        const section = navLink?.getAttribute('data-section') as 'pods' | 'deployments' | 'services' | 'namespaces' | null;
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
