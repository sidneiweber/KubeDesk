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
│       ├── podStatus.ts      # Status no formato do kubectl (+ teste)
│       ├── pods.ts           # Watch de pods em lotes
│       ├── logs.ts           # Stream de logs
│       └── lineBatcher.ts    # Linhas inteiras, em lotes (+ teste)
├── preload/index.ts          # Expõe window.kube; nada mais do Node chega à página
├── shared/api.ts             # Contrato: tipos, canais invoke e canais de evento
└── renderer/src/
    ├── App.svelte
    ├── components/           # ConnectScreen, Sidebar, pods/, logs/
    └── lib/                  # session (estado), sort, formatAge (+ testes)
```

### Regras

- **O renderer não tem Node.** `contextIsolation`, `sandbox` e sem
  `nodeIntegration`. Tudo passa por `window.kube`, definido em
  `src/preload/index.ts` e tipado em `KubeApi` (`src/shared/api.ts`).
- **Todo canal IPC está em `shared/api.ts`.** `Invoke` lista os
  request/response, com argumentos e retorno; `Events` lista os eventos do main
  para o renderer. Um canal fora dessas interfaces não compila.
- **Dados vivos usam assinatura, não polling.** `watchPods` e `streamLogs`
  devolvem uma função de cancelar. O preload escolhe o id e registra os
  listeners *antes* de pedir ao main para começar, senão o primeiro lote
  poderia chegar antes de alguém estar ouvindo. O main encerra todas as
  assinaturas ao trocar de cluster, ao recarregar a página e ao fechar a janela.
- **O main entrega dados prontos para a tela.** `PodRow` já vem com status,
  cor e ready calculados; o renderer não importa `@kubernetes/client-node`.
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
| Métricas de CPU/memória dos pods (`get-pods-metrics-batch`) | Falta |
| Seletor de colunas com preferências salvas | Falta |
| Menu de contexto nas linhas | Falta |
| Visualizador de YAML (Prism) | Falta |
| Logs: pausar, exportar/copiar, logs agregados de deployment | Falta |
| Deployments: lista, detalhes, escalar, reiniciar | Falta |
| Namespaces | Falta |
| Services e detalhes | Falta |
| Ingresses | Falta |
| Endpoints (portar já para `discovery.k8s.io/v1 EndpointSlice`) | Falta |

Quando todas estiverem portadas: apagar `legacy/`, `dev.sh` e `start.sh`.

## Como portar uma tela

1. Ler o trecho em `legacy/` e listar o que a tela faz de fato.
2. Declarar em `shared/api.ts` o formato da linha (`XxxRow`) e os canais.
3. Escrever o módulo em `main/kube/`, devolvendo dados prontos para exibir. Se
   a lista muda sozinha no cluster, usar watch como em `pods.ts`.
4. Expor no preload e criar o componente em `renderer/src/components/`.
5. Lógica pura (status, formatação, ordenação) ganha teste `*.test.ts` ao lado.
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
