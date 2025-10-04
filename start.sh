#!/bin/bash

# Script para iniciar o Kubernetes Tool

echo "🚀 Iniciando Kubernetes Tool..."

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

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Verificar se o kubeconfig existe
if [ -f "$HOME/.kube/config" ]; then
    echo "✅ Arquivo kubeconfig encontrado em $HOME/.kube/config"
else
    echo "⚠️  Arquivo kubeconfig não encontrado. Você pode selecionar um arquivo manualmente na aplicação."
fi

echo "🎯 Iniciando aplicação..."
npm start
