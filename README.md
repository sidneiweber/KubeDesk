# KubeDesk

Uma ferramenta moderna e intuitiva para gerenciar clusters Kubernetes, inspirada no Aptakube, desenvolvida com Electron.

## 🚀 Funcionalidades

- **Multi-Cluster**: Conecte-se a múltiplos clusters Kubernetes
- **Interface Intuitiva**: Interface moderna e fácil de usar
- **Visualização de Recursos**: Visualize pods, deployments, services e namespaces
- **Zero Configuração**: Funciona com seu arquivo kubeconfig existente
- **Tempo Real**: Atualização automática de status dos recursos
- **Busca e Filtros**: Encontre recursos rapidamente

## 📋 Pré-requisitos

- Node.js 16 ou superior
- npm ou yarn
- Arquivo kubeconfig configurado

## 🛠️ Instalação

1. Clone o repositório:
```bash
git clone <seu-repositorio>
cd kubernetes-tool
```

2. Instale as dependências:
```bash
npm install
```

3. Execute a aplicação:
```bash
npm start
```

Para desenvolvimento:
```bash
npm run dev
```

## 🏗️ Build

Para criar um executável:

```bash
npm run build
```

Os arquivos de distribuição serão criados na pasta `dist/`.

## 📖 Como Usar

1. **Primeira Execução**: A aplicação tentará carregar automaticamente seu arquivo kubeconfig padrão (`~/.kube/config`)

2. **Seleção de Cluster**: 
   - Se você tiver múltiplos clusters, selecione o desejado no dropdown
   - Clique em "Conectar"

3. **Navegação**:
   - Use o menu lateral para navegar entre diferentes recursos
   - Filtre por namespace usando o seletor no topo
   - Use a caixa de busca para encontrar recursos específicos

4. **Atualização**: Clique no botão "Atualizar" para sincronizar com o cluster

## 🎯 Recursos Disponíveis

- **Pods**: Visualize todos os pods com status, restarts, idade e informações do nó
- **Deployments**: Gerenciar deployments (em desenvolvimento)
- **Services**: Visualizar services (em desenvolvimento)
- **Namespaces**: Listar e gerenciar namespaces

## 🔧 Desenvolvimento

### Estrutura do Projeto

```
kubernetes-tool/
├── src/
│   ├── main.js              # Processo principal do Electron
│   └── renderer/
│       ├── index.html       # Interface principal
│       ├── styles.css       # Estilos CSS
│       └── renderer.js      # Lógica do renderer
├── assets/                  # Recursos estáticos
├── package.json            # Configuração do projeto
└── README.md              # Este arquivo
```

### Tecnologias Utilizadas

- **Electron**: Framework para aplicações desktop
- **@kubernetes/client-node**: Cliente oficial do Kubernetes para Node.js
- **js-yaml**: Parser para arquivos YAML
- **CSS Grid/Flexbox**: Layout responsivo

## 🚧 Roadmap

- [ ] Métricas de CPU e Memória
- [ ] Logs agregados de múltiplos pods
- [ ] Port forwarding
- [ ] Editor YAML integrado
- [ ] Ações rápidas (restart, scale, delete)
- [ ] Comparação de recursos entre clusters
- [ ] Suporte a Helm charts
- [ ] Temas (claro/escuro)

## 🤝 Contribuição

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🙏 Agradecimentos

- Inspirado no [Aptakube](https://aptakube.com)
- Baseado no cliente oficial Kubernetes para Node.js
- Comunidade Electron

## 📞 Suporte

Se você encontrar algum problema ou tiver sugestões, por favor abra uma issue no GitHub.
