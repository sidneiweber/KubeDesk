/**
 * Formata a idade de um recurso a partir do seu creationTimestamp.
 *
 * Segue a convenção do kubectl: duas unidades enquanto a maior for pequena
 * ("5h 30m"), caindo para segundos abaixo de um minuto. Única implementação
 * usada pelo main e pelo renderer — antes cada tela tinha a sua e a mesma
 * idade aparecia em formatos diferentes conforme a aba.
 */
function formatAge(creationTimestamp) {
    if (!creationTimestamp) return '-';

    const created = new Date(creationTimestamp);
    if (Number.isNaN(created.getTime())) return '-';

    const diffMs = Date.now() - created.getTime();
    if (diffMs < 0) return '-';

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

module.exports = { formatAge };
