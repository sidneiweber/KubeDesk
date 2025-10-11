/**
 * Componente para exibir e gerenciar a tabela de Deployments
 */
class DeploymentsTable {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.tableBody = null;
        this.deployments = [];
        this.filteredDeployments = [];
        this.searchTerm = '';
        this.onViewLogs = null;
        this.onViewDetails = null;
        this.onViewYAML = null;
    }

    /**
     * Inicializa a tabela
     */
    initialize() {
        if (!this.container) {
            console.error('Container da tabela de deployments não encontrado');
            return;
        }

        this.tableBody = this.container.querySelector('#deploymentsTableBody');
        if (!this.tableBody) {
            console.error('Tbody da tabela de deployments não encontrado');
            return;
        }

        return this;
    }

    /**
     * Define o handler para visualizar logs
     */
    setOnViewLogs(handler) {
        this.onViewLogs = handler;
        return this;
    }

    /**
     * Define o handler para visualizar detalhes
     */
    setOnViewDetails(handler) {
        this.onViewDetails = handler;
        return this;
    }

    /**
     * Define o handler para visualizar YAML
     */
    setOnViewYAML(handler) {
        this.onViewYAML = handler;
        return this;
    }

    /**
     * Atualiza os deployments exibidos na tabela
     * @param {Array} deployments - Lista de deployments
     */
    updateDeployments(deployments) {
        this.deployments = deployments;
        this.applyFilter();
        this.render();
    }

    /**
     * Define o termo de busca e filtra a tabela
     * @param {string} term - Termo de busca
     */
    setSearchTerm(term) {
        this.searchTerm = term.toLowerCase().trim();
        this.applyFilter();
        this.render();
    }

    /**
     * Aplica o filtro de busca
     */
    applyFilter() {
        if (!this.searchTerm) {
            this.filteredDeployments = [...this.deployments];
            return;
        }

        this.filteredDeployments = this.deployments.filter(deployment =>
            deployment.name.toLowerCase().includes(this.searchTerm) ||
            deployment.namespace.toLowerCase().includes(this.searchTerm) ||
            deployment.strategy.toLowerCase().includes(this.searchTerm)
        );
    }

    /**
     * Renderiza a tabela
     */
    render() {
        if (!this.tableBody) return;

        // Limpar tabela
        this.tableBody.innerHTML = '';

        // Verificar se há deployments para exibir
        if (this.filteredDeployments.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Renderizar cada deployment
        this.filteredDeployments.forEach(deployment => {
            const row = this.createDeploymentRow(deployment);
            this.tableBody.appendChild(row);
        });

        // Adicionar event listeners
        this.attachEventListeners();
    }

    /**
     * Renderiza o estado vazio
     */
    renderEmptyState() {
        const row = document.createElement('tr');
        const message = this.searchTerm
            ? 'Nenhum deployment encontrado com o termo de busca'
            : 'Nenhum deployment encontrado';

        row.innerHTML = `
            <td colspan="7" class="no-data">
                <div class="no-data-message">
                    <span class="no-data-icon">🚀</span>
                    <p>${message}</p>
                </div>
            </td>
        `;
        this.tableBody.appendChild(row);
    }

    /**
     * Cria uma linha de deployment
     * @param {Object} deployment - Dados do deployment
     * @returns {HTMLElement} Elemento tr
     */
    createDeploymentRow(deployment) {
        const row = document.createElement('tr');
        row.dataset.deploymentName = deployment.name;
        row.dataset.deploymentNamespace = deployment.namespace;

        // Determinar status baseado nas réplicas
        const statusClass = this.getStatusClass(deployment);
        const statusText = this.getStatusText(deployment);

        // Namespace badge se visualizando todos os namespaces
        const namespaceDisplay = this.shouldShowNamespaceBadge()
            ? `<span class="namespace-badge">${deployment.namespace}</span>`
            : deployment.namespace;

        // Imagens dos containers
        const images = deployment.containerImages
            .map(c => `<div class="container-image" title="${c.name}: ${c.image}">${c.image}</div>`)
            .join('');

        row.innerHTML = `
            <td class="deployment-name" data-deployment-name="${deployment.name}" data-deployment-namespace="${deployment.namespace}">
                ${deployment.name}
            </td>
            <td class="deployment-namespace">${namespaceDisplay}</td>
            <td>
                <span class="status-${statusClass}">${statusText}</span>
            </td>
            <td>
                <span class="ready-${deployment.readyReplicas === deployment.replicas ? 'ready' : 'not-ready'}">
                    ${deployment.ready}
                </span>
            </td>
            <td>${deployment.upToDate}</td>
            <td>${deployment.available}</td>
            <td>${deployment.age}</td>
            <td class="deployment-images">${images || '-'}</td>
        `;

        return row;
    }

    /**
     * Determina a classe de status baseado no deployment
     */
    getStatusClass(deployment) {
        if (deployment.readyReplicas === deployment.replicas && deployment.replicas > 0) {
            return 'running';
        } else if (deployment.readyReplicas > 0) {
            return 'pending';
        } else {
            return 'failed';
        }
    }

    /**
     * Determina o texto de status baseado no deployment
     */
    getStatusText(deployment) {
        if (deployment.readyReplicas === deployment.replicas && deployment.replicas > 0) {
            return 'Ready';
        } else if (deployment.readyReplicas > 0) {
            return 'Progressing';
        } else {
            return 'Unavailable';
        }
    }

    /**
     * Verifica se deve mostrar o badge de namespace
     */
    shouldShowNamespaceBadge() {
        const namespaceSelect = document.getElementById('namespaceSelect');
        return namespaceSelect && namespaceSelect.value === 'all';
    }

    /**
     * Anexa event listeners aos botões de ação
     */
    attachEventListeners() {
        // Botões de logs
        this.tableBody.querySelectorAll('.logs-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                if (this.onViewLogs) {
                    this.onViewLogs(name, namespace);
                }
            });
        });

        // Botões de detalhes
        this.tableBody.querySelectorAll('.details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                if (this.onViewDetails) {
                    this.onViewDetails(name, namespace);
                }
            });
        });

        // Botões de YAML
        this.tableBody.querySelectorAll('.yaml-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const name = row.dataset.deploymentName;
                const namespace = row.dataset.deploymentNamespace;
                if (this.onViewYAML) {
                    this.onViewYAML(name, namespace);
                }
            });
        });

        // Clique na linha inteira para detalhes
        this.tableBody.querySelectorAll('tr').forEach(row => {
            if (!row.classList.contains('no-data')) {
                row.addEventListener('click', () => {
                    const name = row.dataset.deploymentName;
                    const namespace = row.dataset.deploymentNamespace;
                    if (this.onViewDetails && name && namespace) {
                        this.onViewDetails(name, namespace);
                    }
                });
            }
        });
    }

    /**
     * Obtém a contagem de deployments filtrados
     */
    getCount() {
        return this.filteredDeployments.length;
    }

    /**
     * Limpa a tabela
     */
    clear() {
        this.deployments = [];
        this.filteredDeployments = [];
        this.render();
    }
}

// Exportar para uso no renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeploymentsTable;
}


