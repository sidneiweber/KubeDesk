"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeLogStreams = void 0;
exports.getPodLogs = getPodLogs;
exports.streamPodLogs = streamPodLogs;
exports.stopLogStream = stopLogStream;
const k8s = __importStar(require("@kubernetes/client-node"));
const stream = __importStar(require("stream"));
const LogParser_1 = require("../utils/LogParser");
const activeLogStreams = new Map();
exports.activeLogStreams = activeLogStreams;
async function getPodLogs(kc, podName, namespace, containerName = null, tailLines = 100, sinceSeconds = 300) {
    try {
        if (!kc) {
            throw new Error('Configuração Kubernetes não fornecida');
        }
        const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
        const response = await k8sApi.readNamespacedPodLog(podName, namespace, containerName || undefined, undefined, // pretty
        false, // follow
        undefined, // limitBytes
        undefined, // pretty
        false, // previous
        sinceSeconds, // sinceSeconds
        tailLines, // tailLines
        true // timestamps
        );
        return (0, LogParser_1.parseLogs)(response.body, podName);
    }
    catch (error) {
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
        if (req) {
            activeLogStreams.set(streamId, req);
        }
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
//# sourceMappingURL=LogService.js.map