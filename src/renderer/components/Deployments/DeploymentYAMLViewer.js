/**
 * Componente para visualizar YAML de Deployments
 */
class DeploymentYAMLViewer {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.yamlContent = '';
        this.deploymentName = '';
        this.deploymentNamespace = '';
        this.onBack = null;
    }

    /**
     * Inicializa o componente
     */
    initialize() {
        if (!this.container) {
            console.error('Container do YAML viewer não encontrado');
            return;
        }
        return this;
    }

    /**
     * Define o handler para voltar
     */
    setOnBack(handler) {
        this.onBack = handler;
        return this;
    }

    /**
     * Exibe o YAML de um deployment
     * @param {string} name - Nome do deployment
     * @param {string} namespace - Namespace do deployment
     * @param {string} yamlContent - Conteúdo YAML
     */
    showYAML(name, namespace, yamlContent) {
        this.deploymentName = name;
        this.deploymentNamespace = namespace;
        this.yamlContent = yamlContent;
        this.render();
    }

    /**
     * Renderiza o viewer
     */
    render() {
        if (!this.container) return;

        // Escapar HTML para evitar XSS
        const escapedYAML = this.escapeHtml(this.yamlContent);

        this.container.innerHTML = `
            <div class="yaml-viewer-container">
                <div class="yaml-viewer-header">
                    <div class="yaml-header-left">
                        <h3>YAML: ${this.deploymentName}</h3>
                        <span class="yaml-namespace">Namespace: ${this.deploymentNamespace}</span>
                    </div>
                    <div class="yaml-header-right">
                        <button id="copyYAMLBtn" class="btn-secondary" title="Copiar YAML">
                            <i class="bi bi-clipboard"></i>
                            Copiar
                        </button>
                        <button id="downloadYAMLBtn" class="btn-secondary" title="Baixar YAML">
                            <i class="bi bi-download"></i>
                            Baixar
                        </button>
                    </div>
                </div>
                <div class="yaml-viewer-content">
                    <pre><code class="yaml-code">${escapedYAML}</code></pre>
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    /**
     * Anexa event listeners
     */
    attachEventListeners() {
        // Botão copiar
        const copyBtn = this.container.querySelector('#copyYAMLBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyToClipboard());
        }

        // Botão download
        const downloadBtn = this.container.querySelector('#downloadYAMLBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadYAML());
        }
    }

    /**
     * Copia o YAML para o clipboard
     */
    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.yamlContent);
            this.showToast('YAML copiado para a área de transferência!', 'success');
        } catch (error) {
            console.error('Erro ao copiar YAML:', error);
            this.showToast('Erro ao copiar YAML', 'error');
        }
    }

    /**
     * Faz download do YAML
     */
    downloadYAML() {
        try {
            const blob = new Blob([this.yamlContent], { type: 'text/yaml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.deploymentName}-${this.deploymentNamespace}.yaml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast('YAML baixado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao baixar YAML:', error);
            this.showToast('Erro ao baixar YAML', 'error');
        }
    }

    /**
     * Escapa HTML para prevenir XSS
     */
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Exibe uma notificação toast
     */
    showToast(message, type = 'info') {
        // Verificar se existe uma função global de toast
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            // Fallback simples
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Limpa o viewer
     */
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.yamlContent = '';
        this.deploymentName = '';
        this.deploymentNamespace = '';
    }
}

// Exportar para uso no renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeploymentYAMLViewer;
}


