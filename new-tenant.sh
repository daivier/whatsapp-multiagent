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
PLANO="${6:-empresarial}"   # basico | profissional | empresarial (default: empresarial)

SERVER_IP="104.197.219.5"
REPO="https://github.com/daivier/whatsapp-multiagent.git"
BASE_DIR="/home/daivier/whatsapp-tenants"
TENANT_DIR="$BASE_DIR/$SLUG"
# Subdomínio real sob atendize.com — resolvido pelo registo wildcard *.atendize.com no Cloudflare.
ZONE="atendize.com"
DOMAIN="${SLUG}.${ZONE}"
# Certificado wildcard (*.atendize.com) emitido uma vez via certbot dns-cloudflare.
CERT_DIR="/etc/letsencrypt/live/${ZONE}"

# --- Validação ---
if [ -z "$SLUG" ] || [ -z "$PORT" ] || [ -z "$NAME" ] || [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Uso: $0 <slug> <porta> <nome> <email-dono> <senha-dono> [plano]"
  echo "Exemplo: $0 loja-abc 3011 \"Loja ABC\" dono@loja-abc.com senha123 profissional"
  echo "plano (opcional): basico | profissional | empresarial (default: empresarial)"
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
echo "  Domínio: https://$DOMAIN"
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

FRONTEND_URL=https://$DOMAIN
WA_SESSION_PATH=$TENANT_DIR/whatsapp-session
PLAN=$PLANO
EOF

cd "$TENANT_DIR/backend"
npm install --silent

# --- 3. Configurar e compilar frontend ---
echo "[3/6] A compilar frontend..."
cat > "$TENANT_DIR/frontend/.env" <<EOF
VITE_API_URL=https://$DOMAIN
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

# --- 4.5 Conta de suporte oculta (se configurada na VM) ---
# Lê as credenciais de um ficheiro LOCAL da VM (fora do git), p.ex.:
#   SUPPORT_EMAIL=suporte@multiatendente.app
#   SUPPORT_PASSWORD=<senha>
#   SUPPORT_NAME=Suporte
# A conta é criada com role 'owner' e hidden=1 (invisível em todas as listas).
SUPPORT_CRED="/home/daivier/.wa-support-cred"
if [ -f "$SUPPORT_CRED" ]; then
  echo "[*] A criar conta de suporte oculta..."
  sleep 4   # esperar o backend arrancar e migrar a BD (cria a coluna hidden)
  set -a; . "$SUPPORT_CRED"; set +a
  TBASE="$TENANT_DIR/backend" TDB="$TENANT_DIR/database.sqlite" node -e '
    const base = process.env.TBASE;
    const bcrypt = require(base + "/node_modules/bcryptjs");
    const Database = require(base + "/node_modules/better-sqlite3");
    const db = new Database(process.env.TDB);
    const email = process.env.SUPPORT_EMAIL;
    const pw = process.env.SUPPORT_PASSWORD;
    const name = process.env.SUPPORT_NAME || "Suporte";
    const hash = bcrypt.hashSync(pw, 10);
    const ex = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (ex) db.prepare("UPDATE users SET password_hash=?, role=?, hidden=1, active=1, name=? WHERE id=?").run(hash, "owner", name, ex.id);
    else db.prepare("INSERT INTO users (name, email, password_hash, role, hidden, active) VALUES (?, ?, ?, ?, 1, 1)").run(name, email, hash, "owner");
    db.close();
    console.log("    conta de suporte pronta: " + email);
  ' || echo "    AVISO: nao foi possivel criar a conta de suporte (continuar)"
else
  echo "[*] (sem $SUPPORT_CRED na VM - conta de suporte nao criada)"
fi

# --- 5. Criar config nginx ---
echo "[5/6] A criar config nginx..."
NGINX_CONF="/etc/nginx/sites-available/wa-$SLUG"

sudo tee "$NGINX_CONF" > /dev/null <<EOF
# Redireciona HTTP -> HTTPS
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    # Certificado wildcard *.${ZONE} (partilhado por todos os tenants)
    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    client_max_body_size 50m;

    location /socket.io/ {
        proxy_pass http://localhost:$PORT/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }

    location ~ ^/(auth|users|conversations|messages|whatsapp|departments|push|lines|health|quick-replies|tags|settings|scheduled-messages|contacts|search|keyword-rules|blacklist|broadcast|uploads|internal-chat|faq|audit|metrics|plan) {
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
echo "  URL:    https://$DOMAIN"
echo "  Email:  $EMAIL"
echo "  Senha:  $PASSWORD"
echo "  PM2:    wa-$SLUG (porta $PORT)"
echo "  Plano:  $PLANO"
echo "========================================"
echo ""
echo "Próximo passo: acede ao URL e vai a WhatsApp para escanear o QR Code."
echo ""
