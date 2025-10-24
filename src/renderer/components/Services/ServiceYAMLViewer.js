/**
 * Componente para visualizar YAML de Services
 */
class ServiceYAMLViewer {
    constructor() {
        this.service = null;
        this.yamlContent = '';
    }

    /**
     * Exibe o YAML de um service
     */
    showYAML(service) {
        this.service = service;
        this.yamlContent = this.convertToYAML(service);
        this.renderYAML();
    }

    /**
     * Converte o service para YAML
     */
    convertToYAML(service) {
        const yaml = {
            apiVersion: service.apiVersion,
            kind: service.kind,
            metadata: service.metadata,
            spec: service.spec,
            status: service.status
        };

        return this.formatYAML(yaml);
    }

    /**
     * Formata o YAML com indentação
     */
    formatYAML(obj, indent = 0) {
        const spaces = '  '.repeat(indent);
        let yaml = '';

        if (Array.isArray(obj)) {
            if (obj.length === 0) {
                yaml += '[]\n';
            } else {
                yaml += '\n';
                obj.forEach(item => {
                    yaml += spaces + '- ';
                    if (typeof item === 'object' && item !== null) {
                        yaml += '\n' + this.formatYAML(item, indent + 2);
                    } else {
                        yaml += this.formatValue(item) + '\n';
                    }
                });
            }
        } else if (obj !== null && typeof obj === 'object') {
            const keys = Object.keys(obj);
            if (keys.length === 0) {
                yaml += '{}\n';
            } else {
                yaml += '\n';
                keys.forEach((key, index) => {
                    yaml += spaces + key + ': ';
                    const value = obj[key];
                    
                    if (value === null || value === undefined) {
                        yaml += 'null\n';
                    } else if (typeof value === 'object') {
                        yaml += this.formatYAML(value, indent + 1);
                    } else {
                        yaml += this.formatValue(value) + '\n';
                    }
                });
            }
        } else {
            yaml += this.formatValue(obj) + '\n';
        }

        return yaml;
    }

    /**
     * Formata valores para YAML
     */
    formatValue(value) {
        if (value === null || value === undefined) {
            return 'null';
        }
        
        if (typeof value === 'string') {
            // Escapa strings que precisam de aspas
            if (value.includes(':') || value.includes('"') || value.includes("'") || 
                value.startsWith(' ') || value.endsWith(' ') || 
                value.includes('\n') || value.includes('\t')) {
                return `"${value.replace(/"/g, '\\"')}"`;
            }
            return value;
        }
        
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value.toString();
        }
        
        return String(value);
    }

    /**
     * Renderiza o YAML na interface
     */
    renderYAML() {
        const container = document.getElementById('serviceYamlContent');
        if (!container) return;

        // Limpa o conteúdo anterior
        container.innerHTML = '';

        // Cria elemento pre com syntax highlighting básico
        const pre = document.createElement('pre');
        pre.className = 'yaml-content';
        pre.textContent = this.yamlContent;

        // Aplica syntax highlighting básico
        this.applySyntaxHighlighting(pre);

        container.appendChild(pre);
    }

    /**
     * Aplica syntax highlighting básico
     */
    applySyntaxHighlighting(element) {
        const content = element.textContent;
        const lines = content.split('\n');
        
        let highlightedHTML = '';
        
        lines.forEach(line => {
            if (line.trim() === '') {
                highlightedHTML += line + '\n';
                return;
            }

            // Destaque para chaves YAML
            if (line.match(/^\s*[a-zA-Z][a-zA-Z0-9_-]*:/)) {
                highlightedHTML += line.replace(
                    /^(\s*)([a-zA-Z][a-zA-Z0-9_-]*)(:)/,
                    '$1<span class="yaml-key">$2</span>$3'
                ) + '\n';
            }
            // Destaque para valores string
            else if (line.match(/^\s*-?\s*"[^"]*"$/)) {
                highlightedHTML += line.replace(
                    /"([^"]*)"/,
                    '"<span class="yaml-string">$1</span>"'
                ) + '\n';
            }
            // Destaque para valores numéricos
            else if (line.match(/^\s*-?\s*\d+$/)) {
                highlightedHTML += line.replace(
                    /(\d+)/,
                    '<span class="yaml-number">$1</span>'
                ) + '\n';
            }
            // Destaque para valores boolean
            else if (line.match(/^\s*-?\s*(true|false)$/)) {
                highlightedHTML += line.replace(
                    /(true|false)/,
                    '<span class="yaml-boolean">$1</span>'
                ) + '\n';
            }
            else {
                highlightedHTML += line + '\n';
            }
        });

        element.innerHTML = highlightedHTML;
    }

    /**
     * Copia o YAML para a área de transferência
     */
    copyYAML() {
        if (!this.yamlContent) return;

        navigator.clipboard.writeText(this.yamlContent).then(() => {
            // Mostra feedback visual
            const button = document.getElementById('copyServiceYamlBtn');
            if (button) {
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="bi bi-check"></i> Copiado!';
                button.classList.add('copied');
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.classList.remove('copied');
                }, 2000);
            }
        }).catch(err => {
            console.error('Erro ao copiar YAML:', err);
        });
    }

    /**
     * Baixa o YAML como arquivo
     */
    downloadYAML() {
        if (!this.yamlContent || !this.service) return;

        const filename = `${this.service.metadata.name}-service.yaml`;
        const blob = new Blob([this.yamlContent], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Instância global
window.serviceYAMLViewer = new ServiceYAMLViewer();

