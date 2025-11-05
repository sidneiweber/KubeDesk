interface Deployment {
    name: string;
    namespace: string;
    ready: string;
    upToDate: number;
    available: number;
    age: string;
    replicas: number;
    readyReplicas: number;
    containerImages: { name: string, image: string }[];
    strategy: string;
}

type ActionHandler = (name: string, namespace: string) => void;

class DeploymentsTable {
    private container: HTMLElement;
    private tableBody: HTMLTableSectionElement | null;
    private deployments: Deployment[] = [];
    private filteredDeployments: Deployment[] = [];
    private searchTerm = '';

    public onViewLogs: ActionHandler | null = null;
    public onViewDetails: ActionHandler | null = null;
    public onViewYAML: ActionHandler | null = null;

    constructor(containerSelector: string) {
        this.container = document.querySelector(containerSelector) as HTMLElement;
        this.tableBody = null;
    }

    public initialize(): this {
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

    public setOnViewLogs(handler: ActionHandler): this {
        this.onViewLogs = handler;
        return this;
    }

    public setOnViewDetails(handler: ActionHandler): this {
        this.onViewDetails = handler;
        return this;
    }

    public setOnViewYAML(handler: ActionHandler): this {
        this.onViewYAML = handler;
        return this;
    }

    public updateDeployments(deployments: Deployment[]): void {
        this.deployments = deployments;
        this.applyFilter();
        this.render();
    }

    public setSearchTerm(term: string): void {
        this.searchTerm = term.toLowerCase().trim();
        this.applyFilter();
        this.render();
    }

    private applyFilter(): void {
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

    private render(): void {
        if (!this.tableBody) return;

        this.tableBody.innerHTML = '';

        if (this.filteredDeployments.length === 0) {
            this.renderEmptyState();
            return;
        }

        this.filteredDeployments.forEach(deployment => {
            const row = this.createDeploymentRow(deployment);
            this.tableBody!.appendChild(row);
        });

        this.attachEventListeners();
    }

    private renderEmptyState(): void {
        const row = document.createElement('tr');
        const message = this.searchTerm
            ? 'Nenhum deployment encontrado com o termo de busca'
            : 'Nenhum deployment encontrado';

        row.innerHTML = `<td colspan="8" class="no-data"><div class="no-data-message"><span>🚀</span><p>${message}</p></div></td>`;
        this.tableBody!.appendChild(row);
    }

    private createDeploymentRow(deployment: Deployment): HTMLElement {
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

    private getStatusClass(deployment: Deployment): string {
        if (deployment.readyReplicas === deployment.replicas && deployment.replicas > 0) return 'running';
        if (deployment.readyReplicas > 0) return 'pending';
        return 'failed';
    }

    private getStatusText(deployment: Deployment): string {
        if (deployment.readyReplicas === deployment.replicas && deployment.replicas > 0) return 'Ready';
        if (deployment.readyReplicas > 0) return 'Progressing';
        return 'Unavailable';
    }

    private shouldShowNamespaceBadge(): boolean {
        const namespaceSelect = document.getElementById('namespaceSelect') as HTMLSelectElement;
        return namespaceSelect && namespaceSelect.value === 'all';
    }

    private attachEventListeners(): void {
        this.tableBody!.querySelectorAll('tr').forEach(row => {
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

    public getCount(): number {
        return this.filteredDeployments.length;
    }

    public clear(): void {
        this.deployments = [];
        this.filteredDeployments = [];
        this.render();
    }
}

export default DeploymentsTable;
