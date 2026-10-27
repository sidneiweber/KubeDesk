/**
 * Tela de logs: streaming de um pod individual ou agregado dos pods de um
 * deployment.
 *
 * Concentra o que antes eram 10 variáveis soltas no topo do renderer.js
 * (logsStreaming, logsPaused, logsData, logArrivalTimestamps, logsRateInterval,
 * logsFilter, currentLogStreamId, logViewer, logsOptions) mais os dois pares
 * currentPodName/currentDeploymentName que só a tela de logs escrevia. O alvo
 * atual vive em `this.target`, então não há mais como um caminho zerar o estado
 * do outro pela metade.
 */

const LogViewer = require('../LogViewer');
const { escapeHtml, downloadBlob } = require('../../utils/dom');

const MAX_TOTAL_LOGS = 5000;   // Máximo de logs mantidos em memória
const RATE_WINDOW_MS = 5000;   // Janela usada para calcular logs/s

// Entradas sintéticas ("aguardando logs...") que somem quando o primeiro log
// real chega, para não poluírem o histórico exportado.
const PLACEHOLDER_IDS = [
    'waiting-logs',
    'waiting-deployment-logs',
    'start-deployment-logs',
    'streaming-ready'
];

const ELEMENT_IDS = [
    'podLogsTitle', 'logsContent', 'containerSelect', 'logsOptionsBtn',
    'logsOptionsMenu', 'lineWrapCheckbox', 'logColoringCheckbox',
    'horizontalScrollCheckbox', 'pauseLogsBtn', 'clearLogsBtn', 'logsCount',
    'logsRate', 'downloadCsvBtn', 'downloadTextBtn', 'copyCsvBtn',
    'copyTextBtn', 'terminalSearchInput', 'searchPrevBtn', 'searchNextBtn',
    'scrollTopBtn', 'scrollBottomBtn'
];

class LogsScreen {
    /**
     * @param {object} ctx Ligações com o renderer: IPC, navegação e feedback.
     *   Tudo o que a tela precisa do resto do app entra por aqui, para o
     *   módulo não depender de globais.
     */
    constructor({ ipcRenderer, getConnectionId, switchSection, showError, showToast, showLoading }) {
        this.ipcRenderer = ipcRenderer;
        this.getConnectionId = getConnectionId;
        this.switchSection = switchSection;
        this.showError = showError;
        this.showToast = showToast;
        this.showLoading = showLoading;

        this.el = {};

        // Alvo atual: { kind: 'pod' | 'deployment', name, namespace, pods }
        this.target = null;

        this.streaming = false;
        this.paused = false;
        this.entries = [];
        // Instantes de chegada, para calcular a taxa real na janela
        this.arrivalTimestamps = [];
        this.rateInterval = null;
        this.streamId = null;
        this.viewer = null;

        this.options = {
            lineWrap: true,
            logColoring: true,
            timestamp: 'off',
            horizontalScroll: false
        };
    }

    // Resolve os elementos e liga todos os listeners da tela. Deve ser chamado
    // uma única vez, depois do DOM pronto.
    mount() {
        for (const id of ELEMENT_IDS) {
            this.el[id] = document.getElementById(id);
        }

        this.bindControls();
        this.bindStreamEvents();
    }

    // ------------------------------------------------------------------
    // Estado consultado pelo renderer
    // ------------------------------------------------------------------

    isDeploymentMode() {
        return this.target?.kind === 'deployment';
    }

    // O terminal do xterm precisa recalcular dimensões ao ficar visível.
    resize() {
        if (this.viewer && this.viewer.terminal) this.viewer.resize();
    }

    // Descarta o terminal (usado na inicialização, para não sobrar nada de uma
    // sessão anterior).
    destroyViewer() {
        if (!this.viewer) return;

        try {
            this.viewer.destroy();
        } catch (error) {
            console.warn('Erro ao destruir LogViewer:', error);
        }
        this.viewer = null;

        if (this.el.logsContent) this.el.logsContent.innerHTML = '';
    }

    // ------------------------------------------------------------------
    // Abertura da tela
    // ------------------------------------------------------------------

    async showPod(podName, podNamespace) {
        try {
            this.stopStreaming();

            this.target = { kind: 'pod', name: podName, namespace: podNamespace };

            if (this.el.podLogsTitle) this.el.podLogsTitle.textContent = `${podName}`;

            this.clear();
            this.initializeViewer();

            if (this.getConnectionId()) {
                await this.loadPodContainers();
            }

            this.switchSection('podLogs');

            if (this.getConnectionId()) {
                this.startStreaming();
            }
        } catch (error) {
            console.error('Erro em showPod:', error);
            this.showError('Erro ao carregar logs: ' + error.message);
        }
    }

    async showDeployment(deploymentName, deploymentNamespace) {
        try {
            this.showLoading(true);
            this.stopStreaming();

            const pods = await this.ipcRenderer.invoke(
                'get-deployment-pods', this.getConnectionId(), deploymentName, deploymentNamespace);

            if (!pods || pods.length === 0) {
                this.showToast('Nenhum pod encontrado para este deployment', 'warning');
                this.showLoading(false);
                return;
            }

            this.target = {
                kind: 'deployment',
                name: deploymentName,
                namespace: deploymentNamespace,
                pods
            };

            if (this.el.podLogsTitle) {
                this.el.podLogsTitle.textContent =
                    `${deploymentName} (${pods.length} pod${pods.length !== 1 ? 's' : ''})`;
            }

            this.clear();
            this.initializeViewer();

            this.switchSection('podLogs');

            await this.loadDeploymentContainers(pods);

            if (this.getConnectionId()) {
                this.startDeploymentStreaming();
            }

            this.showLoading(false);
        } catch (error) {
            console.error('Erro ao mostrar logs do deployment:', error);
            this.showError(`Erro ao carregar logs: ${error.message}`);
            this.showLoading(false);
        }
    }

    initializeViewer() {
        try {
            if (!this.el.logsContent) {
                console.error('Elemento logsContent não encontrado!');
                return;
            }

            if (this.viewer) this.viewer.destroy();

            this.viewer = new LogViewer('logsContent', {
                theme: {
                    background: '#1e1e1e',
                    foreground: '#d4d4d4',
                    cursor: '#ffffff',
                    selection: '#264f78'
                },
                fontSize: 12,
                fontFamily: 'Consolas, "Courier New", monospace'
            });

            this.viewer.initialize();

            setTimeout(() => this.resize(), 300);
        } catch (error) {
            console.error('Erro ao inicializar LogViewer:', error);
            // Fallback: sem terminal, renderLogEntry desenha os logs em divs
            if (this.el.logsContent) {
                this.el.logsContent.innerHTML =
                    '<div style="padding: 20px; color: #f14c4c;">Erro ao inicializar terminal de logs. Usando modo de compatibilidade.</div>';
            }
        }
    }

    // ------------------------------------------------------------------
    // Seletor de containers
    // ------------------------------------------------------------------

    async loadPodContainers() {
        if (!this.el.containerSelect) {
            console.error('Elemento containerSelect não encontrado!');
            return;
        }

        try {
            const containers = await this.ipcRenderer.invoke(
                'get-pod-containers', this.getConnectionId(), this.target.name, this.target.namespace);

            this.el.containerSelect.innerHTML = '<option value="">Todos os containers</option>';

            containers.forEach(container => {
                const option = document.createElement('option');
                option.value = container.name;
                option.textContent = `${container.name}`;
                if (!container.ready) {
                    option.textContent += ' [Não pronto]';
                    option.disabled = true;
                }
                this.el.containerSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Erro ao carregar containers do pod:', error);
            this.el.containerSelect.innerHTML = '<option value="">Todos os containers</option>';
        }
    }

    async loadDeploymentContainers(pods) {
        if (!this.el.containerSelect) {
            console.error('Elemento containerSelect não encontrado!');
            return;
        }

        try {
            this.el.containerSelect.innerHTML = '<option value="">Todos os pods e containers</option>';

            // Containers únicos entre todos os pods do deployment
            const containerNames = new Set();
            for (const pod of pods) {
                try {
                    const containers = await this.ipcRenderer.invoke(
                        'get-pod-containers', this.getConnectionId(), pod.name, pod.namespace);
                    containers.forEach(container => containerNames.add(container.name));
                } catch (error) {
                    console.error(`Erro ao carregar containers do pod ${pod.name}:`, error);
                }
            }

            if (containerNames.size > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Filtrar por container (todos os pods)';

                Array.from(containerNames).sort().forEach(containerName => {
                    const option = document.createElement('option');
                    option.value = `container:${containerName}`;
                    option.textContent = `📦 ${containerName}`;
                    group.appendChild(option);
                });

                this.el.containerSelect.appendChild(group);
            }

            const podsGroup = document.createElement('optgroup');
            podsGroup.label = 'Filtrar por pod específico';

            pods.forEach(pod => {
                const option = document.createElement('option');
                option.value = `pod:${pod.name}`;
                option.textContent = `🔷 ${pod.name.length > 30 ? pod.name.substring(0, 27) + '...' : pod.name}`;
                option.title = pod.name;
                podsGroup.appendChild(option);
            });

            this.el.containerSelect.appendChild(podsGroup);
        } catch (error) {
            console.error('Erro ao carregar pods e containers do deployment:', error);
            this.el.containerSelect.innerHTML = '<option value="">Todos os pods e containers</option>';
        }
    }

    // ------------------------------------------------------------------
    // Streaming
    // ------------------------------------------------------------------

    async startStreaming() {
        if (!this.getConnectionId() || this.target?.kind !== 'pod') return;

        try {
            this.streaming = true;
            this.paused = false;

            // Sem isto a taxa congelaria no último valor quando os logs parassem
            if (this.rateInterval) clearInterval(this.rateInterval);
            this.rateInterval = setInterval(() => this.updateStats(), 1000);

            this.el.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';

            this.addEntry({
                id: 'waiting-logs',
                timestamp: new Date().toISOString(),
                podName: this.target.name,
                level: 'info',
                message: `Aguardando logs do pod ${this.target.name}...`,
                raw: `Aguardando logs do pod ${this.target.name}`
            });

            await this.openPodStream();
        } catch (error) {
            console.error('Erro ao iniciar streaming de logs:', error);
            this.showError('Erro ao carregar logs: ' + error.message);
        }
    }

    async openPodStream() {
        if (!this.streaming || this.streamId) return; // Já há um stream aberto

        try {
            const result = await this.ipcRenderer.invoke(
                'stream-pod-logs',
                this.getConnectionId(),
                this.target.name,
                this.target.namespace,
                this.el.containerSelect.value || null,
                30 // sinceSeconds: começa com os últimos 30s
            );

            if (result && result.success) {
                this.streamId = result.streamId;
            } else {
                throw new Error(result?.message || 'Falha ao iniciar o streaming de logs.');
            }
        } catch (error) {
            console.error('Erro ao iniciar o streaming de logs:', error);
            this.addEntry({
                id: 'stream-setup-error',
                timestamp: new Date().toISOString(),
                podName: this.target.name,
                level: 'error',
                message: `Erro ao configurar streaming: ${error.message}`,
                raw: `Erro: ${error.message}`
            });
            this.streaming = false;
        }
    }

    async startDeploymentStreaming() {
        if (this.target?.kind !== 'deployment') return;

        if (this.streaming) this.stopStreaming();

        const { name, pods } = this.target;

        try {
            this.streaming = true;
            this.paused = false;

            if (this.el.pauseLogsBtn) {
                this.el.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';
            }

            this.clear();

            // O filtro decide quais pods entram no agregado e qual container
            // de cada um é lido
            const selectedFilter = this.el.containerSelect ? this.el.containerSelect.value : '';
            let podsToStream = pods;
            let containerFilter = '';
            let filterMessage = '';

            if (selectedFilter.startsWith('pod:')) {
                const podName = selectedFilter.substring(4);
                podsToStream = pods.filter(p => p.name === podName);
                filterMessage = ` (pod: ${podName})`;
            } else if (selectedFilter.startsWith('container:')) {
                containerFilter = selectedFilter.substring(10);
                filterMessage = ` (container: ${containerFilter})`;
            }

            this.addEntry({
                id: 'start-deployment-logs',
                timestamp: new Date().toISOString(),
                podName: name,
                level: 'info',
                message: `📊 Iniciando streaming de logs do deployment ${name}${filterMessage} (${podsToStream.length} pod${podsToStream.length !== 1 ? 's' : ''})...`,
                raw: `Iniciando streaming de logs do deployment ${name}`
            });

            for (const pod of podsToStream) {
                try {
                    const result = await this.ipcRenderer.invoke(
                        'stream-pod-logs',
                        this.getConnectionId(),
                        pod.name,
                        pod.namespace,
                        containerFilter || null,
                        30
                    );

                    if (!result || !result.success) {
                        throw new Error(result?.message || 'Falha ao iniciar streaming');
                    }
                } catch (error) {
                    console.error(`Erro ao iniciar streaming de logs do pod ${pod.name}:`, error);
                    this.addEntry({
                        id: `error-${pod.name}-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        podName: pod.name,
                        level: 'error',
                        message: `❌ Erro ao carregar logs do pod ${pod.name}: ${error.message}`,
                        raw: `Erro ao carregar logs do pod ${pod.name}`
                    });
                }
            }
        } catch (error) {
            console.error('Erro ao iniciar streaming de logs do deployment:', error);
            this.showError('Erro ao carregar logs: ' + error.message);
        }
    }

    pause() {
        this.paused = true;
        this.el.pauseLogsBtn.innerHTML = '<i class="bi bi-play"></i> Retomar';
    }

    resume() {
        this.paused = false;
        this.el.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';
    }

    stopStreaming() {
        if (this.streamId) {
            this.ipcRenderer.send('stop-stream-pod-logs', this.streamId);
            this.streamId = null;
        }

        if (this.rateInterval) {
            clearInterval(this.rateInterval);
            this.rateInterval = null;
        }
        this.arrivalTimestamps = [];

        this.streaming = false;
        this.paused = false;
        this.updateStats();

        if (this.el.pauseLogsBtn) {
            this.el.pauseLogsBtn.innerHTML = '<i class="bi bi-pause"></i> Pausar';
        }

        document.getElementById('logsModeIndicator')?.remove();
    }

    // Encerra a tela: para o stream e esquece o alvo.
    close() {
        this.stopStreaming();
        this.target = null;
    }

    // Reabre o stream com o filtro de container que acabou de ser escolhido.
    // O filtro só é lido na abertura, então trocar exige derrubar o atual.
    async reopenWithCurrentFilter() {
        // Vale mesmo com o stream já encerrado: trocar de container é o gesto
        // de pedir os logs daquele container
        if (!this.target) return;

        if (this.target.kind === 'deployment') {
            await this.startDeploymentStreaming();
        } else {
            this.stopStreaming();
            this.clear();
            await this.startStreaming();
        }
    }

    // ------------------------------------------------------------------
    // Entradas de log
    // ------------------------------------------------------------------

    addEntry(log) {
        this.entries.push(log);
        this.arrivalTimestamps.push(Date.now());

        if (this.entries.length > MAX_TOTAL_LOGS) {
            this.entries.splice(0, this.entries.length - MAX_TOTAL_LOGS);
        }

        if (this.viewer) {
            this.viewer.addLog(log);
            return;
        }

        // Fallback sem terminal: desenhar a linha e acompanhar o fim da lista
        this.renderEntry(log);

        const content = this.el.logsContent;
        const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 10;
        if (isAtBottom) content.scrollTop = content.scrollHeight;
    }

    renderEntry(log) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${this.options.logColoring ? log.level : ''}`;
        entry.dataset.logId = log.id;

        entry.style.display = 'flex';
        entry.style.flexWrap = 'wrap';
        entry.style.gap = '8px';
        entry.style.alignItems = 'flex-start';

        let content = '';

        if (this.options.timestamp !== 'off') {
            const date = new Date(log.timestamp);
            const timestamp = this.options.timestamp === 'utc'
                ? date.toISOString()
                : date.toLocaleString();

            // Timestamp aproximado é o que não veio do Kubernetes
            const cssClass = log.isApproximateTimestamp ? 'log-timestamp approximate' : 'log-timestamp';
            const prefix = log.isApproximateTimestamp ? '~' : '';
            content += `<span class="${cssClass}">[${prefix}${timestamp}]</span>`;
        }

        if (log.podName) content += `<span class="log-pod-id">${escapeHtml(log.podName)}</span>`;
        if (log.ip) content += `<span class="log-ip">${escapeHtml(log.ip)}</span>`;

        content += `<span class="log-message">${escapeHtml(log.message || log.raw || '')}</span>`;

        entry.innerHTML = content;

        if (this.options.horizontalScroll) {
            entry.style.whiteSpace = 'nowrap';
            entry.style.overflow = 'visible';
            entry.style.textOverflow = 'unset';
        } else if (this.options.lineWrap) {
            entry.style.whiteSpace = 'pre-wrap';
            entry.style.overflow = 'visible';
            entry.style.textOverflow = 'unset';
        } else {
            entry.style.whiteSpace = 'nowrap';
            entry.style.overflow = 'hidden';
            entry.style.textOverflow = 'ellipsis';
        }

        this.el.logsContent.appendChild(entry);
    }

    clear() {
        this.entries = [];
        this.arrivalTimestamps = [];

        if (this.viewer) {
            this.viewer.clear();
        } else if (this.el.logsContent) {
            this.el.logsContent.innerHTML = '';
        }

        this.updateStats();
    }

    // Remove as entradas sintéticas assim que chega o primeiro log real.
    dropPlaceholders() {
        if (!this.entries.some(log => PLACEHOLDER_IDS.includes(log.id))) return;

        this.entries = this.entries.filter(log => !PLACEHOLDER_IDS.includes(log.id));

        if (this.viewer) {
            this.viewer.clear();
            this.entries.forEach(log => this.viewer.addLog(log));
        }
    }

    updateStats() {
        const total = this.viewer ? this.viewer.getStats().total : this.entries.length;

        if (this.el.logsCount) this.el.logsCount.textContent = `${total} logs`;
        if (this.el.logsRate) this.el.logsRate.textContent = `${this.currentRate()}/s`;
    }

    // Taxa real: quantos logs chegaram na janela, normalizado por segundo.
    currentRate() {
        const cutoff = Date.now() - RATE_WINDOW_MS;
        // Timestamps são monotônicos, então basta descartar o prefixo expirado
        const firstValid = this.arrivalTimestamps.findIndex(ts => ts >= cutoff);
        this.arrivalTimestamps = firstValid === -1 ? [] : this.arrivalTimestamps.slice(firstValid);

        const rate = this.arrivalTimestamps.length / (RATE_WINDOW_MS / 1000);
        return rate < 1 && rate > 0 ? rate.toFixed(1) : Math.round(rate);
    }

    // Reaplica as opções de exibição. Com o terminal ativo os logs já estão
    // lá; só recarregamos se ele tiver ficado vazio.
    refreshDisplay() {
        if (!this.viewer || this.entries.length === 0) return;

        if (this.viewer.getStats().total === 0) {
            this.entries.forEach(log => this.viewer.addLog(log));
        }
    }

    // ------------------------------------------------------------------
    // Exportação
    // ------------------------------------------------------------------

    // Serializa o buffer local em CSV ou texto.
    serialize(format) {
        if (format !== 'csv') {
            return this.entries.map(log => {
                const timestamp = log.isApproximateTimestamp ? `~${log.timestamp}` : log.timestamp;
                return `[${timestamp}] ${log.podName || ''} ${log.ip || ''} ${log.message || log.raw || ''}`;
            }).join('\n') + (this.entries.length ? '\n' : '');
        }

        const rows = this.entries.map(log => {
            const message = (log.message || '').replace(/"/g, '""');
            const raw = (log.raw || '').replace(/"/g, '""');
            const timestamp = log.isApproximateTimestamp ? `~${log.timestamp}` : log.timestamp;
            return `"${timestamp}","${log.podName || ''}","${log.ip || ''}","${message}","${log.level}","${raw}"`;
        });

        return 'Timestamp,Pod Name,IP,Message,Level,Raw\n' + rows.join('\n') + (rows.length ? '\n' : '');
    }

    download(format) {
        // O terminal tem o buffer completo; o array local é o fallback
        const content = this.viewer ? this.viewer.exportLogs(format) : this.serialize(format);

        if (!content) {
            this.showError('Nenhum log para exportar');
            return;
        }

        const name = this.target ? this.target.name : 'logs';
        downloadBlob(content, `pod-${name}-logs.${format}`,
            format === 'csv' ? 'text/csv' : 'text/plain');
    }

    async copy(format) {
        if (this.entries.length === 0) {
            this.showError('Nenhum log para copiar');
            return;
        }

        try {
            await navigator.clipboard.writeText(this.serialize(format));
            this.showToast('Logs copiados para a área de transferência!', 'success');
        } catch (error) {
            this.showError('Erro ao copiar logs: ' + error.message);
        }
    }

    // ------------------------------------------------------------------
    // Listeners
    // ------------------------------------------------------------------

    bindControls() {
        const el = this.el;

        el.logsOptionsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = el.logsOptionsMenu;
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!el.logsOptionsBtn || !el.logsOptionsMenu) return;
            if (!el.logsOptionsBtn.contains(e.target) && !el.logsOptionsMenu.contains(e.target)) {
                el.logsOptionsMenu.style.display = 'none';
            }
        });

        el.pauseLogsBtn?.addEventListener('click', () => {
            if (this.paused) this.resume();
            else this.pause();
        });

        el.clearLogsBtn?.addEventListener('click', () => this.clear());

        el.lineWrapCheckbox?.addEventListener('change', (e) => {
            this.options.lineWrap = e.target.checked;
            if (e.target.checked) {
                // Quebra de linha e scroll horizontal são mutuamente exclusivos
                el.horizontalScrollCheckbox.checked = false;
                this.options.horizontalScroll = false;
            }
            this.refreshDisplay();
        });

        el.horizontalScrollCheckbox?.addEventListener('change', (e) => {
            this.options.horizontalScroll = e.target.checked;
            if (e.target.checked) {
                el.lineWrapCheckbox.checked = false;
                this.options.lineWrap = false;
            }
            this.refreshDisplay();
        });

        el.logColoringCheckbox?.addEventListener('change', (e) => {
            this.options.logColoring = e.target.checked;
            this.refreshDisplay();
        });

        document.querySelectorAll('input[name="timestamp"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.options.timestamp = e.target.value;
                this.refreshDisplay();
            });
        });

        el.downloadCsvBtn?.addEventListener('click', () => this.download('csv'));
        el.downloadTextBtn?.addEventListener('click', () => this.download('text'));
        el.copyCsvBtn?.addEventListener('click', () => this.copy('csv'));
        el.copyTextBtn?.addEventListener('click', () => this.copy('text'));

        // Um único listener: antes havia dois no mesmo select, e para um pod
        // ambos disparavam, abrindo dois streams e duplicando cada linha
        el.containerSelect?.addEventListener('change', () => this.reopenWithCurrentFilter());

        el.terminalSearchInput?.addEventListener('input', (e) => this.viewer?.search(e.target.value));

        el.terminalSearchInput?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (e.shiftKey) this.viewer?.searchPrevious();
            else this.viewer?.searchNext();
        });

        el.searchPrevBtn?.addEventListener('click', () => this.viewer?.searchPrevious());
        el.searchNextBtn?.addEventListener('click', () => this.viewer?.searchNext());
        el.scrollTopBtn?.addEventListener('click', () => this.viewer?.scrollToTop());
        el.scrollBottomBtn?.addEventListener('click', () => this.viewer?.scrollToBottom());
    }

    // Um chunk do backend pode trazer várias linhas; cada uma vira uma entrada.
    bindStreamEvents() {
        this.ipcRenderer.on('log-stream-data', (event, { streamId, podName, log }) => {
            if (!this.streaming || this.paused) return;
            if (!this.acceptsStream(streamId)) return;

            this.dropPlaceholders();

            log.split('\n')
                .filter(line => line.trim() !== '')
                .forEach(line => this.addEntry(this.parseLine(line, podName)));

            this.updateStats();
        });

        this.ipcRenderer.on('log-stream-error', (event, { streamId, message }) => {
            if (!this.acceptsStream(streamId)) return;

            console.error(`Log stream error for ${streamId}:`, message);
            this.addEntry({
                id: 'stream-error',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: `STREAM ERROR: ${message}`,
                raw: `STREAM ERROR: ${message}`
            });
            this.stopStreaming();
        });

        this.ipcRenderer.on('log-stream-end', (event, { streamId }) => {
            if (!this.acceptsStream(streamId)) return;

            this.addEntry({
                id: 'stream-end',
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'Log stream finished.',
                raw: 'Log stream finished.'
            });

            this.streamId = null;
            this.streaming = false;
        });
    }

    // Em modo deployment há um stream por pod, então qualquer id serve; para um
    // pod só interessa o stream que abrimos.
    acceptsStream(streamId) {
        return this.isDeploymentMode() || streamId === this.streamId;
    }

    // O kubectl prefixa cada linha com o timestamp em RFC3339 quando pedido;
    // sem ele marcamos a hora de chegada como aproximada.
    parseLine(line, podName) {
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s/);
        const timestamp = match ? match[1] : new Date().toISOString();
        const message = match ? line.substring(match[0].length) : line;

        return {
            id: `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp,
            hasRealTimestamp: Boolean(match),
            isApproximateTimestamp: !match,
            level: detectLevel(message),
            message,
            raw: line,
            podName: podName || this.target?.name
        };
    }
}

// Nível inferido do texto da linha — o Kubernetes não entrega isso estruturado.
function detectLevel(message) {
    const lower = message.toLowerCase();

    if (lower.includes('error') || lower.includes('fatal')) return 'error';
    if (lower.includes('warn') || lower.includes('warning')) return 'warning';
    if (lower.includes('debug')) return 'debug';
    return 'info';
}

module.exports = LogsScreen;
