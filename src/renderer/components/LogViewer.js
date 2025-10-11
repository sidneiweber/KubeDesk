const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SearchAddon } = require('@xterm/addon-search');
const { WebLinksAddon } = require('@xterm/addon-web-links');

class LogViewer {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.terminal = null;
        this.fitAddon = null;
        this.searchAddon = null;
        this.webLinksAddon = null;
        
        this.options = {
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                selection: '#264f78',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#e5e5e5'
            },
            fontSize: 12,
            fontFamily: 'Consolas, "Courier New", monospace',
            cursorBlink: false,
            scrollback: 10000,
            convertEol: true,
            disableStdin: true,
            ...options
        };
        
        this.logBuffer = [];
        this.maxBufferSize = 5000;
        this.searchTerm = '';
        this.welcomeMessageShown = true;
        this.logLevels = {
            error: { color: '\x1b[31m', icon: '❌' },
            warn: { color: '\x1b[33m', icon: '⚠️' },
            warning: { color: '\x1b[33m', icon: '⚠️' },
            info: { color: '\x1b[36m', icon: 'ℹ️' },
            debug: { color: '\x1b[90m', icon: '🐛' },
            trace: { color: '\x1b[90m', icon: '🔍' }
        };
    }
    
    initialize() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container with id ${this.containerId} not found`);
        }
        
        // Limpar container
        container.innerHTML = '';
        
        // Criar terminal
        this.terminal = new Terminal(this.options);
        
        // Adicionar addons
        this.fitAddon = new FitAddon();
        this.searchAddon = new SearchAddon();
        this.webLinksAddon = new WebLinksAddon();
        
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.webLinksAddon);
        
        // Abrir terminal no container
        this.terminal.open(container);
        
        // Ativar SearchAddon
        this.searchAddon.activate(this.terminal);
        
        // Ajustar tamanho inicial
        setTimeout(() => {
            this.fitAddon.fit();
        }, 100);
        
        // Event listeners
        this.setupEventListeners();
        
        return this;
    }
    
    setupEventListeners() {
        // Redimensionar quando a janela mudar (com debounce)
        let resizeTimeout;
        const resizeHandler = () => {
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(() => {
                if (this.fitAddon && this.terminal) {
                    this.fitAddon.fit();
                }
            }, 150);
        };
        
        window.addEventListener('resize', resizeHandler);
        
        // Armazenar referência para cleanup
        this.resizeHandler = resizeHandler;
        
        // Detectar scroll manual do usuário
        this.terminal.onScroll(() => {
            if (!this.terminal) return;
            
            const buffer = this.terminal.buffer.active;
            // Considerar que está seguindo se estiver nas últimas 3 linhas
            const isNearBottom = (buffer.viewportY + buffer.rows) >= (buffer.length - 3);
            
        });
    }
    
    addLog(logEntry) {
        if (!this.terminal) return;
        
        // Remover mensagem de boas-vindas no primeiro log real
        if (this.welcomeMessageShown && this.logBuffer.length === 0) {
            this.terminal.clear();
            this.welcomeMessageShown = false;
        }
        
        // Adicionar ao buffer
        this.logBuffer.push(logEntry);
        
        // Limitar tamanho do buffer
        if (this.logBuffer.length > this.maxBufferSize) {
            this.logBuffer.shift();
        }
        
        // Formatar e escrever log
        const formattedLog = this.formatLogEntry(logEntry);
        this.terminal.write(formattedLog + '\r\n');
        
    }
    
    formatLogEntry(logEntry) {
        const timestamp = this.formatTimestamp(logEntry.timestamp);
        const level = this.detectLogLevel(logEntry.message);
        const levelInfo = this.logLevels[level] || { color: '\x1b[37m', icon: '📝' };
        
        // Colorir timestamp
        const coloredTimestamp = `\x1b[90m${timestamp}\x1b[0m`;
        
        // Adicionar identificador do pod (últimos 5 caracteres) se disponível
        let podIdentifier = '';
        if (logEntry.podName && logEntry.podName.length > 5) {
            const podSuffix = logEntry.podName.slice(-5);
            podIdentifier = ` \x1b[36m[${podSuffix}]\x1b[0m`;
        }
        
        // Colorir nível com padding fixo
        const levelText = `${levelInfo.icon} ${level.toUpperCase()}`;
        const coloredLevel = `${levelInfo.color}${levelText.padEnd(12)}\x1b[0m`;
        
        // Processar mensagem
        let coloredMessage = logEntry.message;
        
        // Destacar palavras-chave
        coloredMessage = this.highlightKeywords(coloredMessage);
        
        // Aplicar cor do nível na mensagem se for erro ou warning
        if (level === 'error' || level === 'warn' || level === 'warning') {
            coloredMessage = `${levelInfo.color}${coloredMessage}\x1b[0m`;
        }
        
        return `${coloredTimestamp}${podIdentifier} ${coloredLevel} ${coloredMessage}`;
    }
    
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('pt-BR', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });
    }
    
    detectLogLevel(message) {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('error') || lowerMessage.includes('fatal') || lowerMessage.includes('exception')) {
            return 'error';
        } else if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
            return 'warn';
        } else if (lowerMessage.includes('debug')) {
            return 'debug';
        } else if (lowerMessage.includes('trace')) {
            return 'trace';
        }
        
        return 'info';
    }
    
    highlightKeywords(message) {
        // Destacar IPs
        message = message.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '\x1b[94m$&\x1b[0m');
        
        // Destacar URLs
        message = message.replace(/https?:\/\/[^\s]+/g, '\x1b[94m\x1b[4m$&\x1b[0m');
        
        // Destacar códigos de status HTTP
        message = message.replace(/\b[1-5]\d{2}\b/g, '\x1b[93m$&\x1b[0m');
        
        // Destacar UUIDs
        message = message.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '\x1b[95m$&\x1b[0m');
        
        // Destacar números (portas, IDs, etc)
        message = message.replace(/\b\d{4,}\b/g, '\x1b[96m$&\x1b[0m');
        
        return message;
    }
    
    search(term) {
        this.searchTerm = term;
        if (this.searchAddon && term && this.terminal) {
            this.searchAddon.findNext(term);
        }
    }
    
    searchNext() {
        if (this.searchAddon && this.searchTerm && this.terminal) {
            this.searchAddon.findNext(this.searchTerm);
        }
    }
    
    searchPrevious() {
        if (this.searchAddon && this.searchTerm && this.terminal) {
            this.searchAddon.findPrevious(this.searchTerm);
        }
    }
    
    clear() {
        if (this.terminal) {
            this.terminal.clear();
            this.logBuffer = [];
        }
    }
    
    scrollToTop() {
        if (this.terminal) {
            this.terminal.scrollToTop();
        }
    }
    
    scrollToBottom() {
        if (this.terminal) {
            this._autoScrolling = true;
            this.terminal.scrollToBottom();
            setTimeout(() => {
                this._autoScrolling = false;
            }, 100);
        }
    }
    
    
    exportLogs(format = 'text') {
        if (format === 'json') {
            return JSON.stringify(this.logBuffer, null, 2);
        } else if (format === 'csv') {
            const headers = 'Timestamp,Level,Pod,Message\n';
            const rows = this.logBuffer.map(log => {
                const level = this.detectLogLevel(log.message);
                return `"${log.timestamp}","${level}","${log.podName || ''}","${log.message.replace(/"/g, '""')}"`;
            }).join('\n');
            return headers + rows;
        } else {
            // Formato texto simples
            return this.logBuffer.map(log => {
                const timestamp = this.formatTimestamp(log.timestamp);
                const level = this.detectLogLevel(log.message);
                return `${timestamp} ${level.toUpperCase().padEnd(8)} ${log.message}`;
            }).join('\n');
        }
    }
    
    setTheme(theme) {
        if (this.terminal) {
            this.terminal.options.theme = { ...this.options.theme, ...theme };
        }
    }
    
    setFontSize(size) {
        if (this.terminal) {
            this.terminal.options.fontSize = size;
            setTimeout(() => {
                this.fitAddon.fit();
            }, 100);
        }
    }
    
    resize() {
        if (this.fitAddon && this.terminal && this.terminal.element) {
            // Verificar se o terminal está visível antes de redimensionar
            const container = this.terminal.element.parentElement;
            if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
                // Evitar redimensionamentos muito frequentes
                if (this._lastResize && Date.now() - this._lastResize < 100) {
                    return;
                }
                this._lastResize = Date.now();
                
                try {
                    this.fitAddon.fit();
                } catch (error) {
                    console.warn('Erro ao redimensionar terminal:', error);
                }
            }
        }
    }
    
    destroy() {
        // Remover event listeners
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        
        // Destruir terminal
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
        }
        
        // Limpar referências
        this.fitAddon = null;
        this.searchAddon = null;
        this.webLinksAddon = null;
    }
    
    getStats() {
        const levels = {};
        this.logBuffer.forEach(log => {
            const level = this.detectLogLevel(log.message);
            levels[level] = (levels[level] || 0) + 1;
        });
        
        return {
            total: this.logBuffer.length,
            levels: levels
        };
    }
}

module.exports = LogViewer;