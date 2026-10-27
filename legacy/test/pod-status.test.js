/**
 * Testes de computePodStatus/podStatusClass.
 *
 * A coluna Status mostrava só `pod.status.phase`, que diz "Running" para um
 * pod em CrashLoopBackOff e para um pod sendo removido. Estes casos travam o
 * comportamento esperado, que é o do kubectl.
 */

const { computePodStatus, podStatusClass } = require('../src/shared/podStatus');

let fails = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) {
        console.log(`       esperado: ${JSON.stringify(expected)}`);
        console.log(`       obtido:   ${JSON.stringify(actual)}`);
        fails++;
    }
}

const pod = (spec, status, metadata = {}) => ({ metadata, spec, status });
const container = (state, ready = false, restartCount = 0) => ({ state, ready, restartCount });

console.log('status');
check('pod saudável',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [container({ running: {} }, true)] })).status,
    'Running');

check('crash loop não some atrás de "Running"',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [container({ waiting: { reason: 'CrashLoopBackOff' } }, false, 7)] })).status,
    'CrashLoopBackOff');

check('imagem que não baixa',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Pending', containerStatuses: [container({ waiting: { reason: 'ImagePullBackOff' } })] })).status,
    'ImagePullBackOff');

check('pod sendo removido',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [container({ running: {} }, true)] }, { deletionTimestamp: '2026-09-04T00:00:00Z' })).status,
    'Terminating');

check('job concluído',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Succeeded', containerStatuses: [container({ terminated: { reason: 'Completed', exitCode: 0 } })] })).status,
    'Completed');

check('OOMKilled',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [container({ terminated: { reason: 'OOMKilled', exitCode: 137 } }, false, 3)] })).status,
    'OOMKilled');

check('saída sem reason vira ExitCode',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Failed', containerStatuses: [container({ terminated: { exitCode: 2 } })] })).status,
    'ExitCode:2');

check('init container em andamento',
    computePodStatus(pod({ containers: [{}], initContainers: [{}, {}] }, { phase: 'Pending', initContainerStatuses: [{ state: { running: {} } }] })).status,
    'Init:0/2');

check('init container que falhou',
    computePodStatus(pod({ containers: [{}], initContainers: [{}] }, { phase: 'Pending', initContainerStatuses: [{ state: { terminated: { reason: 'Error', exitCode: 1 } } }] })).status,
    'Init:Error');

check('init pronto, app subindo',
    computePodStatus(pod({ containers: [{}], initContainers: [{}] }, {
        phase: 'Pending',
        initContainerStatuses: [{ state: { terminated: { exitCode: 0 } } }],
        containerStatuses: [container({ waiting: { reason: 'ContainerCreating' } })]
    })).status,
    'ContainerCreating');

check('pod ainda não agendado',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Pending' })).status,
    'Pending');

console.log('ready');
check('denominador é o spec, não os statuses (pod não agendado)',
    computePodStatus(pod({ containers: [{}] }, { phase: 'Pending' })).ready,
    '0/1');

check('um de dois containers pronto',
    computePodStatus(pod({ containers: [{}, {}] }, {
        phase: 'Running',
        containerStatuses: [container({ running: {} }, true), container({ running: {} }, false)]
    })).ready,
    '1/2');

check('restarts somam todos os containers',
    computePodStatus(pod({ containers: [{}, {}] }, {
        phase: 'Running',
        containerStatuses: [container({ running: {} }, true, 2), container({ running: {} }, true, 5)]
    })).restarts,
    7);

console.log('cor');
const cores = {
    'Running': 'running',
    'Completed': 'succeeded',
    'Succeeded': 'succeeded',
    'Pending': 'pending',
    'ContainerCreating': 'pending',
    'Terminating': 'pending',
    'Init:1/3': 'pending',
    'Init:Error': 'failed',
    'Init:CrashLoopBackOff': 'failed',
    'CrashLoopBackOff': 'failed',
    'OOMKilled': 'failed',
    'ExitCode:1': 'failed',
    'Signal:9': 'failed'
};
for (const [status, expected] of Object.entries(cores)) {
    check(`${status} -> ${expected}`, podStatusClass(status), expected);
}

console.log(fails === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${fails} FALHA(S)`);
process.exit(fails ? 1 : 0);
