#!/bin/bash
# Cria um novo tenant do WhatsApp Multi-Atendente
#
# Uso: ./new-tenant.sh <slug> <porta> <nome> <email-dono> <senha-dono>
#
# Exemplo:
#   ./new-tenant.sh loja-abc 3011 "Loja ABC" dono@loja-abc.com senha123
#
# Requisitos: git, node, npm, pm2, nginx (com sudo)

set -e

SLUG="$1"
PORT="$2"
NAME="$3"
EMAIL="$4"
PASSWORD="$5"

SERVER_IP="104.197.219.5"
REPO="https://github.com/daivier/whatsapp-multiagent.git"
BASE_DIR="/home/daivier/whatsapp-tenants"
TENANT_DIR="$BASE_DIR/$SLUG"
DOMAIN="${SLUG}.${SERVER_IP}.nip.io"

# --- Validação ---
if [ -z "$SLUG" ] || [ -z "$PORT" ] || [ -z "$NAME" ] || [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Uso: $0 <slug> <porta> <nome> <email-dono> <senha-dono>"
  echo "Exemplo: $0 loja-abc 3011 \"Loja ABC\" dono@loja-abc.com senha123"
  exit 1
fi

if [ -d "$TENANT_DIR" ]; then
  echo "ERRO: Tenant '$SLUG' já existe em $TENANT_DIR"
  exit 1
fi

JWT_SECRET=$(openssl rand -hex 32)

echo ""
echo "=== Criar tenant: $NAME ==="
echo "  Slug:    $SLUG"
echo "  Porta:   $PORT"
echo "  Domínio: http://$DOMAIN"
echo "  Email:   $EMAIL"
echo ""

# --- 1. Clonar repositório ---
echo "[1/6] A clonar repositório..."
mkdir -p "$BASE_DIR"
git clone "$REPO" "$TENANT_DIR"

# --- 2. Configurar backend ---
echo "[2/6] A configurar backend..."
cat > "$TENANT_DIR/backend/.env" <<EOF
PORT=$PORT
JWT_SECRET=$JWT_SECRET

OWNER_NAME=Dono
OWNER_EMAIL=$EMAIL
OWNER_PASSWORD=$PASSWORD

FRONTEND_URL=http://$DOMAIN
WA_SESSION_PATH=$TENANT_DIR/whatsapp-session
EOF

cd "$TENANT_DIR/backend"
npm install --silent

# --- 3. Configurar e compilar frontend ---
echo "[3/6] A compilar frontend..."
cat > "$TENANT_DIR/frontend/.env" <<EOF
VITE_API_URL=http://$DOMAIN
VITE_TENANT_NAME=$NAME
EOF

cd "$TENANT_DIR/frontend"
npm install --silent
npm run build

# --- 4. Registar no PM2 ---
echo "[4/6] A registar no PM2..."
# IMPORTANTE: cwd tem de ser $TENANT_DIR/backend para o dotenv encontrar o .env
pm2 start "$TENANT_DIR/backend/src/app.js" \
  --name "wa-$SLUG" \
  --cwd "$TENANT_DIR/backend" \
  --
pm2 save

# --- 5. Criar config nginx ---
echo "[5/6] A criar config nginx..."
NGINX_CONF="/etc/nginx/sites-available/wa-$SLUG"

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

    location ~ ^/(auth|users|conversations|messages|whatsapp|departments|push|lines|health|quick-replies|tags|settings|scheduled-messages|contacts|search|keyword-rules|blacklist|broadcast|uploads) {
        proxy_pass http://localhost:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location / {
        root $TENANT_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

sudo ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/wa-$SLUG"
sudo nginx -t && sudo systemctl reload nginx

# --- 6. Concluído ---
echo ""
echo "[6/6] Tenant criado com sucesso!"
echo ""
echo "========================================"
echo "  URL:    http://$DOMAIN"
echo "  Email:  $EMAIL"
echo "  Senha:  $PASSWORD"
echo "  PM2:    wa-$SLUG (porta $PORT)"
echo "========================================"
echo ""
echo "Próximo passo: acede ao URL e vai a WhatsApp para escanear o QR Code."
echo ""
