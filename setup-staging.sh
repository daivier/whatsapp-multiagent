#!/bin/bash
# Cria (ou recria) um tenant de staging para validar features novas antes
# de aplicar aos tenants de produção. Isolado em porta, BD e sessão WA
# próprias — zero risco para os 4 clientes em prod.
#
# Uso:   ./setup-staging.sh
# Reset: ./setup-staging.sh --reset   (apaga e recria do zero)
#
# Pressupõe que já tens: git, node, npm, pm2, nginx (com sudo), openssl.
# Para PWA push funcionar: gera VAPID automaticamente.
# Para transcrição funcionar: detecta whisper-cli no PATH (se ausente, ignora).

set -e

# ── Config (ajusta se precisares) ─────────────────────────────────────────────
SLUG="staging"
PORT=3099
NAME="STAGING ⚠"
EMAIL="staging@test.local"
PASSWORD="staging123"
SERVER_IP="104.197.219.5"            # mesmo que new-tenant.sh
REPO="https://github.com/daivier/whatsapp-multiagent.git"
BRANCH="master"                       # ramo a clonar (tem todas as features novas)
WHISPER_MODEL_PATH="/opt/whisper.cpp/models/ggml-base.bin"

BASE_DIR="/home/daivier/whatsapp-tenants"
TENANT_DIR="$BASE_DIR/$SLUG"
DOMAIN="${SLUG}.${SERVER_IP}.nip.io"
PM2_NAME="wa-$SLUG"

# ── Reset opcional ────────────────────────────────────────────────────────────
if [ "$1" = "--reset" ]; then
  echo "=== RESET: a apagar staging existente ==="
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 save 2>/dev/null || true
  sudo rm -f "/etc/nginx/sites-enabled/$PM2_NAME" "/etc/nginx/sites-available/$PM2_NAME"
  sudo nginx -t && sudo systemctl reload nginx 2>/dev/null || true
  rm -rf "$TENANT_DIR"
  echo "  Removido. A recriar..."
  echo ""
fi

if [ -d "$TENANT_DIR" ]; then
  echo "ERRO: staging já existe em $TENANT_DIR"
  echo "Para recriar do zero: $0 --reset"
  exit 1
fi

JWT_SECRET=$(openssl rand -hex 32)

# ── VAPID auto-gen (necessário para PWA push notifications) ───────────────────
echo "=== A gerar VAPID keys para Web Push ==="
mkdir -p "$BASE_DIR"
cd "$BASE_DIR"
# web-push CLI vem com o pacote npm; vamos invocá-lo via npx num scratch dir
VAPID_OUTPUT=$(npx -y -p web-push web-push generate-vapid-keys --json 2>/dev/null || echo "{}")
VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | grep -oP '"publicKey":"\K[^"]+' || echo "")
VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | grep -oP '"privateKey":"\K[^"]+' || echo "")
if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ]; then
  echo "  AVISO: falha ao gerar VAPID — PWA push ficará inactivo (botão escondido)."
  echo "  Podes gerar manualmente depois: cd $TENANT_DIR/backend && npx web-push generate-vapid-keys"
else
  echo "  VAPID gerado ✓"
fi

# ── Whisper detection ────────────────────────────────────────────────────────
WHISPER_LINE=""
if command -v whisper-cli >/dev/null 2>&1 && [ -f "$WHISPER_MODEL_PATH" ]; then
  WHISPER_LINE="WHISPER_MODEL=$WHISPER_MODEL_PATH"
  echo "=== whisper-cli detectado — transcrição ficará activa ==="
else
  echo "=== whisper-cli não instalado — transcrição inactiva (ver INSTRUCOES.md secção 'Transcrição automática') ==="
fi

echo ""
echo "=== Criar staging ==="
echo "  Slug:     $SLUG"
echo "  Porta:    $PORT"
echo "  Domínio:  http://$DOMAIN"
echo "  Branch:   $BRANCH"
echo "  Email:    $EMAIL"
echo "  Senha:    $PASSWORD"
echo ""

# ── 1. Clonar repositório ────────────────────────────────────────────────────
echo "[1/6] A clonar repositório (branch $BRANCH)..."
git clone --branch "$BRANCH" "$REPO" "$TENANT_DIR"

# ── 2. Configurar backend ────────────────────────────────────────────────────
echo "[2/6] A configurar backend..."
cat > "$TENANT_DIR/backend/.env" <<EOF
PORT=$PORT
JWT_SECRET=$JWT_SECRET

OWNER_NAME=Dono Staging
OWNER_EMAIL=$EMAIL
OWNER_PASSWORD=$PASSWORD

FRONTEND_URL=http://$DOMAIN
WA_SESSION_PATH=$TENANT_DIR/whatsapp-session

# VAPID keys para Web Push (gerados acima)
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
VAPID_CONTACT=mailto:$EMAIL

# Whisper (se instalado)
$WHISPER_LINE
EOF

cd "$TENANT_DIR/backend"
npm install --silent --production

# ── 3. Configurar e compilar frontend ────────────────────────────────────────
echo "[3/6] A compilar frontend..."
cat > "$TENANT_DIR/frontend/.env" <<EOF
VITE_API_URL=http://$DOMAIN
VITE_TENANT_NAME=$NAME
EOF

cd "$TENANT_DIR/frontend"
npm install --silent
npm run build

# ── 4. PM2 ───────────────────────────────────────────────────────────────────
echo "[4/6] A registar no PM2..."
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start "$TENANT_DIR/backend/src/app.js" \
  --name "$PM2_NAME" \
  --cwd "$TENANT_DIR" \
  --wait-ready \
  --listen-timeout 15000 \
  --kill-timeout 8000
pm2 save

# ── 5. Nginx vhost ───────────────────────────────────────────────────────────
echo "[5/6] A criar config nginx..."
NGINX_CONF="/etc/nginx/sites-available/$PM2_NAME"
sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /socket.io/ {
        proxy_pass http://localhost:$PORT/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location ~ ^/(auth|users|conversations|messages|whatsapp|departments|push|health|quick-replies|tags|settings|scheduled-messages|contacts|search|keyword-rules|blacklist|broadcast|uploads) {
        proxy_pass http://localhost:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        client_max_body_size 32M;
    }

    location / {
        root $TENANT_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

sudo ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$PM2_NAME"
sudo nginx -t && sudo systemctl reload nginx

# ── 6. Verificação ───────────────────────────────────────────────────────────
echo "[6/6] A verificar saúde do tenant..."
sleep 3
HEALTH=$(curl -s "http://localhost:$PORT/health" || echo '{"ok":false}')
echo "  /health: $HEALTH"

echo ""
echo "============================================================"
echo "  ✓ STAGING PRONTO"
echo "============================================================"
echo "  URL:        http://$DOMAIN"
echo "  Login:      $EMAIL / $PASSWORD"
echo "  PM2:        $PM2_NAME  (porta $PORT)"
echo "  Logs:       pm2 logs $PM2_NAME"
echo "  Reset:      $0 --reset"
echo ""
echo "  Próximos passos:"
echo "    1. Abre http://$DOMAIN e faz login"
echo "    2. Vai a WhatsApp → escaneia QR com um número de teste"
echo "       (NÃO uses os números dos teus tenants reais!)"
echo "    3. Vai a Departamentos → cria 'Vendas' e 'Suporte'"
echo "    4. Vai a Automação → cria regra com keyword + dept + tag"
echo "    5. Manda mensagem de teste do telemóvel → vê routing, badges,"
echo "       transcrição de áudio (se whisper activo), push (botão 🔕)"
echo ""
echo "  Quando estiver tudo OK, aplica aos prod tenants:"
echo "    ./update-tenant.sh <slug>   (para cada um)"
echo ""
