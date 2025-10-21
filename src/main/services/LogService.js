const k8s = require('@kubernetes/client-node');
const stream = require('stream');
const { parseLogs } = require('../utils/LogParser');

const activeLogStreams = new Map();

async function getPodLogs(kc, podName, namespace, containerName = null, tailLines = 100, sinceSeconds = 300) {
    try {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

        // Tentar diferentes configurações até encontrar uma que funcione
        const configs = [
            // Configuração 1: Com timestamps e sinceSeconds (prioridade alta)
            {
                name: 'com timestamps e sinceSeconds',
                params: [podName, namespace, containerName, undefined, undefined, sinceSeconds, undefined, true, tailLines]
            },
            // Configuração 2: Com timestamps apenas
            {
                name: 'com timestamps',
                params: [podName, namespace, containerName, undefined, undefined, undefined, undefined, true, tailLines]
            },
            // Configuração 3: Com tailLines
            {
                name: 'com tailLines',
                params: [podName, namespace, containerName, undefined, undefined, undefined, undefined, undefined, tailLines]
            },
            // Configuração 4: Básica - apenas parâmetros essenciais
            {
                name: 'básica',
                params: [podName, namespace, containerName]
            }
        ];

        let response = null;
        let lastError = null;

        for (const config of configs) {
            try {
                response = await k8sApi.readNamespacedPodLog(...config.params);
                break;
            } catch (error) {
                console.warn(`Falha com configuração ${config.name}: ${error.message}`);
                lastError = error;
                continue;
            }
        }

        if (!response) {
            throw lastError || new Error('Todas as configurações falharam');
        }

        return parseLogs(response.body, podName);
    } catch (error) {
        console.error('Erro detalhado ao buscar logs:', {
            podName, namespace, containerName, tailLines, sinceSeconds,
            error: error.message, status: error.status, response: error.response?.body
        });
        throw new Error(`Erro ao buscar logs do pod: ${error.message}`);
    }
}

async function streamPodLogs(kc, connectionId, podName, namespace, containerName, sinceSeconds, event) {
    if (!kc) {
        throw new Error('Conexão não encontrada');
    }

    const streamId = `${connectionId}-${namespace}-${podName}-${containerName || 'default'}`;

    // Parar stream anterior se existir
    stopLogStream(streamId);

    const log = new k8s.Log(kc);
    const logStream = new stream.PassThrough();

    logStream.on('data', (chunk) => {
        event.sender.send('log-stream-data', { streamId, podName, log: chunk.toString() });
    });
    logStream.on('error', (err) => {
        event.sender.send('log-stream-error', { streamId, message: `Erro no stream de logs: ${err.message}` });
        activeLogStreams.delete(streamId);
    });
    logStream.on('end', () => {
        event.sender.send('log-stream-end', { streamId });
        activeLogStreams.delete(streamId);
    });

    const reqPromise = log.log(namespace, podName, containerName, logStream, {
        follow: true,
        tailLines: 100,
        timestamps: true,
        sinceSeconds: sinceSeconds,
    });

    reqPromise.then((req) => {
        activeLogStreams.set(streamId, req);
    }).catch((err) => {
        event.sender.send('log-stream-error', { streamId, message: `Erro ao iniciar streaming de logs: ${err.message}` });
    });

    return { success: true, streamId: streamId, message: 'Streaming iniciado' };
}

function stopLogStream(streamId) {
    if (activeLogStreams.has(streamId)) {
        const req = activeLogStreams.get(streamId);
        if (req && typeof req.abort === 'function') {
            req.abort();
        }
        activeLogStreams.delete(streamId);
    }
}

module.exports = { getPodLogs, streamPodLogs, stopLogStream, activeLogStreams };