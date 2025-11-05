import * as k8s from '@kubernetes/client-node';

export interface DeploymentSummary {
    name: string;
    namespace: string;
    ready: string;
    upToDate: number;
    available: number;
    age: string;
    replicas: number;
    readyReplicas: number;
    conditions: k8s.V1DeploymentCondition[];
    strategy: string;
    selector: { [key: string]: string; };
    labels: { [key: string]: string; };
    annotations: { [key: string]: string; };
    containerImages: { name: string; image: string; }[];
    uid: string;
}

export interface PodSummary {
    name: string;
    namespace: string;
    status: string;
    ready: string;
    restarts: number;
    age: string;
    node: string;
    ip: string;
    containers: { name: string; image: string; }[];
}
