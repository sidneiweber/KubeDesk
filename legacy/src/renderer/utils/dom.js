/**
 * Utilitários de DOM compartilhados entre o renderer.js e os componentes.
 */

// Escapa texto para interpolação segura em innerHTML.
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Baixa conteúdo como arquivo via blob temporário.
function downloadBlob(content, filename, mimeType = 'text/plain') {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

module.exports = { escapeHtml, downloadBlob };
