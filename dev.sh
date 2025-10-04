#!/bin/bash

# Script de desenvolvimento para Kubernetes Tool

echo "🔧 Modo de desenvolvimento - Kubernetes Tool"

# Verificar se o Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não está instalado. Por favor, instale o Node.js 16 ou superior."
    exit 1
fi

# Verificar se o npm está instalado
if ! command -v npm &> /dev/null; then
    echo "❌ npm não está instalado. Por favor, instale o npm."
    exit 1
fi

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Verificar se há um kubeconfig
if [ -f "$HOME/.kube/config" ]; then
    echo "✅ Arquivo kubeconfig encontrado em $HOME/.kube/config"
    echo "📋 Contextos disponíveis:"
    kubectl config get-contexts --output=name 2>/dev/null || echo "   (Execute 'kubectl config get-contexts' para ver os contextos)"
else
    echo "⚠️  Arquivo kubeconfig não encontrado em $HOME/.kube/config"
    echo "   Você pode usar o arquivo de exemplo: example-kubeconfig.yaml"
fi

echo ""
echo "🚀 Iniciando aplicação em modo de desenvolvimento..."
echo "   - DevTools serão abertos automaticamente"
echo "   - Recarregamento automático está ativo"
echo ""

# Executar em modo de desenvolvimento
npm run dev
