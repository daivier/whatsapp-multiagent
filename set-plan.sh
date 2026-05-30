#!/bin/bash
# Define o plano comercial de um tenant (layout clone) e reinicia o backend.
#
# Uso: ./set-plan.sh <slug> <basico|profissional|empresarial>
# Exemplo: ./set-plan.sh supermercados empresarial
#
# O plano é gravado como PLAN=<plano> no .env do tenant. O backend lê-o no
# arranque (backend/src/plan.js). Default quando ausente = empresarial.

set -e

SLUG="$1"
PLANO="$2"

if [ -z "$SLUG" ] || [ -z "$PLANO" ]; then
  echo "Uso: $0 <slug> <basico|profissional|empresarial>"
  exit 1
fi

case "$PLANO" in
  basico|profissional|empresarial) ;;
  *) echo "Plano inválido: '$PLANO'. Use: basico | profissional | empresarial"; exit 1 ;;
esac

ENV="/home/daivier/whatsapp-tenants/$SLUG/backend/.env"
if [ ! -f "$ENV" ]; then
  echo "ERRO: não encontrei $ENV"
  echo "Se for um tenant partilhado (ecosystem.config.js), define PLAN no env"
  echo "desse app no ecosystem.config.js e corre: pm2 reload ecosystem.config.js"
  exit 1
fi

# Remove qualquer PLAN= anterior e acrescenta o novo
sed -i '/^PLAN=/d' "$ENV"
echo "PLAN=$PLANO" >> "$ENV"
echo "[set-plan] $SLUG -> PLAN=$PLANO ($ENV)"

if pm2 restart "wa-$SLUG" --update-env >/dev/null 2>&1; then
  echo "[set-plan] wa-$SLUG reiniciado com o novo plano."
else
  echo "[set-plan] AVISO: 'pm2 restart wa-$SLUG' falhou — reinicia o app manualmente."
fi
echo "Feito."
