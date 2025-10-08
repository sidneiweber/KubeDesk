const crypto = require('crypto');

function parseSyslogTimestamp(timestamp) {
    // Converter timestamp syslog para ISO format
    // Formato: Jan 03 16:22:07
    const months = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };

    const match = timestamp.match(/(\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2})/);
    if (match) {
        const [, month, day, hour, minute, second] = match;
        const currentYear = new Date().getFullYear();
        const paddedDay = day.padStart(2, '0');
        return `${currentYear}-${months[month]}-${paddedDay}T${hour}:${minute}:${second}.000Z`;
    }

    return new Date().toISOString();
}

function parseNginxTimestamp(timestamp) {
    // Converter timestamp do nginx para ISO format
    // Formato: 22/Jul/2025:08:55:11 +0000
    const months = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };

    const match = timestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
        const [, day, month, year, hour, minute, second] = match;
        return `${year}-${months[month]}-${day}T${hour}:${minute}:${second}.000Z`;
    }

    return new Date().toISOString();
}

function parseLogLine(line, podName, index) {
    // Padrões comuns de logs do Kubernetes - expandidos
    const timestampPatterns = [
        // ISO 8601 com milissegundos e Z
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/,
        // ISO 8601 sem milissegundos e Z
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/,
        // ISO 8601 sem Z
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
        // RFC 3339 com timezone
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2})/,
        // RFC 3339 sem milissegundos com timezone
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/,
        // Formato comum de containers: 2025-01-03T16:22:07.123456789Z
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z)/,
        // Formato com espaço: 2025-01-03 16:22:07
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
        // Formato com espaço e milissegundos: 2025-01-03 16:22:07.123
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/,
        // Formato syslog: Jan 03 16:22:07
        /^(\w{3} \d{1,2} \d{2}:\d{2}:\d{2})/,
        // Formato com colchetes: [2025-01-03T16:22:07Z]
        /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?)\]/
    ];

    const nginxRegex = /^(\d+\.\d+\.\d+\.\d+) - - \[([^\]]+)\] "([^"]+)" (\d+) (\d+) "([^"]*)" "([^"]*)" "([^"]*)"$/;
    const jsonRegex = /^\{.*\}$/;

    // Gerar ID baseado no conteúdo do log para consistência
    const logHash = crypto.createHash('md5').update(line).digest('hex').substring(0, 8);

    let log = {
        id: `${podName}-${logHash}`,
        timestamp: null,
        podName: podName,
        level: 'info',
        message: line,
        raw: line
    };

    // Tentar todos os padrões de timestamp
    let timestampFound = false;
    for (const pattern of timestampPatterns) {
        const match = line.match(pattern);
        if (match) {
            let timestamp = match[1];

            // Normalizar timestamp para ISO 8601
            if (pattern.source.includes(' ')) {
                // Converter formato com espaço para ISO
                timestamp = timestamp.replace(' ', 'T') + 'Z';
            } else if (pattern.source.includes('\\w{3}')) {
                // Converter formato syslog para ISO
                timestamp = parseSyslogTimestamp(timestamp);
            } else if (!timestamp.includes('T') && !timestamp.includes('Z')) {
                // Adicionar T e Z se necessário
                timestamp = timestamp.replace(' ', 'T') + 'Z';
            }

            log.timestamp = timestamp;
            log.message = line.substring(match[0].length).trim();
            log.hasRealTimestamp = true;
            timestampFound = true;
            break;
        }
    }

    if (!timestampFound) {
        // Se não há timestamp no log, usar timestamp atual apenas como fallback
        log.timestamp = new Date().toISOString();
        log.isApproximateTimestamp = true;
    }

    // Verificar se é um log do nginx
    const nginxMatch = line.match(nginxRegex);
    if (nginxMatch) {
        const [, ip, timestamp, request, status, size, referer, userAgent, forwarded] = nginxMatch;
        log.ip = ip;
        log.timestamp = parseNginxTimestamp(timestamp);
        log.message = `${request} ${status} ${size}`;
        log.level = parseInt(status) >= 400 ? 'error' : 'info';
        log.raw = line;
    }

    // Verificar se é um log JSON
    if (jsonRegex.test(line)) {
        try {
            const jsonLog = JSON.parse(line);
            log.timestamp = jsonLog.timestamp || log.timestamp;
            log.level = jsonLog.level || log.level;
            log.message = jsonLog.message || jsonLog.msg || line;
        } catch (e) {
            // Não é JSON válido, manter como está
        }
    }

    // Determinar nível do log baseado no conteúdo
    if (log.message.toLowerCase().includes('error') || log.message.toLowerCase().includes('fatal')) {
        log.level = 'error';
    } else if (log.message.toLowerCase().includes('warn') || log.message.toLowerCase().includes('warning')) {
        log.level = 'warning';
    } else if (log.message.toLowerCase().includes('debug')) {
        log.level = 'debug';
    }

    return log;
}

function parseLogs(logContent, podName) {
    if (!logContent || logContent.trim() === '') {
        return [];
    }

    const lines = logContent.split('\n').filter(line => line.trim());

    const logs = [];

    lines.forEach((line, index) => {
        // Tentar parsear diferentes formatos de log
        let parsedLog = parseLogLine(line, podName, index);
        if (parsedLog) {
            logs.push(parsedLog);
        }
    });

    return logs;
}

module.exports = {
    parseLogs,
    parseLogLine,
    parseNginxTimestamp,
    parseSyslogTimestamp
};