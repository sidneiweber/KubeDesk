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
├── main.js                        # Processo principal: handlers IPC (763)
├── main/
│   └── services/
│       ├── DeploymentService.js   # Operações com Deployments (329)
│       └── LogService.js          # Streaming de logs (56)
├── shared/
│   ├── formatAge.js               # Formatação de idade, usada pelos dois processos (29)
│   └── podStatus.js               # Status de pod no formato do kubectl (143)
└── renderer/
    ├── index.html                 # (986)
    ├── renderer.js                # Monolito do renderer (3776)
    ├── styles.css                 # (3666)
    ├── utils/
    │   └── dom.js                 # escapeHtml e downloadBlob (24)
    └── components/
        ├── LogViewer.js           # Terminal de logs via xterm.js (359)
        ├── Logs/
        │   └── LogsScreen.js      # Tela de logs: estado, streaming, exportação (838)
        └── Services/
            └── ServiceDetails.js  # Painel de detalhes de Service (208)

test/
├── run.js                         # Runner: roda cada *.test.js num processo (26)
├── logs-screen.test.js            # Comportamento de LogsScreen, sem Electron (178)
├── pod-status.test.js             # Status/ready no formato do kubectl (114)
└── table-sort.test.js             # Ordenação das tabelas (65)
```

Só existem componentes para o que é realmente usado. Não crie arquivo de
componente sem ligá-lo a um call site no mesmo commit.

## Convenções estabelecidas

- **Handlers IPC** que precisam de cluster usam `handleWithCluster(canal, descrição, fn)`,
  que resolve o `connectionId` e prefixa erros. Não repita a busca no `activeConfigs`.
- **Nunca simular dados de medição.** Se uma métrica não está disponível, o valor é
  `null` e a UI mostra `N/D`. Um número plausível inventado é indistinguível de uma
  medição real e destrói a confiança na ferramenta. Ver o commit
  "Nunca exibir métricas simuladas como se fossem medições".
- **Menus de contexto** usam `showContextMenu(event, items)` com `action` em closure.
  Não interpole nomes de recurso em `onclick="..."`. Não sobrou nenhum handler
  em atributo HTML, e o bloco de `window.<função> = ...` que os alimentava foi removido.
- **Componentes do renderer** são módulos CommonJS carregados com `nodeRequire`
  (como `LogViewer` e `LogsScreen`), não `<script>` + variável global. O
  `ServiceDetails.js` ainda usa o padrão antigo e é a exceção a migrar.
- **Componentes recebem o que precisam por injeção.** `LogsScreen` recebe
  `ipcRenderer`, `getConnectionId`, `switchSection`, `showError`, `showToast` e
  `showLoading` no construtor; não lê nenhuma global do `renderer.js`. Siga isso
  nas próximas extrações — é o que torna a tela testável sem Electron.
- **Código compartilhado entre main e renderer** vai em `src/shared/`, com `require`
  dos dois lados (o renderer usa `nodeRequire`). O que é só do renderer e serve a
  mais de um arquivo vai em `src/renderer/utils/`.
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
| `26f1457` | Reescreve este arquivo para descrever o que existe |
| (atual) | Implementa Ingresses e Endpoints, que tinham menu mas nenhum conteúdo |
| (atual) | Extrai `LogsScreen` do `renderer.js` e cria os primeiros testes |
| (atual) | Corrige status e ready dos pods, que mostravam verde para pod quebrado |
| (atual) | Coluna de ações, ordenação por coluna e busca que não vai ao cluster |

## O que ainda falta

Em ordem de valor:

1. **`renderer.js` (3776 linhas) continua um monolito**, mesmo depois de a tela
   de logs sair — as melhorias de usabilidade o fizeram crescer de novo. É de longe o maior problema restante. Os candidatos
   naturais a extração, na ordem em que dão menos trabalho:
   - Pods (`loadPods`, `updatePodsData`, `createPodRow`, `updatePodRow`, ~500 linhas)
   - Deployments (`showDeploymentDetails`, `renderDeploymentDetails`, escala/restart, ~450 linhas)
   - Networking (ingresses e endpoints, ~280 linhas, código recente e coeso)
   - Preferências de colunas (`loadColumnPreferences`, `initializeColumnSelector`, ~180 linhas)
   - Estado global: eram 24 variáveis soltas no topo, hoje são 12. As que sobraram
     (`currentPodName`, `currentServiceName`, `currentYamlContent`...) saem junto
     com as telas a que pertencem.

2. **`styles.css` (3666 linhas)** — sem divisão por área.

3. **Testes: cobrem `LogsScreen`, o status dos pods e a ordenação.** `npm test`
   roda `test/run.js`, que executa cada `*.test.js` num processo próprio. Não há
   framework e não precisa ter. O que falta cobrir, em ordem de custo-benefício:
   as funções puras do main (`formatAge`, `buildPodMetrics`,
   `parseCpuToMillicores`, as projeções de ingress/endpoint) e cada componente
   novo que sair do `renderer.js`.

   A engine de ordenação ainda mora dentro do `renderer.js`, então
   `table-sort.test.js` extrai o trecho com `eval`. Quando ela virar módulo,
   troque o recorte por um `require`.

4. **`nodeIntegration: true` + `contextIsolation: false`** (`src/main.js`) é a
   configuração que o Electron desaconselha — o aviso de CSP aparece no console a
   cada execução. Migrar exige um script de `preload` expondo uma API restrita e
   trocar todos os `require`/`ipcRenderer` diretos do renderer. É trabalhoso e vale
   a pena antes de qualquer distribuição mais ampla. A injeção de dependências do
   `LogsScreen` já deixa essa migração mais barata: só o ponto de construção muda.

5. **`check-metrics-server`** está registrado e ninguém chama. Com as métricas agora
   mostrando `N/D`, ele serviria para explicar o porquê na UI — ou deve ser removido.

6. **`v1 Endpoints` está deprecado a partir do Kubernetes 1.33**, em favor de
   `discovery.k8s.io/v1 EndpointSlice`. A tela de Endpoints funciona hoje, mas a
   migração vai ser necessária.

7. **`reloadPod` só mostra "Funcionalidade em desenvolvimento"**, mas continua no
   menu de contexto do pod como "Reiniciar". Reiniciar um pod é apagá-lo e deixar
   o controlador recriar — ação destrutiva, que precisa de confirmação explícita.
   Implementar ou tirar do menu: hoje é uma promessa que não se cumpre.

8. **Seletor de colunas só existe em Pods e Deployments.** Estender para Services,
   Ingresses, Endpoints e Namespaces exige generalizar `initializeColumnSelector`
   (hoje amarrado a `PODS_COLUMNS`/`DEPLOYMENTS_COLUMNS`) e um modal por seção.
   Ficou de fora por custar bem mais que o resto e render menos: essas tabelas têm
   de 4 a 7 colunas, que cabem na tela sem precisar esconder nada.

9. **Acessibilidade foi só o começo.** Há `role`, `aria-sort` e `aria-label` nos
   pontos que mudaram, e foco visível em toda a superfície interativa. Faltam:
   foco preso nos modais (focus trap), região `aria-live` para os toasts e
   contexto de linha nas tabelas.

## Como abordar

Extrair um módulo por vez, com o call site ligado no mesmo commit, e conferir que
o comportamento não mudou. Nunca deixe o arquivo novo e o código antigo convivendo:
foi exatamente assim que as 1.400 linhas órfãs apareceram.

O roteiro que funcionou para `LogsScreen`, para repetir nas próximas telas:

1. Mapear o que é estado daquela tela e o que ela usa do `renderer.js`.
2. Criar a classe recebendo essas dependências por injeção; ela resolve os
   próprios elementos do DOM e registra os próprios listeners num `mount()`.
3. Trocar os call sites e apagar o código antigo **no mesmo passo**.
4. Conferir que nenhum símbolo removido ficou referenciado, e que nenhum
   `elements.*` da tela extraída sobrou no `renderer.js`.
5. Escrever o teste com DOM stub antes de considerar a extração pronta.
