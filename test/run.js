/**
 * Runner mínimo: roda cada *.test.js em um processo próprio e falha se algum
 * falhar. Não há framework porque nenhum é necessário até aqui.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;

for (const file of files) {
    console.log(`\n── ${file} ${'─'.repeat(Math.max(0, 60 - file.length))}`);
    try {
        execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    } catch {
        failed++;
    }
}

console.log(failed === 0
    ? `\n${files.length} arquivo(s) de teste, todos passaram.`
    : `\n${failed} de ${files.length} arquivo(s) falharam.`);

process.exit(failed ? 1 : 0);
