#!/bin/bash
# Roda JWT_SECRET + OWNER_PASSWORD de TODOS os tenants:
#   - 4 tenants do layout shared (ecosystem.config.js): supermercados,
#     sucataodejeova, diaristou, sac-supermercados.
#   - 1 tenant do layout per-tenant: /home/daivier/whatsapp-tenants/supermercados
#     (PM2: wa-supermercados).
#
# Acções:
#   1. Gera JWT_SECRET (64 hex) e OWNER_PASSWORD (12 base64 sem chars
#      especiais) por tenant.
#   2. Escreve novos valores em /home/daivier/whatsapp-multiagent/secrets.local.js
#      (gitignored). Backup do anterior.
#   3. Actualiza .env do per-tenant supermercados.
#   4. UPDATE password_hash em cada BD (bcrypt do novo password) para o owner.
#   5. pm2 reload ecosystem.config.js (pega novo JWT_SECRET) + restart
#      wa-supermercados (--update-env).
#   6. Imprime tabela com (slug, nova password) NO FINAL — guarda já.
#
# **EFEITO COLATERAL CRÍTICO**: TODOS os JWT actuais ficam inválidos.
# Atendentes ligados vão levar logout. Correr fora de horário de pico.
#
# Uso (na VM):
#   bash /home/daivier/whatsapp-multiagent/deploy/rotate-secrets.sh

set -e

BASE=/home/daivier/whatsapp-multiagent
SECRETS_FILE=$BASE/secrets.local.js
PER_TENANT_SUPER=/home/daivier/whatsapp-tenants/supermercados

declare -A SHARED_DB=(
  ["supermercados"]="/home/daivier/clientes/supermercados/database.sqlite"
  ["sucataodejeova"]="/home/daivier/clientes/sucataodejeova/database.sqlite"
  ["diaristou"]="/home/daivier/clientes/diaristou/database.sqlite"
  ["sac-supermercados"]="/home/daivier/clientes/sac-supermercados/database.sqlite"
)

declare -A NEW_PWD

gen_secret() { openssl rand -hex 32; }
gen_password() { openssl rand -base64 16 | tr -d '/+=' | head -c 14; }

bcrypt_hash() {
  local pwd="$1"
  local node_modules="$2"
  node -e "console.log(require('${node_modules}/bcryptjs').hashSync(process.argv[1], 10))" "$pwd"
}

# ─── Backup do secrets.local.js anterior, se existir ─────────────────────────
if [ -f "$SECRETS_FILE" ]; then
  cp "$SECRETS_FILE" "$SECRETS_FILE.backup-$(date +%Y%m%d-%H%M%S)"
fi

# ─── Gerar novo secrets.local.js (shared tenants) ────────────────────────────
{
  echo "// Gerado por rotate-secrets.sh em $(date -Iseconds)"
  echo "// NÃO commitar este ficheiro (está no .gitignore)."
  echo "module.exports = {"
} > "$SECRETS_FILE"

for slug in "${!SHARED_DB[@]}"; do
  JWT=$(gen_secret)
  PWD=$(gen_password)
  NEW_PWD[$slug]=$PWD
  echo "  '$slug': { JWT_SECRET: '$JWT', OWNER_PASSWORD: '$PWD' }," >> "$SECRETS_FILE"

  DB=${SHARED_DB[$slug]}
  if [ -f "$DB" ]; then
    HASH=$(bcrypt_hash "$PWD" "$BASE/backend/node_modules")
    sqlite3 "$DB" "UPDATE users SET password_hash = '$HASH' WHERE role = 'owner'"
    echo "[ok] $slug: hash do owner actualizado na BD"
  else
    echo "[skip] $slug: BD $DB não existe"
  fi
done

echo "};" >> "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
echo "[ok] $SECRETS_FILE criado (chmod 600)"

# ─── Per-tenant supermercados (.env + BD) ────────────────────────────────────
if [ -d "$PER_TENANT_SUPER" ]; then
  PER_JWT=$(gen_secret)
  PER_PWD=$(gen_password)
  NEW_PWD["wa-supermercados (per-tenant)"]=$PER_PWD

  ENV_FILE="$PER_TENANT_SUPER/backend/.env"
  if [ -f "$ENV_FILE" ]; then
    # Substitui ou adiciona JWT_SECRET e OWNER_PASSWORD
    if grep -q '^JWT_SECRET=' "$ENV_FILE"; then
      sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$PER_JWT|" "$ENV_FILE"
    else
      echo "JWT_SECRET=$PER_JWT" >> "$ENV_FILE"
    fi
    if grep -q '^OWNER_PASSWORD=' "$ENV_FILE"; then
      sed -i "s|^OWNER_PASSWORD=.*|OWNER_PASSWORD=$PER_PWD|" "$ENV_FILE"
    else
      echo "OWNER_PASSWORD=$PER_PWD" >> "$ENV_FILE"
    fi
    echo "[ok] $ENV_FILE actualizado"
  fi

  PER_DB="$PER_TENANT_SUPER/database.sqlite"
  if [ -f "$PER_DB" ]; then
    HASH=$(bcrypt_hash "$PER_PWD" "$PER_TENANT_SUPER/backend/node_modules")
    sqlite3 "$PER_DB" "UPDATE users SET password_hash = '$HASH' WHERE role = 'owner'"
    echo "[ok] wa-supermercados (per-tenant): hash actualizado na BD"
  fi
fi

# ─── Restart ─────────────────────────────────────────────────────────────────
echo ""
echo "=== A recarregar ecosystem (shared tenants) ==="
pm2 reload "$BASE/ecosystem.config.js" --update-env 2>&1 | tail -10

if pm2 list --no-color 2>/dev/null | grep -q wa-supermercados; then
  echo ""
  echo "=== A reiniciar wa-supermercados (per-tenant) ==="
  pm2 restart wa-supermercados --update-env 2>&1 | tail -3
fi

# ─── Resumo final ────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "NOVAS PASSWORDS DO OWNER — guarda já (não voltam a aparecer):"
echo "================================================================"
printf "%-32s %s\n" "TENANT" "NOVA PASSWORD"
printf "%-32s %s\n" "------" "-------------"
for k in "${!NEW_PWD[@]}"; do
  printf "%-32s %s\n" "$k" "${NEW_PWD[$k]}"
done
echo ""
echo "Email do owner em todos: dono@loja.com (não mudou)"
echo "JWTs antigos foram invalidados — utilizadores vão fazer login outra vez."
echo ""
echo "secrets.local.js: $SECRETS_FILE"
echo "(faz backup off-server se for crítico)"
