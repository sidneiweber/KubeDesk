/**
 * Status de pod no mesmo formato que o kubectl mostra na coluna STATUS.
 *
 * `pod.status.phase` sozinho é enganoso: um pod em CrashLoopBackOff continua
 * na fase "Running", e um pod sendo removido também. Quem olha a lista para
 * diagnosticar um problema precisa ver o motivo, não a fase.
 *
 * A lógica segue a do printer do kubectl (printPod), na ordem: init containers
 * primeiro, depois os containers normais, e por último o desligamento.
 */

// Waiting/terminated reasons que indicam problema, para a UI pintar de erro.
const FAILURE_REASONS = new Set([
    'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'InvalidImageName',
    'CreateContainerConfigError', 'CreateContainerError', 'OOMKilled',
    'Error', 'Failed', 'Evicted', 'DeadlineExceeded', 'NodeLost'
]);

const PENDING_REASONS = new Set([
    'Pending', 'ContainerCreating', 'PodInitializing', 'Terminating', 'NotReady'
]);

// Motivo textual de um container encerrado, mesmo quando o Kubernetes não
// preenche `reason` (aí resta o sinal ou o código de saída).
function terminatedReason(terminated) {
    if (terminated.reason) return terminated.reason;
    if (terminated.signal) return `Signal:${terminated.signal}`;

    return `ExitCode:${terminated.exitCode}`;
}

// Primeiro init container que ainda não terminou com sucesso. Enquanto houver
// um, é ele que define o status ("Init:...").
function initStatus(pod) {
    const statuses = pod.status?.initContainerStatuses || [];
    const total = pod.spec?.initContainers?.length || 0;

    for (let i = 0; i < statuses.length; i++) {
        const { state = {} } = statuses[i];

        if (state.terminated && state.terminated.exitCode === 0) continue;
        if (state.terminated) return `Init:${terminatedReason(state.terminated)}`;
        if (state.waiting?.reason && state.waiting.reason !== 'PodInitializing') {
            return `Init:${state.waiting.reason}`;
        }

        return `Init:${i}/${total}`;
    }

    return null;
}

// Motivo vindo dos containers normais. O kubectl percorre de trás para frente
// e deixa o primeiro container (o de menor índice) prevalecer.
function containerStatus(pod) {
    const statuses = pod.status?.containerStatuses || [];
    let reason = null;
    let hasRunning = false;

    for (let i = statuses.length - 1; i >= 0; i--) {
        const { state = {}, ready } = statuses[i];

        if (state.waiting?.reason) {
            reason = state.waiting.reason;
        } else if (state.terminated) {
            reason = terminatedReason(state.terminated);
        } else if (ready && state.running) {
            hasRunning = true;
        }
    }

    // "Completed" com container rodando é um pod reiniciado: vale a condição
    // Ready para dizer se ele voltou de fato
    if (reason === 'Completed' && hasRunning) {
        const isReady = (pod.status?.conditions || [])
            .some(c => c.type === 'Ready' && c.status === 'True');
        reason = isReady ? 'Running' : 'NotReady';
    }

    return reason;
}

/**
 * @param {object} pod Pod como devolvido pela API do Kubernetes.
 * @returns {{status: string, ready: string, readyCount: number, totalContainers: number, restarts: number}}
 */
function computePodStatus(pod) {
    const statuses = pod.status?.containerStatuses || [];

    // O denominador é quantos containers o pod declara, não quantos já têm
    // status: um pod ainda não agendado mostra 0/1, e não 0/0
    const totalContainers = pod.spec?.containers?.length || statuses.length;
    const readyCount = statuses.filter(c => c.ready).length;

    let status = pod.status?.reason || pod.status?.phase || 'Unknown';

    const init = initStatus(pod);
    if (init) {
        status = init;
    } else {
        status = containerStatus(pod) || status;
    }

    // Desligamento vence tudo: o pod pode continuar "Running" com o
    // deletionTimestamp já preenchido
    if (pod.metadata?.deletionTimestamp) {
        status = pod.status?.reason === 'NodeLost' ? 'Unknown' : 'Terminating';
    }

    return {
        status,
        ready: `${readyCount}/${totalContainers}`,
        readyCount,
        totalContainers,
        restarts: statuses.reduce((total, c) => total + (c.restartCount || 0), 0)
    };
}

// Classe CSS para o status, usada pelas tabelas e pelos badges de detalhe.
function podStatusClass(status) {
    if (!status) return 'unknown';

    if (status === 'Running') return 'running';
    if (status === 'Succeeded' || status === 'Completed') return 'succeeded';

    // "Init:2/3" é progresso; "Init:CrashLoopBackOff" é falha. O que decide é
    // o sufixo, então classificamos por ele
    if (status.startsWith('Init:')) {
        const detail = status.slice('Init:'.length);
        return /^\d+\/\d+$/.test(detail) ? 'pending' : podStatusClass(detail);
    }

    if (PENDING_REASONS.has(status)) return 'pending';
    if (FAILURE_REASONS.has(status) || status.startsWith('ExitCode:') || status.startsWith('Signal:')) {
        return 'failed';
    }

    // Motivo desconhecido do Kubernetes: tratar como problema é mais seguro do
    // que pintar de verde algo que não sabemos ler
    return 'failed';
}

module.exports = { computePodStatus, podStatusClass };
