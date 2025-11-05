import * as k8s from '@kubernetes/client-node';
import * as stream from 'stream';
import { parseLogs } from '../utils/LogParser';
import { IpcMainEvent } from 'electron';

const activeLogStreams = new Map<string, any>();

async function getPodLogs(kc: k8s.KubeConfig, podName: string, namespace: string, containerName: string | null = null, tailLines = 100, sinceSeconds = 300) {
    try {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }

        const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

        const response = await k8sApi.readNamespacedPodLog(
            podName,
            namespace,
            containerName || undefined,
            undefined, // pretty
            false, // follow
            undefined, // limitBytes
            undefined, // pretty
            false, // previous
            sinceSeconds, // sinceSeconds
            tailLines, // tailLines
            true // timestamps
        );

        return parseLogs(response.body, podName);
    } catch (error: any) {
        console.error('Erro detalhado ao buscar logs:', {
            podName, namespace, containerName, tailLines, sinceSeconds,
            error: error.message, status: error.status, response: error.response?.body
        });
        throw new Error(`Erro ao buscar logs do pod: ${error.message}`);
    }
}

async function streamPodLogs(kc: k8s.KubeConfig, connectionId: string, podName: string, namespace: string, containerName: string, sinceSeconds: number, event: IpcMainEvent) {
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
        if(req) {
            activeLogStreams.set(streamId, req);
        }
    }).catch((err) => {
        event.sender.send('log-stream-error', { streamId, message: `Erro ao iniciar streaming de logs: ${err.message}` });
    });

    return { success: true, streamId: streamId, message: 'Streaming iniciado' };
}

function stopLogStream(streamId: string) {
    if (activeLogStreams.has(streamId)) {
        const req = activeLogStreams.get(streamId);
        if (req && typeof req.abort === 'function') {
            req.abort();
        }
        activeLogStreams.delete(streamId);
    }
}

export { getPodLogs, streamPodLogs, stopLogStream, activeLogStreams };
