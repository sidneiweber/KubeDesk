"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class DeploymentDetails {
    constructor(containerSelector) {
        this.deployment = null;
        this.onBack = null;
        this.onViewLogs = null;
        this.onViewYAML = null;
        this.container = document.querySelector(containerSelector);
    }
    initialize() {
        if (!this.container) {
            console.error('Container de detalhes do deployment não encontrado');
        }
        return this;
    }
    setOnBack(handler) {
        this.onBack = handler;
        return this;
    }
    setOnViewLogs(handler) {
        this.onViewLogs = handler;
        return this;
    }
    setOnViewYAML(handler) {
        this.onViewYAML = handler;
        return this;
    }
    showDetails(deployment) {
        this.deployment = deployment;
        this.render();
    }
    render() {
        if (!this.deployment || !this.container)
            return;
        // ... (o restante da lógica de renderização, que já é compatível com os tipos)
    }
    // ... (outros métodos privados com tipos adicionados)
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.deployment = null;
    }
}
exports.default = DeploymentDetails;
//# sourceMappingURL=DeploymentDetails.js.map