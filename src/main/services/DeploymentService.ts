import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import { DeploymentSummary, PodSummary } from './types';

/**
 * Serviço para gerenciar operações com Deployments no Kubernetes
 */
class DeploymentService {
    /**
     * Lista deployments de um namespace ou todos os namespaces
     * @param {k8s.KubeConfig} kc - Configuração do Kubernetes
     * @param {string} namespace - Nome do namespace ou 'all' para todos
     * @returns {Promise<Array>} Lista de deployments
     */
    static async listDeployments(kc: k8s.KubeConfig, namespace = 'default'): Promise<DeploymentSummary[]> {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
        let response: k8s.HttpError | { response: any; body: k8s.V1DeploymentList; };

        try {
            if (namespace === 'all') {
                response = await k8sApi.listDeploymentForAllNamespaces();
            } else {
                response = await k8sApi.listNamespacedDeployment(namespace);
            }

            const deployments = response.body.items.map((deployment: k8s.V1Deployment) => ({
                name: deployment.metadata!.name!,
                namespace: deployment.metadata!.namespace!,
                ready: `${deployment.status!.readyReplicas || 0}/${deployment.spec!.replicas || 0}`,
                upToDate: deployment.status!.updatedReplicas || 0,
                available: deployment.status!.availableReplicas || 0,
                age: this.calculateAge(deployment.metadata!.creationTimestamp!),
                replicas: deployment.spec!.replicas || 0,
                readyReplicas: deployment.status!.readyReplicas || 0,
                conditions: deployment.status!.conditions || [],
                strategy: deployment.spec!.strategy?.type || 'RollingUpdate',
                selector: deployment.spec!.selector?.matchLabels || {},
                labels: deployment.metadata!.labels || {},
                annotations: deployment.metadata!.annotations || {},
                containerImages: deployment.spec!.template.spec!.containers.map(c => ({
                    name: c.name,
                    image: c.image!
                })),
                uid: deployment.metadata!.uid!
            }));

            return deployments;
        } catch (error: any) {
            console.error('Erro ao listar deployments:', error);
            throw new Error(`Erro ao buscar deployments: ${error.message}`);
        }
    }

    /**
     * Obtém detalhes completos de um deployment específico
     * @param {k8s.KubeConfig} kc - Configuração do Kubernetes
     * @param {string} name - Nome do deployment
     * @param {string} namespace - Namespace do deployment
     * @returns {Promise<Object>} Detalhes do deployment
     */
    static async getDeploymentDetails(kc: k8s.KubeConfig, name: string, namespace: string): Promise<k8s.V1Deployment> {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

        try {
            const response = await k8sApi.readNamespacedDeployment(name, namespace);
            return response.body;
        } catch (error: any) {
            console.error('Erro ao obter detalhes do deployment:', error);
            throw new Error(`Erro ao buscar detalhes do deployment: ${error.message}`);
        }
    }

    /**
     * Obtém o YAML completo de um deployment
     * @param {k8s.KubeConfig} kc - Configuração do Kubernetes
     * @param {string} name - Nome do deployment
     * @param {string} namespace - Namespace do deployment
     * @returns {Promise<string>} YAML do deployment
     */
    static async getDeploymentYAML(kc: k8s.KubeConfig, name: string, namespace: string): Promise<string> {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

        try {
            const response = await k8sApi.readNamespacedDeployment(name, namespace);

            const deploymentData = JSON.parse(JSON.stringify(response.body));
            if (deploymentData.metadata && deploymentData.metadata.managedFields) {
                delete deploymentData.metadata.managedFields;
            }

            return yaml.dump(deploymentData, {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
                sortKeys: false
            });
        } catch (error: any) {
            console.error('Erro ao obter YAML do deployment:', error);
            throw new Error(`Erro ao buscar YAML do deployment: ${error.message}`);
        }
    }

    /**
     * Lista todos os pods de um deployment
     * @param {k8s.KubeConfig} kc - Configuração do Kubernetes
     * @param {string} deploymentName - Nome do deployment
     * @param {string} namespace - Namespace do deployment
     * @returns {Promise<Array>} Lista de pods do deployment
     */
    static async getDeploymentPods(kc: k8s.KubeConfig, deploymentName: string, namespace: string): Promise<PodSummary[]> {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
        const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

        try {
            const deploymentResponse = await k8sAppsApi.readNamespacedDeployment(deploymentName, namespace);
            const deployment = deploymentResponse.body;
            const matchLabels = deployment.spec!.selector?.matchLabels || {};

            const labelSelector = Object.entries(matchLabels)
                .map(([key, value]) => `${key}=${value}`)
                .join(',');

            const podsResponse = await k8sCoreApi.listNamespacedPod(
                namespace,
                undefined,
                undefined,
                undefined,
                undefined,
                labelSelector
            );

            const pods = podsResponse.body.items.map((pod: k8s.V1Pod) => ({
                name: pod.metadata!.name!,
                namespace: pod.metadata!.namespace!,
                status: pod.status!.phase!,
                ready: `${pod.status!.containerStatuses?.filter(c => c.ready).length || 0}/${pod.status!.containerStatuses?.length || 0}`,
                restarts: pod.status!.containerStatuses?.reduce((total, c) => total + (c.restartCount || 0), 0) || 0,
                age: this.calculateAge(pod.metadata!.creationTimestamp!),
                node: pod.spec!.nodeName!,
                ip: pod.status!.podIP!,
                containers: pod.spec!.containers.map(container => ({
                    name: container.name,
                    image: container.image!
                }))
            }));

            return pods;
        } catch (error: any) {
            console.error('Erro ao listar pods do deployment:', error);
            throw new Error(`Erro ao buscar pods do deployment: ${error.message}`);
        }
    }

    /**
     * Escala um deployment
     * @param {k8s.KubeConfig} kc - Configuração do Kubernetes
     * @param {string} name - Nome do deployment
     * @param {string} namespace - Namespace do deployment
     * @param {number} replicas - Número de réplicas desejado
     * @returns {Promise<Object>} Resultado da operação
     */
    static async scaleDeployment(kc: k8s.KubeConfig, name: string, namespace: string, replicas: number): Promise<{ success: boolean, message: string }> {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

        try {
            const patch = {
                spec: {
                    replicas: replicas
                }
            };

            const options = { headers: { 'Content-Type': 'application/merge-patch+json' } };
            await k8sApi.patchNamespacedDeployment(
                name,
                namespace,
                patch,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                options
            );

            return {
                success: true,
                message: `Deployment ${name} escalado para ${replicas} réplicas`
            };
        } catch (error: any) {
            console.error('Erro ao escalar deployment:', error);
            throw new Error(`Erro ao escalar deployment: ${error.message}`);
        }
    }

    /**
     * Reinicia um deployment (força um rollout)
     * @param {k8s.KubeConfig} kc - Configuração do Kubernetes
     * @param {string} name - Nome do deployment
     * @param {string} namespace - Namespace do deployment
     * @returns {Promise<Object>} Resultado da operação
     */
    static async restartDeployment(kc: k8s.KubeConfig, name: string, namespace: string): Promise<{ success: boolean, message: string }> {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

        try {
            const patch = {
                spec: {
                    template: {
                        metadata: {
                            annotations: {
                                'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
                            }
                        }
                    }
                }
            };

            const options = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };
            await k8sApi.patchNamespacedDeployment(
                name,
                namespace,
                patch,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                options
            );

            return {
                success: true,
                message: `Deployment ${name} reiniciado com sucesso`
            };
        } catch (error: any) {
            console.error('Erro ao reiniciar deployment:', error);
            throw new Error(`Erro ao reiniciar deployment: ${error.message}`);
        }
    }

    /**
     * Calcula a idade de um recurso
     * @param {string} timestamp - Timestamp de criação
     * @returns {string} Idade formatada
     */
    static calculateAge(timestamp: Date): string {
        const now = new Date();
        const created = new Date(timestamp);
        const diff = now.getTime() - created.getTime();

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d`;
        if (hours > 0) return `${hours}h`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    }
}

export default DeploymentService;
