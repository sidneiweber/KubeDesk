import { Terminal, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface LogEntry {
    id: string;
    timestamp: string;
    podName?: string;
    level: 'info' | 'error' | 'warning' | 'debug' | 'trace';
    message: string;
    raw: string;
}

class LogViewer {
    private containerId: string;
    private options: ITerminalOptions;
    private terminal: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private searchAddon: SearchAddon | null = null;
    private webLinksAddon: WebLinksAddon | null = null;
    private logBuffer: LogEntry[] = [];
    private maxBufferSize = 5000;
    private searchTerm = '';
    private welcomeMessageShown = true;
    private resizeHandler: (() => void) | null = null;
    private _autoScrolling = false;
    private _lastResize = 0;

    constructor(containerId: string, options: ITerminalOptions = {}) {
        this.containerId = containerId;
        this.options = {
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
            },
            fontSize: 12,
            fontFamily: 'Consolas, "Courier New", monospace',
            cursorBlink: false,
            scrollback: 10000,
            convertEol: true,
            disableStdin: true,
            ...options,
        };
    }

    public initialize(): this {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container with id ${this.containerId} not found`);
        }

        container.innerHTML = '';
        this.terminal = new Terminal(this.options);
        this.fitAddon = new FitAddon();
        this.searchAddon = new SearchAddon();
        this.webLinksAddon = new WebLinksAddon();

        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.webLinksAddon);

        this.terminal.open(container);
        this.searchAddon.activate(this.terminal);

        setTimeout(() => this.fitAddon?.fit(), 100);

        this.setupEventListeners();
        return this;
    }

    private setupEventListeners(): void {
        let resizeTimeout: NodeJS.Timeout;
        this.resizeHandler = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => this.fitAddon?.fit(), 150);
        };
        window.addEventListener('resize', this.resizeHandler);
    }

    public addLog(logEntry: LogEntry): void {
        if (!this.terminal) return;

        if (this.welcomeMessageShown && this.logBuffer.length === 0) {
            this.terminal.clear();
            this.welcomeMessageShown = false;
        }

        this.logBuffer.push(logEntry);
        if (this.logBuffer.length > this.maxBufferSize) {
            this.logBuffer.shift();
        }

        const formattedLog = this.formatLogEntry(logEntry);
        this.terminal.write(formattedLog + '\r\n');
    }

    private formatLogEntry(logEntry: LogEntry): string {
        const timestamp = this.formatTimestamp(logEntry.timestamp);
        const level = this.detectLogLevel(logEntry.message);

        const coloredTimestamp = `\x1b[90m${timestamp}\x1b[0m`;
        let podIdentifier = '';
        if (logEntry.podName && logEntry.podName.length > 5) {
            const podSuffix = logEntry.podName.slice(-5);
            podIdentifier = ` \x1b[36m[${podSuffix}]\x1b[0m`;
        }

        let coloredMessage = this.highlightKeywords(logEntry.message);

        return `${coloredTimestamp}${podIdentifier} ${coloredMessage}`;
    }

    private formatTimestamp(timestamp: string): string {
        return new Date(timestamp).toLocaleTimeString('pt-BR', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }

    private detectLogLevel(message: string): 'error' | 'warn' | 'debug' | 'info' | 'trace' {
        const lowerMessage = message.toLowerCase();
        if (lowerMessage.includes('error') || lowerMessage.includes('fatal')) return 'error';
        if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) return 'warn';
        if (lowerMessage.includes('debug')) return 'debug';
        if (lowerMessage.includes('trace')) return 'trace';
        return 'info';
    }

    private highlightKeywords(message: string): string {
        // Simple highlighting, can be expanded
        return message.replace(/\b(error|warn|debug)\b/gi, '\x1b[1m$1\x1b[0m');
    }

    public search(term: string): void {
        this.searchTerm = term;
        if (this.searchAddon && term && this.terminal) {
            this.searchAddon.findNext(term);
        }
    }

    public searchNext(): void {
        if (this.searchAddon && this.searchTerm && this.terminal) {
            this.searchAddon.findNext(this.searchTerm);
        }
    }

    public searchPrevious(): void {
        if (this.searchAddon && this.searchTerm && this.terminal) {
            this.searchAddon.findPrevious(this.searchTerm);
        }
    }

    public clear(): void {
        this.terminal?.clear();
        this.logBuffer = [];
    }

    public scrollToTop(): void {
        this.terminal?.scrollToTop();
    }

    public scrollToBottom(): void {
        this.terminal?.scrollToBottom();
    }

    public destroy(): void {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        this.terminal?.dispose();
        this.terminal = null;
    }
}

export default LogViewer;
