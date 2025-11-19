"use strict";
class DeploymentsTable {
    constructor(containerSelector) {
        this.deployments = [];
        this.filteredDeployments = [];
        this.searchTerm = '';
        this.onViewLogs = null;
        this.onViewDetails = null;
        this.onViewYAML = null;
        this.container = document.querySelector(containerSelector);
        this.tableBody = null;
    }
    initialize() {
        if (!this.container) {
            console.error('Container da tabela de deployments não encontrado');
            return this;
        }
        this.tableBody = this.container.querySelector('#deploymentsTableBody');
        if (!this.tableBody) {
            console.error('Tbody da tabela de deployments não encontrado');
            return this;
        }
        return this;
    }
    setOnViewLogs(handler) {
        this.onViewLogs = handler;
        return this;
    }
    setOnViewDetails(handler) {
        this.onViewDetails = handler;
        return this;
    }
    setOnViewYAML(handler) {
        this.onViewYAML = handler;
        return this;
    }
    updateDeployments(deployments) {
        this.deployments = deployments;
        this.applyFilter();
        this.render();
    }
    setSearchTerm(term) {
        this.searchTerm = term.toLowerCase().trim();
        this.applyFilter();
        this.render();
    }
    applyFilter() {
        if (!this.searchTerm) {
            this.filteredDeployments = [...this.deployments];
            return;
        }
        this.filteredDeployments = this.deployments.filter(deployment => deployment.name.toLowerCase().includes(this.searchTerm) ||
            deployment.namespace.toLowerCase().includes(this.searchTerm) ||
            deployment.strategy.toLowerCase().includes(this.searchTerm));
    }
    render() {
        if (!this.tableBody)
            return;
        this.tableBody.innerHTML = '';
        if (this.filteredDeployments.length === 0) {
            this.renderEmptyState();
            return;
        }
        this.filteredDeployments.forEach(deployment => {
            const row = this.createDeploymentRow(deployment);
            this.tableBody.appendChild(row);
        });
        this.attachEventListeners();
    }
    renderEmptyState() {
        const row = document.createElement('tr');
        const message = this.searchTerm
            ? 'Nenhum deployment encontrado com o termo de busca'
            : 'Nenhum deployment encontrado';
        row.innerHTML = `<td colspan="8" class="no-data"><div class="no-data-message"><span>🚀</span><p>${message}</p></div></td>`;
        this.tableBody.appendChild(row);
    }
    createDeploymentRow(deployment) {
        const row = document.createElement('tr');
        row.dataset.deploymentName = deployment.name;
        row.dataset.deploymentNamespace = deployment.namespace;
        const statusClass = this.getStatusClass(deployment);
        const statusText = this.getStatusText(deployment);
        const namespaceDisplay = this.shouldShowNamespaceBadge()
            ? `<span class="namespace-badge">${deployment.namespace}</span>`
            : deployment.namespace;
        const images = deployment.containerImages.map(c => `<div class="container-image" title="${c.name}: ${c.image}">${c.image}</div>`).join('');
        row.innerHTML = `
            <td class="deployment-name" data-deployment-name="${deployment.name}" data-deployment-namespace="${deployment.namespace}">${deployment.name}</td>
            <td class="deployment-namespace">${namespaceDisplay}</td>
            <td><span class="status-${statusClass}">${statusText}</span></td>
            <td><span class="ready-${deployment.readyReplicas === deployment.replicas ? 'ready' : 'not-ready'}">${deployment.ready}</span></td>
            <td>${deployment.upToDate}</td>
            <td>${deployment.available}</td>
            <td>${deployment.age}</td>
            <td class="deployment-images">${images || '-'}</td>
        `;
        return row;
    }
    getStatusClass(deployment) {
        if (deployment.readyReplicas === deployment.replicas && deployment.replicas > 0)
            return 'running';
        if (deployment.readyReplicas > 0)
            return 'pending';
        return 'failed';
    }
    getStatusText(deployment) {
        if (deployment.readyReplicas === deployment.replicas && deployment.replicas > 0)
            return 'Ready';
        if (deployment.readyReplicas > 0)
            return 'Progressing';
        return 'Unavailable';
    }
    shouldShowNamespaceBadge() {
        const namespaceSelect = document.getElementById('namespaceSelect');
        return namespaceSelect && namespaceSelect.value === 'all';
    }
    attachEventListeners() {
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
    getCount() {
        return this.filteredDeployments.length;
    }
    clear() {
        this.deployments = [];
        this.filteredDeployments = [];
        this.render();
    }
}
// Tornar a classe disponível globalmente
window.DeploymentsTable = DeploymentsTable;
//# sourceMappingURL=DeploymentsTable.js.map