#!/bin/bash
# Executar na VM para atualizar: bash deploy/update.sh
set -e

echo "=== A atualizar ==="
git pull origin master

echo "=== Backend ==="
cd backend && npm install --production && cd ..

echo "=== Frontend ==="
cd frontend && npm install && npm run build && cd ..

echo "=== Blog (landing) ==="
cd landing/blog && npm install --omit=dev && npm run build && cd ../..

echo "=== Reiniciando ==="
pm2 restart whatsapp-backend

echo "Atualização completa!"
