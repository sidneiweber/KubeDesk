/**
 * Componente para exibir detalhes de um Service
 */
class ServiceDetails {
    constructor() {
        this.service = null;
        this.endpoints = null;
    }

    /**
     * Exibe os detalhes de um service
     */
    showDetails(service, endpoints = null) {
        this.service = service;
        this.endpoints = endpoints;

        this.updateBasicInfo();
        this.updateSpec();
        this.updateStatus();
        this.updateEndpoints();
        this.updateLabels();
        this.updateAnnotations();
        this.updateSelector();
    }

    /**
     * Atualiza informações básicas
     */
    updateBasicInfo() {
        if (!this.service) return;

        const metadata = this.service.metadata;
        const age = this.calculateAge(metadata.creationTimestamp);

        document.getElementById('serviceDetailName').textContent = metadata.name;
        document.getElementById('serviceDetailNamespace').textContent = metadata.namespace;
        document.getElementById('serviceDetailAge').textContent = age;
        document.getElementById('serviceDetailUID').textContent = metadata.uid;
        document.getElementById('serviceDetailResourceVersion').textContent = metadata.resourceVersion;
    }

    /**
     * Atualiza especificação do service
     */
    updateSpec() {
        if (!this.service) return;

        const spec = this.service.spec;
        
        document.getElementById('serviceDetailType').textContent = spec.type;
        document.getElementById('serviceDetailClusterIP').textContent = spec.clusterIP || '-';
        document.getElementById('serviceDetailExternalIP').textContent = spec.externalIPs ? spec.externalIPs.join(', ') : '-';
        document.getElementById('serviceDetailSessionAffinity').textContent = spec.sessionAffinity || 'None';
        document.getElementById('serviceDetailLoadBalancerIP').textContent = spec.loadBalancerIP || '-';
    }

    /**
     * Atualiza status do service
     */
    updateStatus() {
        if (!this.service) return;

        const status = this.service.status || {};
        const loadBalancer = status.loadBalancer || {};
        
        document.getElementById('serviceDetailLoadBalancerIngress').textContent = 
            loadBalancer.ingress ? loadBalancer.ingress.map(ing => ing.ip || ing.hostname).join(', ') : '-';
    }

    /**
     * Atualiza endpoints do service
     */
    updateEndpoints() {
        const container = document.getElementById('serviceEndpointsList');
        if (!container) return;

        if (!this.endpoints || !this.endpoints.subsets) {
            container.innerHTML = '<div class="empty-state">Nenhum endpoint encontrado</div>';
            return;
        }

        const subsets = this.endpoints.subsets;
        let html = '';

        subsets.forEach((subset, index) => {
            const addresses = subset.addresses || [];
            const notReadyAddresses = subset.notReadyAddresses || [];
            const ports = subset.ports || [];

            html += `
                <div class="endpoint-subset">
                    <h5>Subset ${index + 1}</h5>
                    <div class="endpoint-addresses">
                        <h6>Endpoints Ativos (${addresses.length})</h6>
                        ${addresses.map(addr => `
                            <div class="endpoint-address">
                                <span class="ip">${addr.ip}</span>
                                ${addr.nodeName ? `<span class="node">Node: ${addr.nodeName}</span>` : ''}
                                ${addr.targetRef ? `<span class="target">Target: ${addr.targetRef.kind}/${addr.targetRef.name}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    
                    ${notReadyAddresses.length > 0 ? `
                        <div class="endpoint-addresses not-ready">
                            <h6>Endpoints Não Prontos (${notReadyAddresses.length})</h6>
                            ${notReadyAddresses.map(addr => `
                                <div class="endpoint-address">
                                    <span class="ip">${addr.ip}</span>
                                    ${addr.nodeName ? `<span class="node">Node: ${addr.nodeName}</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    <div class="endpoint-ports">
                        <h6>Portas (${ports.length})</h6>
                        ${ports.map(port => `
                            <div class="endpoint-port">
                                <span class="port-name">${port.name || '-'}</span>
                                <span class="port-number">${port.port}</span>
                                <span class="port-protocol">${port.protocol}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    /**
     * Atualiza labels
     */
    updateLabels() {
        const container = document.getElementById('serviceLabelsList');
        if (!container) return;

        const labels = this.service?.metadata?.labels || {};
        
        if (Object.keys(labels).length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhum label encontrado</div>';
            return;
        }

        container.innerHTML = Object.entries(labels)
            .map(([key, value]) => `
                <div class="label-item">
                    <span class="label-key">${key}</span>
                    <span class="label-value">${value}</span>
                </div>
            `).join('');
    }

    /**
     * Atualiza annotations
     */
    updateAnnotations() {
        const container = document.getElementById('serviceAnnotationsList');
        if (!container) return;

        const annotations = this.service?.metadata?.annotations || {};
        
        if (Object.keys(annotations).length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhuma annotation encontrada</div>';
            return;
        }

        container.innerHTML = Object.entries(annotations)
            .map(([key, value]) => `
                <div class="annotation-item">
                    <span class="annotation-key">${key}</span>
                    <span class="annotation-value">${value}</span>
                </div>
            `).join('');
    }

    /**
     * Atualiza selector
     */
    updateSelector() {
        const container = document.getElementById('serviceSelectorList');
        if (!container) return;

        const selector = this.service?.spec?.selector || {};
        
        if (Object.keys(selector).length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhum seletor encontrado</div>';
            return;
        }

        container.innerHTML = Object.entries(selector)
            .map(([key, value]) => `
                <div class="selector-item">
                    <span class="selector-key">${key}</span>
                    <span class="selector-value">${value}</span>
                </div>
            `).join('');
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
}

// Instância global
window.serviceDetails = new ServiceDetails();



