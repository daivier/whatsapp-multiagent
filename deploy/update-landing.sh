#!/bin/bash
# Atualiza a landing/site de marketing de atendize.com (servida diretamente do
# repo principal pelo Nginx) e RECONSTRÓI o blog estático.
#
# Correr na VM sempre que mudar a landing OU os artigos do blog. O HTML do blog
# é gitignored (ver landing/blog/.gitignore) — tem de ser gerado aqui, senão
# /blog fica desatualizado ou dá 403.
#
# Uso: bash deploy/update-landing.sh
set -e

REPO="${REPO_DIR:-/home/daivier/whatsapp-multiagent}"
cd "$REPO"

echo "=== git pull (branch atual) ==="
git pull --ff-only

echo "=== Build do blog (landing/blog) ==="
cd "$REPO/landing/blog"
npm install --omit=dev --silent
node build.mjs

echo ""
echo "=== Landing atualizada ==="
echo "  https://atendize.com  e  https://atendize.com/blog/"
