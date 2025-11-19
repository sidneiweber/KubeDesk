"use strict";
class DeploymentYAMLViewer {
    constructor(containerSelector) {
        this.yamlContent = '';
        this.deploymentName = '';
        this.deploymentNamespace = '';
        this.onBack = null;
        this.container = document.querySelector(containerSelector);
    }
    initialize() {
        if (!this.container) {
            console.error('Container do YAML viewer não encontrado');
        }
        return this;
    }
    setOnBack(handler) {
        this.onBack = handler;
        return this;
    }
    showYAML(name, namespace, yamlContent) {
        this.deploymentName = name;
        this.deploymentNamespace = namespace;
        this.yamlContent = yamlContent;
        this.render();
    }
    render() {
        if (!this.container)
            return;
        const escapedYAML = this.escapeHtml(this.yamlContent);
        this.container.innerHTML = `
            <div class="yaml-viewer-container">
                <div class="yaml-viewer-header">
                    <h3>YAML: ${this.deploymentName} (${this.deploymentNamespace})</h3>
                    <div>
                        <button id="copyYAMLBtn" class="btn-secondary">Copiar</button>
                        <button id="downloadYAMLBtn" class="btn-secondary">Baixar</button>
                    </div>
                </div>
                <pre><code class="language-yaml">${escapedYAML}</code></pre>
            </div>
        `;
        this.attachEventListeners();
        Prism.highlightAllUnder(this.container);
    }
    attachEventListeners() {
        const copyBtn = this.container.querySelector('#copyYAMLBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyToClipboard());
        }
        const downloadBtn = this.container.querySelector('#downloadYAMLBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadYAML());
        }
    }
    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.yamlContent);
            this.showToast('YAML copiado!', 'success');
        }
        catch (error) {
            this.showToast('Erro ao copiar YAML', 'error');
        }
    }
    downloadYAML() {
        try {
            const blob = new Blob([this.yamlContent], { type: 'text/yaml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.deploymentName}.yaml`;
            a.click();
            URL.revokeObjectURL(url);
        }
        catch (error) {
            this.showToast('Erro ao baixar YAML', 'error');
        }
    }
    escapeHtml(text) {
        return text.replace(/[&<>"']/g, (match) => {
            switch (match) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#039;';
                default: return match;
            }
        });
    }
    showToast(message, type = 'info') {
        if (window.showToast) {
            window.showToast(message, type);
        }
        else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.yamlContent = '';
        this.deploymentName = '';
        this.deploymentNamespace = '';
    }
}
// Tornar a classe disponível globalmente
window.DeploymentYAMLViewer = DeploymentYAMLViewer;
//# sourceMappingURL=DeploymentYAMLViewer.js.map