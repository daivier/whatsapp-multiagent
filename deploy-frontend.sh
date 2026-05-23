#!/bin/bash
# Deploy frontend para todos os clientes com o URL correcto de cada um
# Uso: bash deploy-frontend.sh

BASE=/home/daivier/whatsapp-multiagent/frontend

declare -A CLIENTS
CLIENTS["supermercados"]="https://atendimento.supermercadosfortaleza.com.br"
CLIENTS["sucataodejeova"]="https://diaadia.code2scan.com"
CLIENTS["diaristou"]="https://atendimento.diaristou.com.br"
CLIENTS["sac-supermercados"]="https://atendimentosac.supermercadosfortaleza.com.br"

cd $BASE

for CLIENT in "${!CLIENTS[@]}"; do
  URL="${CLIENTS[$CLIENT]}"
  echo "[deploy] A compilar para $CLIENT ($URL)..."
  VITE_API_URL=$URL npm run build > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    cp -r dist/* /home/daivier/clientes/$CLIENT/dist/
    echo "[deploy] $CLIENT ok"
  else
    echo "[deploy] ERRO ao compilar $CLIENT"
  fi
done

echo "[deploy] Concluido!"
