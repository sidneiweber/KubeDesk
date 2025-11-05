declare const Prism: any;

declare global {
    interface Window {
        showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    }
}

type ActionHandler = () => void;

class DeploymentYAMLViewer {
    private container: HTMLElement;
    private yamlContent = '';
    private deploymentName = '';
    private deploymentNamespace = '';

    public onBack: ActionHandler | null = null;

    constructor(containerSelector: string) {
        this.container = document.querySelector(containerSelector) as HTMLElement;
    }

    public initialize(): this {
        if (!this.container) {
            console.error('Container do YAML viewer não encontrado');
        }
        return this;
    }

    public setOnBack(handler: ActionHandler): this {
        this.onBack = handler;
        return this;
    }

    public showYAML(name: string, namespace: string, yamlContent: string): void {
        this.deploymentName = name;
        this.deploymentNamespace = namespace;
        this.yamlContent = yamlContent;
        this.render();
    }

    private render(): void {
        if (!this.container) return;

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

    private attachEventListeners(): void {
        const copyBtn = this.container.querySelector('#copyYAMLBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyToClipboard());
        }

        const downloadBtn = this.container.querySelector('#downloadYAMLBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadYAML());
        }
    }

    private async copyToClipboard(): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.yamlContent);
            this.showToast('YAML copiado!', 'success');
        } catch (error) {
            this.showToast('Erro ao copiar YAML', 'error');
        }
    }

    private downloadYAML(): void {
        try {
            const blob = new Blob([this.yamlContent], { type: 'text/yaml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.deploymentName}.yaml`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            this.showToast('Erro ao baixar YAML', 'error');
        }
    }

    private escapeHtml(text: string): string {
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

    private showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    public clear(): void {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.yamlContent = '';
        this.deploymentName = '';
        this.deploymentNamespace = '';
    }
}

export default DeploymentYAMLViewer;
