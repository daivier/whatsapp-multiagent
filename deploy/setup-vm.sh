#!/bin/bash
# Executar na VM: bash setup-vm.sh
set -e

echo "=== Instalando dependências ==="
sudo apt-get update -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (gestor de processos)
sudo npm install -g pm2

# Google Chrome (necessário para whatsapp-web.js)
echo "=== Instalando Chrome ==="
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update -y
sudo apt-get install -y google-chrome-stable

echo "=== Clonando repositório ==="
cd /home/$USER
git clone https://github.com/daivier/whatsapp-multiagent.git || (cd whatsapp-multiagent && git pull)
cd whatsapp-multiagent

echo "=== Configurando Backend ==="
cd backend
cp .env.example .env
echo ""
echo "IMPORTANTE: Edita o ficheiro backend/.env antes de continuar!"
echo "  nano /home/$USER/whatsapp-multiagent/backend/.env"
echo ""
npm install --production

echo "=== Configurando Frontend ==="
cd ../frontend
cp .env.example .env
# Aponta para o mesmo servidor (nginx vai fazer proxy)
echo "VITE_API_URL=https://$(hostname -I | awk '{print $1}')" > .env
npm install
npm run build

echo "=== Configurando PM2 ==="
cd ..
pm2 start backend/src/app.js --name whatsapp-backend
pm2 save
pm2 startup | tail -1 | sudo bash

echo "=== Configurando Nginx ==="
sudo bash -c 'cat > /etc/nginx/sites-available/whatsapp << EOF
server {
    listen 80;
    server_name _;

    # Frontend (ficheiros estáticos)
    location / {
        root /home/'$USER'/whatsapp-multiagent/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # Socket.io
    location /socket.io/ {
        proxy_pass http://localhost:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF'

sudo ln -sf /etc/nginx/sites-available/whatsapp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== INSTALAÇÃO COMPLETA ==="
echo "Acede em: http://$(curl -s ifconfig.me)"
echo ""
echo "Próximos passos:"
echo "  1. Edita o .env:  nano /home/$USER/whatsapp-multiagent/backend/.env"
echo "  2. Reinicia:      pm2 restart whatsapp-backend"
echo "  3. Abre o browser e faz login com o dono"
echo "  4. Vai a WhatsApp → escaneia o QR Code"
