const k8s = require('@kubernetes/client-node');
const stream = require('stream');

const activeLogStreams = new Map();

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

module.exports = { streamPodLogs, stopLogStream, activeLogStreams };