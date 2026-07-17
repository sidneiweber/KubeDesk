# Refatoração - KubeDesk

Este documento descreve a estrutura **que existe hoje** e o que ainda falta.

> A versão anterior deste arquivo propunha uma árvore de ~40 arquivos
> (`StateManager`, `EventBus`, `PreferenceService`, `shared/types/`...) que nunca
> foi construída. Pior: a tentativa parcial de segui-la deixou 5 componentes
> órfãos no repositório, que o `renderer.js` reimplementava inline — 1.400 linhas
> que nunca rodaram. Um plano que descreve uma estrutura inexistente atrapalha
> mais do que ajuda, então aqui só entra o que é real.

## Estrutura atual

```
src/
├── main.js                        # Processo principal: handlers IPC (659)
├── main/
│   └── services/
│       ├── DeploymentService.js   # Operações com Deployments (329)
│       └── LogService.js          # Streaming de logs (56)
├── shared/
│   └── formatAge.js               # Formatação de idade, usada pelos dois processos (29)
└── renderer/
    ├── index.html                 # (885)
    ├── renderer.js                # Monolito do renderer: 106 funções (4191)
    ├── styles.css                 # (3529)
    └── components/
        ├── LogViewer.js           # Terminal de logs via xterm.js (359)
        └── Services/
            └── ServiceDetails.js  # Painel de detalhes de Service (208)
```

Só existem dois componentes porque só esses dois são realmente usados. Não crie
arquivo de componente sem ligá-lo a um call site no mesmo commit.

## Convenções estabelecidas

- **Handlers IPC** que precisam de cluster usam `handleWithCluster(canal, descrição, fn)`,
  que resolve o `connectionId` e prefixa erros. Não repita a busca no `activeConfigs`.
- **Nunca simular dados de medição.** Se uma métrica não está disponível, o valor é
  `null` e a UI mostra `N/D`. Um número plausível inventado é indistinguível de uma
  medição real e destrói a confiança na ferramenta. Ver o commit
  "Nunca exibir métricas simuladas como se fossem medições".
- **Menus de contexto** usam `showContextMenu(event, items)` com `action` em closure.
  Não interpole nomes de recurso em `onclick="..."`.
- **Código compartilhado entre main e renderer** vai em `src/shared/`, com `require`
  dos dois lados (o renderer usa `nodeRequire`).
- **Sem dependências de CDN.** O app precisa funcionar offline, e o renderer roda
  com `nodeIntegration` ligado.

## O que já foi feito

| Commit | Efeito |
|---|---|
| `d41994d` | Remove 5 componentes órfãos e o caminho de menu de contexto nativo |
| `ba0d2ae` | Elimina 3 pontos que fabricavam métricas com `Math.random()` |
| `6cfaf81` | Extrai `handleWithCluster`; remove `LogParser.js` morto |
| `416bc93` | Unifica menus de contexto e visualizadores de YAML |
| `1202643` | Prism local, `formatAge` compartilhado, remove deps não usadas |

Saldo: **-2.349 linhas** (517 inseridas, 2.866 removidas).

## O que ainda falta

Em ordem de valor:

1. **`renderer.js` (4191 linhas, 106 funções) continua um monolito.** É de longe o
   maior problema restante. Os candidatos naturais a extração, na ordem em que dão
   menos trabalho:
   - Logs (`showPodLogs`, `streamLogs`, `filterLogs`, download/cópia, ~600 linhas)
   - Pods (`loadPods`, `updatePodsData`, `createPodRow`, `updatePodRow`, ~500 linhas)
   - Preferências de colunas (`loadColumnPreferences`, `initializeColumnSelector`, ~180 linhas)
   - Estado global (`currentConnectionId`, `currentPodName`, ~20 variáveis soltas no topo)

2. **`styles.css` (3529 linhas)** — sem divisão por área.

3. **Sem testes.** Não há framework instalado; o `package.json` aponta `test:build`
   para um `test-build.sh` que não existe. As funções puras (`formatAge`,
   `buildPodMetrics`, `parseCpuToMillicores`) são o ponto de partida mais barato.

4. **`nodeIntegration: true` + `contextIsolation: false`** (`src/main.js`) é a
   configuração que o Electron desaconselha. Migrar exige um script de `preload`
   expondo uma API restrita e trocar todos os `require`/`ipcRenderer` diretos do
   renderer. É trabalhoso e vale a pena antes de qualquer distribuição mais ampla.

5. **`check-metrics-server`** está registrado e ninguém chama. Com as métricas agora
   mostrando `N/D`, ele serviria para explicar o porquê na UI — ou deve ser removido.

## Como abordar

Extrair um módulo por vez, com o call site ligado no mesmo commit, e conferir que
o comportamento não mudou. Nunca deixe o arquivo novo e o código antigo convivendo:
foi exatamente assim que as 1.400 linhas órfãs apareceram.
