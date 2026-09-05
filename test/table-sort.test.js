/**
 * Testes da ordenação das tabelas.
 *
 * A engine vive no renderer.js, que não é um módulo — então extraímos o
 * trecho e avaliamos aqui. Se o bloco for movido para um módulo próprio,
 * troque este recorte por um require.
 */

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
const start = src.indexOf('const sortState = {}');
const end = src.indexOf('// Clique no cabeçalho alterna');
eval(src.slice(start, end) + '\nglobalThis.sortItems = sortItems; globalThis.sortState = sortState;');

let fails = 0;
const check = (n, c, x) => { console.log((c?'  ok   ':'  FAIL ')+n, c?'':JSON.stringify(x)); if(!c) fails++; };

const pods = [
  { name:'zeta',  restarts: 2, creationTimestamp:'2026-09-01T00:00:00Z', readyCount:1, totalContainers:1, metrics:{cpu:{percentage:10},memory:{percentage:5}} },
  { name:'alpha', restarts:11, creationTimestamp:'2026-08-01T00:00:00Z', readyCount:0, totalContainers:2, metrics:{cpu:{percentage:90},memory:{percentage:50}} },
  { name:'meio',  restarts: 0, creationTimestamp:'2026-09-03T00:00:00Z', readyCount:2, totalContainers:2, metrics:{cpu:{percentage:1},memory:{percentage:1}} }
];

sortState.pods = { column:'name', direction:'asc' };
check('nome asc', sortItems('pods', pods).map(p=>p.name).join(',') === 'alpha,meio,zeta', sortItems('pods',pods).map(p=>p.name));

sortState.pods = { column:'name', direction:'desc' };
check('nome desc', sortItems('pods', pods).map(p=>p.name).join(',') === 'zeta,meio,alpha');

sortState.pods = { column:'restarts', direction:'desc' };
check('restarts numérico (11 > 2)', sortItems('pods', pods).map(p=>p.restarts).join(',') === '11,2,0', sortItems('pods',pods).map(p=>p.restarts));

sortState.pods = { column:'age', direction:'desc' };
check('age usa o timestamp, não o texto', sortItems('pods', pods).map(p=>p.name).join(',') === 'meio,zeta,alpha', sortItems('pods',pods).map(p=>p.name));

sortState.pods = { column:'ready', direction:'asc' };
check('ready ordena por fração', sortItems('pods', pods).map(p=>`${p.readyCount}/${p.totalContainers}`).join(',') === '0/2,1/1,2/2', sortItems('pods',pods).map(p=>`${p.readyCount}/${p.totalContainers}`));

sortState.pods = { column:'cpuUsage', direction:'desc' };
check('cpu desc', sortItems('pods', pods)[0].name === 'alpha');

delete sortState.pods;
check('sem estado preserva a ordem do cluster', sortItems('pods', pods).map(p=>p.name).join(',') === 'zeta,alpha,meio');

sortState.pods = { column:'coluna-inexistente', direction:'asc' };
check('coluna sem accessor não ordena', sortItems('pods', pods).map(p=>p.name).join(',') === 'zeta,alpha,meio');

const original = [...pods];
sortState.pods = { column:'name', direction:'asc' };
sortItems('pods', pods);
check('não muta o cache', pods.every((p,i)=>p===original[i]));

const comNulo = [{name:'b', node:'no-2'},{name:'a', node:null},{name:'c', node:'no-1'}];
sortState.pods = { column:'node', direction:'asc' };
check('nulos vão para o fim (asc)', sortItems('pods', comNulo).map(p=>p.name).join(',') === 'c,b,a', sortItems('pods',comNulo).map(p=>p.name));
sortState.pods = { column:'node', direction:'desc' };
check('nulos vão para o fim (desc)', sortItems('pods', comNulo).map(p=>p.name).join(',') === 'b,c,a', sortItems('pods',comNulo).map(p=>p.name));

const numerados = [{name:'pod-10'},{name:'pod-2'},{name:'pod-1'}];
sortState.pods = { column:'name', direction:'asc' };
check('ordem natural: pod-2 antes de pod-10', sortItems('pods', numerados).map(p=>p.name).join(',') === 'pod-1,pod-2,pod-10', sortItems('pods',numerados).map(p=>p.name));

console.log(fails === 0 ? '\nTODOS OS TESTES DE ORDENAÇÃO PASSARAM' : `\n${fails} FALHA(S)`);
process.exit(fails ? 1 : 0);
