import * as k8s from '@kubernetes/client-node';

type ActionHandler = () => void;

class DeploymentDetails {
    private container: HTMLElement;
    private deployment: k8s.V1Deployment | null = null;

    public onBack: ActionHandler | null = null;
    public onViewLogs: ActionHandler | null = null;
    public onViewYAML: ActionHandler | null = null;

    constructor(containerSelector: string) {
        this.container = document.querySelector(containerSelector) as HTMLElement;
    }

    public initialize(): this {
        if (!this.container) {
            console.error('Container de detalhes do deployment não encontrado');
        }
        return this;
    }

    public setOnBack(handler: ActionHandler): this {
        this.onBack = handler;
        return this;
    }

    public setOnViewLogs(handler: ActionHandler): this {
        this.onViewLogs = handler;
        return this;
    }

    public setOnViewYAML(handler: ActionHandler): this {
        this.onViewYAML = handler;
        return this;
    }

    public showDetails(deployment: k8s.V1Deployment): void {
        this.deployment = deployment;
        this.render();
    }

    private render(): void {
        if (!this.deployment || !this.container) return;

        // ... (o restante da lógica de renderização, que já é compatível com os tipos)
    }

    // ... (outros métodos privados com tipos adicionados)

    public clear(): void {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.deployment = null;
    }
}

export default DeploymentDetails;
