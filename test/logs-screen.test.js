/**
 * Testes de LogsScreen com um DOM mínimo, sem Electron.
 *
 * O objetivo é travar o comportamento da tela de logs para que as próximas
 * extrações do renderer.js tenham como conferir que nada mudou. Rode com
 * `npm test` — não há framework, só asserções e código de saída.
 */

const path = require('path').join(__dirname, '..', 'src', 'renderer', 'components', 'Logs', 'LogsScreen.js');

// --- stubs de DOM -------------------------------------------------------
class El {
  constructor(id){ this.id=id; this.children=[]; this.style={}; this.dataset={}; this._text=''; this.innerHTML=''; this.value=''; this.checked=false; this.listeners={}; }
  addEventListener(ev,fn){ (this.listeners[ev]=this.listeners[ev]||[]).push(fn); }
  fire(ev,arg){ (this.listeners[ev]||[]).forEach(fn=>fn(arg)); }
  appendChild(c){ this.children.push(c); return c; }
  insertBefore(c){ this.children.unshift(c); return c; }
  querySelectorAll(){ return []; }
  contains(){ return false; }
  remove(){ }
  set textContent(v){ this._text=String(v); }
  get textContent(){ return this._text; }
}
const registry = {};
global.document = {
  getElementById: (id) => registry[id] || (registry[id] = new El(id)),
  createElement: (t) => new El(t),
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: new El('body')
};
global.window = {};

// --- stub do LogViewer e dos utils --------------------------------------
const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../LogViewer') {
    return class FakeViewer {
      constructor(){ this.logs=[]; this.terminal={}; }
      initialize(){} destroy(){} resize(){} clear(){ this.logs=[]; }
      addLog(l){ this.logs.push(l); }
      getStats(){ return { total: this.logs.length }; }
      exportLogs(fmt){ return `viewer-export-${fmt}:${this.logs.length}`; }
    };
  }
  if (request === '../../utils/dom') {
    return { escapeHtml: (t)=>String(t), downloadBlob: (c,f)=>{ global.__downloaded={content:c,filename:f}; } };
  }
  return origLoad.apply(this, arguments);
};

const LogsScreen = require(path);

// --- contexto injetado ---------------------------------------------------
const calls = { errors: [], toasts: [], sections: [], sent: [] };
const ipcHandlers = {};
const ipc = {
  invoke: async (channel, ...args) => {
    calls.sent.push([channel, ...args]);
    if (channel === 'get-pod-containers') return [{name:'app', ready:true},{name:'sidecar', ready:false}];
    if (channel === 'get-deployment-pods') return [{name:'p-1',namespace:'ns'},{name:'p-2',namespace:'ns'}];
    if (channel === 'stream-pod-logs') return { success:true, streamId:'S1' };
    return null;
  },
  send: (ch, id) => calls.sent.push([ch, id]),
  on: (ch, fn) => { ipcHandlers[ch] = fn; }
};

const screen = new LogsScreen({
  ipcRenderer: ipc,
  getConnectionId: () => 'conn-1',
  switchSection: (s) => calls.sections.push(s),
  showError: (m) => calls.errors.push(m),
  showToast: (m,t) => calls.toasts.push([m,t]),
  showLoading: () => {}
});
screen.mount();

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? extra : ''); }
}

(async () => {
console.log('parseLine');
const withTs = screen.parseLine('2024-01-02T03:04:05.123456789Z hello ERROR world', 'pod-a');
check('extrai timestamp do kubectl', withTs.timestamp === '2024-01-02T03:04:05.123456789Z', withTs.timestamp);
check('remove o prefixo da mensagem', withTs.message === 'hello ERROR world', withTs.message);
check('marca timestamp real', withTs.isApproximateTimestamp === false);
check('detecta nível error', withTs.level === 'error', withTs.level);
const noTs = screen.parseLine('apenas uma linha de debug', null);
check('timestamp aproximado sem prefixo', noTs.isApproximateTimestamp === true);
check('detecta nível debug', noTs.level === 'debug', noTs.level);
check('nível padrão info', screen.parseLine('linha comum','p').level === 'info');

console.log('abrir logs de um pod');
await screen.showPod('meu-pod', 'default');
check('navegou para podLogs', calls.sections.includes('podLogs'));
check('alvo é o pod', screen.target.kind === 'pod' && screen.target.name === 'meu-pod');
check('não está em modo deployment', screen.isDeploymentMode() === false);
check('containers no select', document.getElementById('containerSelect').children.length === 2);
check('container não pronto fica desabilitado', document.getElementById('containerSelect').children[1].disabled === true);
check('stream aberto', screen.streamId === 'S1', screen.streamId);
check('placeholder "aguardando" presente', screen.entries.some(e => e.id === 'waiting-logs'));

console.log('chegada de logs');
ipcHandlers['log-stream-data'](null, { streamId:'S1', podName:'meu-pod', log:'linha 1\nlinha 2\n\n' });
check('placeholder removido', !screen.entries.some(e => e.id === 'waiting-logs'));
check('duas entradas reais', screen.entries.length === 2, screen.entries.length);
check('linhas vazias ignoradas', screen.entries.every(e => e.message.trim() !== ''));
check('contador atualizado', document.getElementById('logsCount').textContent === '2 logs', document.getElementById('logsCount').textContent);

console.log('isolamento de streams');
ipcHandlers['log-stream-data'](null, { streamId:'OUTRO', podName:'x', log:'intruso' });
check('descarta stream de outro pod', screen.entries.length === 2, screen.entries.length);

console.log('pausa');
screen.pause();
ipcHandlers['log-stream-data'](null, { streamId:'S1', podName:'meu-pod', log:'durante pausa' });
check('pausado não acumula', screen.entries.length === 2, screen.entries.length);
screen.resume();
ipcHandlers['log-stream-data'](null, { streamId:'S1', podName:'meu-pod', log:'depois' });
check('retomado volta a acumular', screen.entries.length === 3, screen.entries.length);

console.log('exportação');
const csv = screen.serialize('csv');
check('csv tem cabeçalho', csv.startsWith('Timestamp,Pod Name,IP,Message,Level,Raw\n'));
check('csv tem 3 linhas de dados', csv.trim().split('\n').length === 4, csv.trim().split('\n').length);
screen.entries.push({ id:'q', timestamp:'T', podName:'p', level:'info', message:'diz "oi"', raw:'diz "oi"' });
check('csv escapa aspas', screen.serialize('csv').includes('"diz ""oi"""'));
screen.entries.pop();
const txt = screen.serialize('text');
check('texto tem 3 linhas', txt.trim().split('\n').length === 3, txt.trim().split('\n').length);
screen.download('text');
check('download usa o buffer do terminal', global.__downloaded.content.startsWith('viewer-export-text'), global.__downloaded.content);
check('nome do arquivo usa o alvo', global.__downloaded.filename === 'pod-meu-pod-logs.text', global.__downloaded.filename);

console.log('troca de container reabre o stream');
calls.sent.length = 0;
document.getElementById('containerSelect').value = 'sidecar';
await document.getElementById('containerSelect').fire('change');
await new Promise(r => setImmediate(r));
const stops = calls.sent.filter(c => c[0] === 'stop-stream-pod-logs').length;
const starts = calls.sent.filter(c => c[0] === 'stream-pod-logs').length;
check('derrubou o stream anterior', stops === 1, stops);
check('abriu exatamente um novo stream', starts === 1, starts);
check('novo stream usa o container escolhido', calls.sent.find(c=>c[0]==='stream-pod-logs')[4] === 'sidecar');

console.log('fim de stream');
ipcHandlers['log-stream-end'](null, { streamId:'S1' });
check('marca fim', screen.streaming === false && screen.streamId === null);

console.log('deployment');
await screen.showDeployment('meu-deploy', 'ns');
check('modo deployment', screen.isDeploymentMode() === true);
check('guardou os pods', screen.target.pods.length === 2);
check('título com contagem', document.getElementById('podLogsTitle').textContent === 'meu-deploy (2 pods)', document.getElementById('podLogsTitle').textContent);
const deployStarts = calls.sent.filter(c=>c[0]==='stream-pod-logs').length;
check('um stream por pod', deployStarts >= 2, deployStarts);
ipcHandlers['log-stream-data'](null, { streamId:'QUALQUER', podName:'p-1', log:'log agregado' });
check('aceita qualquer stream em modo deployment', screen.entries.some(e=>e.message==='log agregado'));

console.log('fechar');
screen.close();
check('alvo limpo', screen.target === null);
check('sem streaming', screen.streaming === false);

console.log('limite de memória');
screen.target = { kind:'pod', name:'p', namespace:'n' };
for (let i=0;i<5100;i++) screen.addEntry({ id:`x${i}`, timestamp:'T', level:'info', message:`m${i}`, raw:'' });
check('buffer limitado a 5000', screen.entries.length === 5000, screen.entries.length);
check('descarta os mais antigos', screen.entries[0].message === 'm100', screen.entries[0].message);

console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
})();
