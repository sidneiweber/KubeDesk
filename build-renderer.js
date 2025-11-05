const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
    entryPoints: [path.join(__dirname, 'src/renderer/renderer.ts')],
    bundle: true,
    outfile: path.join(__dirname, 'build/renderer/bundle.js'),
    platform: 'node', // 'node' for electron renderer
    target: 'es2020',
    external: ['electron'],
}).catch(() => process.exit(1));
