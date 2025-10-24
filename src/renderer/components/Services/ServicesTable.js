/**
 * Componente para exibir e gerenciar a tabela de Services
 */
class ServicesTable {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.tableBody = null;
        this.services = [];
        this.filteredServices = [];
        this.searchTerm = '';
        this.onViewDetails = null;
        this.onViewYAML = null;
    }

    /**
     * Inicializa a tabela
     */
    initialize() {
        if (!this.container) {
            console.error('Container da tabela de services não encontrado');
            return;
        }

        this.tableBody = this.container.querySelector('#servicesTableBody');
        if (!this.tableBody) {
            console.error('Tbody da tabela de services não encontrado');
            return;
        }

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
     * Atualiza os dados dos services
     */
    updateServices(services) {
        this.services = services || [];
        this.filteredServices = [...this.services];
        this.render();
    }

    /**
     * Aplica filtro de busca
     */
    applySearch(searchTerm) {
        this.searchTerm = searchTerm.toLowerCase();
        this.filteredServices = this.services.filter(service => {
            return service.metadata.name.toLowerCase().includes(this.searchTerm) ||
                   service.metadata.namespace.toLowerCase().includes(this.searchTerm) ||
                   service.spec.type.toLowerCase().includes(this.searchTerm) ||
                   (service.spec.clusterIP && service.spec.clusterIP.toLowerCase().includes(this.searchTerm));
        });
        this.render();
    }

    /**
     * Renderiza a tabela
     */
    render() {
        if (!this.tableBody) return;

        this.tableBody.innerHTML = '';

        if (this.filteredServices.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="6" class="empty-state">
                    ${this.searchTerm ? 'Nenhum service encontrado para a busca' : 'Nenhum service encontrado'}
                </td>
            `;
            this.tableBody.appendChild(emptyRow);
            return;
        }

        this.filteredServices.forEach(service => {
            const row = this.createServiceRow(service);
            this.tableBody.appendChild(row);
        });
    }

    /**
     * Cria uma linha da tabela para um service
     */
    createServiceRow(service) {
        const row = document.createElement('tr');
        row.className = 'service-row';
        row.dataset.serviceName = service.metadata.name;
        row.dataset.namespace = service.metadata.namespace;

        const age = this.calculateAge(service.metadata.creationTimestamp);
        const ports = this.formatPorts(service.spec.ports || []);

        row.innerHTML = `
            <td>${service.metadata.name}</td>
            <td>${service.metadata.namespace}</td>
            <td>
                <span class="type-badge type-${service.spec.type.toLowerCase()}">${service.spec.type}</span>
            </td>
            <td>${service.spec.clusterIP || '-'}</td>
            <td>${ports}</td>
            <td>${age}</td>
            <td>
                <button class="btn-icon" onclick="servicesTable.showContextMenu(event, '${service.metadata.name}', '${service.metadata.namespace}')" title="Ações">
                    <i class="bi bi-three-dots-vertical"></i>
                </button>
            </td>
        `;

        return row;
    }

    /**
     * Calcula a idade do service
     */
    calculateAge(creationTimestamp) {
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

    /**
     * Formata as portas do service
     */
    formatPorts(ports) {
        if (!ports || ports.length === 0) return '-';
        
        return ports.map(port => {
            const targetPort = port.targetPort || port.port;
            return `${port.port}:${targetPort}/${port.protocol || 'TCP'}`;
        }).join(', ');
    }

    /**
     * Formata o seletor do service
     */
    formatSelector(selector) {
        if (!selector || Object.keys(selector).length === 0) return '-';
        
        return Object.entries(selector)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ');
    }

    /**
     * Formata os endpoints do service
     */
    formatEndpoints(service) {
        // Esta informação seria obtida dos endpoints do service
        // Por simplicidade, retornamos o número de portas
        const portCount = service.spec.ports ? service.spec.ports.length : 0;
        return `${portCount} port${portCount !== 1 ? 's' : ''}`;
    }

    /**
     * Mostra o menu de contexto
     */
    showContextMenu(event, serviceName, namespace) {
        event.stopPropagation();
        
        // Remove menu anterior se existir
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.position = 'fixed';
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
        menu.style.zIndex = '1000';

        menu.innerHTML = `
            <div class="context-menu-item" onclick="servicesTable.viewDetails('${serviceName}', '${namespace}')">
                <i class="bi bi-eye"></i>
                Ver Detalhes
            </div>
            <div class="context-menu-item" onclick="servicesTable.viewYAML('${serviceName}', '${namespace}')">
                <i class="bi bi-file-code"></i>
                Ver YAML
            </div>
        `;

        document.body.appendChild(menu);

        // Remove menu ao clicar fora
        const removeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', removeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', removeMenu);
        }, 100);
    }

    /**
     * Visualiza detalhes do service
     */
    viewDetails(serviceName, namespace) {
        if (this.onViewDetails) {
            this.onViewDetails(serviceName, namespace);
        }
    }

    /**
     * Visualiza YAML do service
     */
    viewYAML(serviceName, namespace) {
        if (this.onViewYAML) {
            this.onViewYAML(serviceName, namespace);
        }
    }

    /**
     * Obtém estatísticas dos services
     */
    getStats() {
        const total = this.services.length;
        const filtered = this.filteredServices.length;
        
        const byType = this.services.reduce((acc, service) => {
            const type = service.spec.type;
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        return {
            total,
            filtered,
            byType
        };
    }
}

// Instância global
window.servicesTable = new ServicesTable('#servicesSection');
