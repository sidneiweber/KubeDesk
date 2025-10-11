/**
 * Componente para exibir detalhes de um Deployment
 */
class DeploymentDetails {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.deployment = null;
        this.onBack = null;
        this.onViewLogs = null;
        this.onViewYAML = null;
    }

    /**
     * Inicializa o componente
     */
    initialize() {
        if (!this.container) {
            console.error('Container de detalhes do deployment não encontrado');
            return;
        }
        return this;
    }

    /**
     * Define o handler para voltar à lista
     */
    setOnBack(handler) {
        this.onBack = handler;
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
     * Define o handler para visualizar YAML
     */
    setOnViewYAML(handler) {
        this.onViewYAML = handler;
        return this;
    }

    /**
     * Exibe os detalhes de um deployment
     * @param {Object} deployment - Dados do deployment
     */
    showDetails(deployment) {
        this.deployment = deployment;
        this.render();
    }

    /**
     * Renderiza os detalhes
     */
    render() {
        if (!this.deployment || !this.container) return;

        const deployment = this.deployment;

        // Determinar o status geral
        const status = this.getOverallStatus(deployment);
        const statusClass = status.class;
        const statusText = status.text;

        // Renderizar as condições
        const conditionsHTML = deployment.status.conditions
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

        // Renderizar os containers
        const containersHTML = deployment.template.containers
            .map(container => this.renderContainer(container))
            .join('');

        // Renderizar labels
        const labelsHTML = Object.entries(deployment.labels)
            .map(([key, value]) => `
                <div class="label-item">
                    <span class="label-key">${key}:</span>
                    <span class="label-value">${value}</span>
                </div>
            `)
            .join('') || '<p class="no-data-text">Nenhum label definido</p>';

        // Renderizar selector labels
        const selectorLabelsHTML = Object.entries(deployment.selector)
            .map(([key, value]) => `
                <div class="label-item">
                    <span class="label-key">${key}:</span>
                    <span class="label-value">${value}</span>
                </div>
            `)
            .join('') || '<p class="no-data-text">Nenhum seletor definido</p>';

        this.container.innerHTML = `
            <div class="deployment-details-content">
                <!-- Informações Básicas -->
                <div class="details-section">
                    <h4>Informações Básicas</h4>
                    <div class="details-grid">
                        <div class="detail-item">
                            <label>Nome:</label>
                            <span>${deployment.name}</span>
                        </div>
                        <div class="detail-item">
                            <label>Namespace:</label>
                            <span>${deployment.namespace}</span>
                        </div>
                        <div class="detail-item">
                            <label>Status:</label>
                            <span class="status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <div class="detail-item">
                            <label>UID:</label>
                            <span class="uid-text">${deployment.uid}</span>
                        </div>
                        <div class="detail-item">
                            <label>Criado em:</label>
                            <span>${new Date(deployment.creationTimestamp).toLocaleString('pt-BR')}</span>
                        </div>
                        <div class="detail-item">
                            <label>Estratégia:</label>
                            <span>${deployment.strategy.type}</span>
                        </div>
                    </div>
                </div>

                <!-- Réplicas e Status -->
                <div class="details-section-group">
                    <div class="details-section">
                        <h4>Réplicas</h4>
                        <div class="details-grid">
                            <div class="detail-item">
                                <label>Desejadas:</label>
                                <span>${deployment.replicas}</span>
                            </div>
                            <div class="detail-item">
                                <label>Atualizadas:</label>
                                <span>${deployment.status.updatedReplicas}</span>
                            </div>
                            <div class="detail-item">
                                <label>Prontas:</label>
                                <span class="${deployment.status.readyReplicas === deployment.replicas ? 'ready-ready' : 'ready-not-ready'}">
                                    ${deployment.status.readyReplicas}
                                </span>
                            </div>
                            <div class="detail-item">
                                <label>Disponíveis:</label>
                                <span>${deployment.status.availableReplicas}</span>
                            </div>
                            ${deployment.status.unavailableReplicas ? `
                                <div class="detail-item">
                                    <label>Indisponíveis:</label>
                                    <span class="ready-not-ready">${deployment.status.unavailableReplicas}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="details-section">
                        <h4>Configurações</h4>
                        <div class="details-grid">
                            <div class="detail-item">
                                <label>Min Ready Seconds:</label>
                                <span>${deployment.minReadySeconds}s</span>
                            </div>
                            <div class="detail-item">
                                <label>Progress Deadline:</label>
                                <span>${deployment.progressDeadlineSeconds}s</span>
                            </div>
                            <div class="detail-item">
                                <label>Revision History Limit:</label>
                                <span>${deployment.revisionHistoryLimit}</span>
                            </div>
                            <div class="detail-item">
                                <label>Pausado:</label>
                                <span>${deployment.paused ? 'Sim' : 'Não'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Condições -->
                ${deployment.status.conditions && deployment.status.conditions.length > 0 ? `
                    <div class="details-section">
                        <h4>Condições</h4>
                        <div class="conditions-list">
                            ${conditionsHTML}
                        </div>
                    </div>
                ` : ''}

                <!-- Containers -->
                <div class="details-section">
                    <h4>Containers (${deployment.template.containers.length})</h4>
                    <div class="containers-list">
                        ${containersHTML}
                    </div>
                </div>

                <!-- Labels e Selectores lado a lado -->
                <div class="details-section-group">
                    <div class="details-section">
                        <h4>Labels</h4>
                        <div class="labels-list">
                            ${labelsHTML}
                        </div>
                    </div>

                    <div class="details-section">
                        <h4>Selector</h4>
                        <div class="labels-list">
                            ${selectorLabelsHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    /**
     * Renderiza informações de um container
     */
    renderContainer(container) {
        // Renderizar portas
        const portsHTML = container.ports && container.ports.length > 0
            ? container.ports.map(port => `
                <div class="port-item">
                    <span class="port-name">${port.name || 'unnamed'}:</span>
                    <span class="port-value">${port.containerPort}/${port.protocol || 'TCP'}</span>
                </div>
            `).join('')
            : '<p class="no-data-text">Nenhuma porta exposta</p>';

        // Renderizar recursos
        const resourcesHTML = container.resources && (container.resources.requests || container.resources.limits)
            ? `
                <div class="resources-grid">
                    ${container.resources.requests ? `
                        <div class="resource-group">
                            <label>Requests:</label>
                            <div class="resource-values">
                                ${container.resources.requests.cpu ? `<div>CPU: ${container.resources.requests.cpu}</div>` : ''}
                                ${container.resources.requests.memory ? `<div>Memory: ${container.resources.requests.memory}</div>` : ''}
                            </div>
                        </div>
                    ` : ''}
                    ${container.resources.limits ? `
                        <div class="resource-group">
                            <label>Limits:</label>
                            <div class="resource-values">
                                ${container.resources.limits.cpu ? `<div>CPU: ${container.resources.limits.cpu}</div>` : ''}
                                ${container.resources.limits.memory ? `<div>Memory: ${container.resources.limits.memory}</div>` : ''}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `
            : '<p class="no-data-text">Nenhum recurso definido</p>';

        return `
            <div class="container-item">
                <div class="container-header">
                    <span class="container-name">${container.name}</span>
                </div>
                <div class="container-details">
                    <div class="container-detail full-width">
                        <label>Imagem:</label>
                        <span class="container-image-full">${container.image}</span>
                    </div>
                    <div class="container-detail full-width">
                        <label>Portas:</label>
                        <div class="ports-list">${portsHTML}</div>
                    </div>
                    <div class="container-detail full-width">
                        <label>Recursos:</label>
                        ${resourcesHTML}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Determina o status geral do deployment
     */
    getOverallStatus(deployment) {
        if (deployment.status.readyReplicas === deployment.replicas && deployment.replicas > 0) {
            return { class: 'running', text: 'Available' };
        } else if (deployment.status.readyReplicas > 0) {
            return { class: 'pending', text: 'Progressing' };
        } else {
            return { class: 'failed', text: 'Unavailable' };
        }
    }

    /**
     * Anexa event listeners
     */
    attachEventListeners() {
        // Implementar se necessário
    }

    /**
     * Limpa o componente
     */
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.deployment = null;
    }
}

// Exportar para uso no renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeploymentDetails;
}


