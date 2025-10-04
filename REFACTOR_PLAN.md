# 🔄 Plano de Refatoração - KubeDesk

## 📁 Nova Estrutura Proposta

```
src/
├── main/                           # Processo principal (Electron Main)
│   ├── index.js                   # Entry point principal
│   ├── window/
│   │   ├── WindowManager.js       # Gerenciamento de janelas
│   │   └── WindowConfig.js        # Configurações de janela
│   ├── ipc/
│   │   ├── IPCHandlers.js         # Registro de handlers IPC
│   │   ├── KubernetesHandlers.js  # Handlers específicos do K8s
│   │   └── FileHandlers.js        # Handlers de arquivos
│   ├── services/
│   │   ├── KubernetesService.js   # Lógica do Kubernetes
│   │   ├── ConfigService.js       # Gerenciamento de configurações
│   │   └── LogService.js          # Processamento de logs
│   └── utils/
│       ├── LogParser.js           # Parsing de logs
│       └── DateUtils.js           # Utilitários de data
│
├── renderer/                       # Processo de renderização
│   ├── index.html                 # HTML principal
│   ├── index.js                   # Entry point do renderer
│   ├── styles/
│   │   ├── main.css              # Estilos principais
│   │   ├── components.css        # Estilos de componentes
│   │   ├── tables.css            # Estilos de tabelas
│   │   └── logs.css              # Estilos específicos de logs
│   ├── components/
│   │   ├── Dashboard/
│   │   │   ├── Dashboard.js      # Componente principal
│   │   │   ├── Header.js         # Header do dashboard
│   │   │   └── Sidebar.js        # Sidebar de navegação
│   │   ├── Pods/
│   │   │   ├── PodsTable.js      # Tabela de pods
│   │   │   ├── PodRow.js         # Linha individual de pod
│   │   │   └── PodActions.js     # Ações dos pods
│   │   ├── Logs/
│   │   │   ├── LogViewer.js      # Visualizador de logs
│   │   │   ├── LogControls.js    # Controles de logs
│   │   │   └── LogToolbar.js     # Toolbar de logs
│   │   ├── Setup/
│   │   │   ├── SetupScreen.js    # Tela de configuração
│   │   │   └── ClusterSelector.js # Seletor de cluster
│   │   └── Common/
│   │       ├── LoadingSpinner.js # Spinner de loading
│   │       ├── ErrorMessage.js   # Mensagens de erro
│   │       └── Toast.js          # Notificações toast
│   ├── services/
│   │   ├── APIService.js         # Comunicação com main process
│   │   ├── StateManager.js       # Gerenciamento de estado
│   │   └── EventBus.js           # Sistema de eventos
│   ├── utils/
│   │   ├── DOMUtils.js           # Utilitários DOM
│   │   ├── FormatUtils.js        # Formatação de dados
│   │   └── Constants.js          # Constantes da aplicação
│   └── features/
│       ├── AutoRefresh/
│       │   ├── AutoRefreshManager.js # Gerenciamento do auto-refresh
│       │   └── AutoRefreshButton.js  # Botão de auto-refresh
│       └── Navigation/
│           ├── NavigationManager.js  # Gerenciamento de navegação
│           └── SectionManager.js     # Gerenciamento de seções
│
├── shared/                         # Código compartilhado
│   ├── constants/
│   │   ├── Events.js             # Eventos IPC
│   │   └── Config.js             # Configurações globais
│   ├── types/
│   │   ├── Pod.js                # Tipos/interfaces de Pod
│   │   └── Cluster.js            # Tipos/interfaces de Cluster
│   └── utils/
│       └── Validation.js         # Validações compartilhadas
│
└── assets/                        # Recursos estáticos
    ├── icons/
    └── images/
```

## 🎯 Benefícios da Nova Estrutura

### 1. **Separação de Responsabilidades**
- Cada arquivo tem uma responsabilidade específica
- Fácil localização de funcionalidades
- Manutenção simplificada

### 2. **Modularidade**
- Componentes reutilizáveis
- Fácil adição de novas funcionalidades
- Testes unitários mais simples

### 3. **Escalabilidade**
- Estrutura preparada para crescimento
- Padrões consistentes
- Organização clara

### 4. **Manutenibilidade**
- Código mais legível
- Debugging facilitado
- Refatorações mais seguras

## 🚀 Implementação Gradual

### Fase 1: Separação do Main Process
1. Extrair WindowManager
2. Separar IPC Handlers
3. Criar KubernetesService

### Fase 2: Modularização do Renderer
1. Extrair componentes principais
2. Criar StateManager
3. Implementar EventBus

### Fase 3: Refinamento
1. Otimizar componentes
2. Adicionar testes
3. Documentação

## 📋 Próximos Passos

1. **Começar com o Main Process** (menos complexo)
2. **Migrar gradualmente o Renderer**
3. **Manter funcionalidade durante refatoração**
4. **Testar cada módulo isoladamente**