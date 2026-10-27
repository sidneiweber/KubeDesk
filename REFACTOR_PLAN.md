# Reescrita - KubeDesk

O app está sendo reescrito do zero em **Electron + TypeScript + Svelte 5**, no
branch `rewrite/electron-svelte-ts`. O código antigo está em `legacy/` só como
referência para o porte, e sai do repositório quando a última tela for portada.

Por que reescrever em vez de continuar extraindo módulos do `renderer.js`: o
monolito de 3.776 linhas, o estado global e o `nodeIntegration: true` com
`contextIsolation: false` estavam ligados entre si. Separar um exigia mexer em
todos. A base nova já nasce com a separação, e cada tela é portada uma vez,
direto para o formato final.

## Arquitetura

```
src/
├── main/                     # Processo principal: único lugar que fala com o cluster
│   ├── index.ts              # Janela, segurança, ciclo de vida
│   ├── ipc.ts                # Handlers tipados e registro de assinaturas
│   └── kube/
│       ├── connection.ts     # kubeconfig, contextos, conexão
│       ├── errors.ts         # Mensagem legível a partir de erros da client-node
│       ├── watch.ts          # Watch genérico em lotes (informer + reset + retry)
│       ├── podStatus.ts      # Status no formato do kubectl (+ teste)
│       ├── pods.ts           # Linha de pod e watcher
│       ├── deployments.ts    # Linha, status, watcher, escalar, reiniciar (+ teste)
│       ├── logs.ts           # Stream de logs
│       └── lineBatcher.ts    # Linhas inteiras, em lotes (+ teste)
├── preload/index.ts          # Expõe window.kube; nada mais do Node chega à página
├── shared/api.ts             # Contrato: tipos, canais invoke e canais de evento
└── renderer/src/
    ├── App.svelte
    ├── components/
    │   ├── table/            # ResourceTable (filtro, ordenação, vazio) e StatusPill
    │   ├── Modal.svelte      # <dialog> nativo: foco preso e Esc sem código nosso
    │   ├── Toasts.svelte
    │   └── pods/, deployments/, logs/, ConnectScreen, Sidebar
    └── lib/
        ├── liveList.svelte.ts  # Lista ao vivo: abre/fecha o watch com o componente
        ├── session.svelte.ts   # Contexto e namespace atuais
        ├── toasts.svelte.ts, now.svelte.ts
        └── sort.ts, formatAge.ts (+ testes)
```

### Regras

- **O renderer não tem Node.** `contextIsolation`, `sandbox` e sem
  `nodeIntegration`. Tudo passa por `window.kube`, definido em
  `src/preload/index.ts` e tipado em `KubeApi` (`src/shared/api.ts`).
- **Todo canal IPC está em `shared/api.ts`.** `Invoke` lista os
  request/response, com argumentos e retorno; `Events` lista os eventos do main
  para o renderer. Um canal fora dessas interfaces não compila.
- **Dados vivos usam assinatura, não polling.** `watch(kind, …)` e
  `streamLogs` devolvem uma função de cancelar. No renderer, `LiveList` cuida
  disso: abre o watch quando o componente aparece e fecha quando ele sai. O preload escolhe o id e registra os
  listeners *antes* de pedir ao main para começar, senão o primeiro lote
  poderia chegar antes de alguém estar ouvindo. O main encerra todas as
  assinaturas ao trocar de cluster, ao recarregar a página e ao fechar a janela.
- **O main entrega dados prontos para a tela.** `PodRow` e `DeploymentRow` já
  vêm com status, cor e contagens calculados; o renderer não importa
  `@kubernetes/client-node`. Se o detalhe de um recurso é pequeno, ele vai na
  própria linha (como em `DeploymentRow`) e os detalhes ficam ao vivo sem
  outro watch.
- **Ações destrutivas pedem confirmação em `Modal`** e dizem o impacto real
  (ex.: reiniciar com estratégia Recreate derruba o serviço). O resultado
  aparece num toast; a tabela se atualiza sozinha pelo watch.
- **Erros chegam com a mensagem do Kubernetes**, via `errorMessage()`, e não
  com o dump de headers do `ApiException`.
- **Nunca simular dados de medição.** Métrica indisponível é `null` e a UI
  mostra `N/D` (regra mantida do app antigo).
- **Sem CDN.** O app precisa funcionar offline; a CSP em `index.html` bloqueia
  qualquer origem externa.

### Gotchas da client-node 2.x

- `makeInformer`: quando a listagem falha, emite `error` **e o `start()`
  resolve mesmo assim**. Sem tratar isso, a falha vira uma tabela vazia
  (`pods.ts` controla com a flag `failed`). Depois de um `error` o informer
  para de vez e precisa de um novo `start()`.
- `Log.log`: o callback de fim nunca é chamado e erros HTTP descartam o motivo.
  Por isso `logs.ts` faz o fetch direto, com a mesma autenticação
  (`applySecurityAuthentication`).

## Status do porte

| Tela / recurso | Status |
|---|---|
| Conexão (kubeconfig padrão ou arquivo, contexto) | Portado |
| Pods: lista em tempo real, status do kubectl, ordenação, filtro local | Portado |
| Logs de pod: container, tail, timestamps, follow, busca, linhas/s | Portado |
| Deployments: lista, status do `rollout status`, escalar, reiniciar | Portado |
| Detalhes do deployment: réplicas, condições, containers, labels, pods e logs | Portado |
| Métricas de CPU/memória dos pods (`get-pods-metrics-batch`) | Falta |
| Seletor de colunas com preferências salvas | Falta |
| Menu de contexto nas linhas | Falta |
| Visualizador de YAML (Prism) | Falta |
| Logs: pausar, exportar/copiar, logs agregados de deployment | Falta |
| Namespaces | Falta |
| Services e detalhes | Falta |
| Ingresses | Falta |
| Endpoints (portar já para `discovery.k8s.io/v1 EndpointSlice`) | Falta |

Quando todas estiverem portadas: apagar `legacy/`, `dev.sh` e `start.sh`.

## Como portar uma tela

Toda tela de lista segue o caminho de Deployments:

1. Ler o trecho em `legacy/` e listar o que a tela faz de fato.
2. `shared/api.ts`: declarar `XxxRow` e incluir em `WatchRows`.
3. `main/kube/xxx.ts`: `toXxxRow` e um watcher que chama `watchResource`.
   Registrar o watcher em `watchers` (`main/ipc.ts`). Ações (escalar, apagar…)
   viram canais em `Invoke`, expostos no preload.
4. Renderer: `new LiveList('xxx', () => ({ namespace }))` e `ResourceTable`
   com as colunas. Status usa `StatusPill`.
5. Lógica pura (status, formatação, seletores) ganha teste `*.test.ts` ao lado.
6. Marcar a tela como pronta na `Sidebar` e nesta tabela.

## Verificação

- `npm test` — testes unitários (Vitest).
- `npm run typecheck` — main, preload e renderer.
- `npm run dev` contra um cluster real (o minikube serve) antes de dar a tela
  como pronta.

## Pendências fora do código

- `electron-builder.json` aponta para `assets/icon.icns`, `assets/icon.ico` e
  `build/entitlements.mac.plist`, que não existem no repositório. O build de
  Linux funciona; os de macOS e Windows vão falhar até esses arquivos existirem.
