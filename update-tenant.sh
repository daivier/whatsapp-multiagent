#!/bin/bash
# Actualiza um tenant com o código mais recente do repositório
#
# Uso: ./update-tenant.sh <slug>
# Exemplo: ./update-tenant.sh loja-abc

set -e

SLUG="$1"
BASE_DIR="/home/daivier/whatsapp-tenants"
TENANT_DIR="$BASE_DIR/$SLUG"

if [ -z "$SLUG" ]; then
  echo "Uso: $0 <slug>"
  exit 1
fi

if [ ! -d "$TENANT_DIR" ]; then
  echo "ERRO: Tenant '$SLUG' não encontrado em $TENANT_DIR"
  exit 1
fi

echo "=== Actualizar tenant: $SLUG ==="

echo "[1/3] A fazer pull do repositório..."
cd "$TENANT_DIR"
git pull

echo "[2/3] A recompilar frontend..."
cd "$TENANT_DIR/frontend"
npm install --silent
npm run build

echo "[3/3] A reiniciar backend..."
pm2 restart "wa-$SLUG"

echo ""
echo "Tenant '$SLUG' actualizado com sucesso."
