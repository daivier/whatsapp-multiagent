# WhatsApp Multi-Atendente — Instruções de Instalação

## Pré-requisitos
- Node.js 18+
- Google Chrome instalado (usado pelo whatsapp-web.js)

---

## 1. Instalar Backend

```bash
cd backend
cp .env.example .env
# Edita o .env com os teus dados
npm install
npm run dev
```

Na primeira execução, a conta do dono é criada automaticamente com as credenciais do `.env`.

---

## 2. Instalar Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Abre http://localhost:5173 no browser.

---

## 3. Ligar o WhatsApp

1. Faz login com a conta do **Dono**
2. Vai ao separador **WhatsApp**
3. Aparece um QR Code — escaneia com o telemóvel do número da loja
4. Fica ligado até reiniciar o servidor (a sessão é guardada automaticamente)

---

## 4. Criar atendentes

1. Faz login como Dono
2. Vai a **Atendentes** → preenche nome, email e password → **Adicionar**
3. O atendente faz login em http://localhost:5173 com as credenciais criadas

---

## Funcionalidades

| Funcionalidade | Atendente | Dono |
|---|---|---|
| Ver as suas conversas | ✅ | ✅ (todas) |
| Responder mensagens | ✅ | ✅ |
| Fechar conversa | ✅ | ✅ |
| Transferir conversa | ❌ | ✅ |
| Gerir atendentes | ❌ | ✅ |
| Ver métricas | ❌ | ✅ |
| Ligar WhatsApp (QR) | ❌ | ✅ |
| Alterar estado (online/ocupado/ausente) | ✅ | — |

---

## Distribuição automática

Quando chega uma mensagem nova de um cliente sem conversa aberta, o sistema atribui automaticamente ao atendente **online** com menos conversas abertas (round-robin por carga). Se nenhum estiver disponível, fica em fila de espera (**Aguarda**).

---

## Transcrição automática de áudios (opcional)

Mensagens de áudio recebidas podem ser transcritas para texto automaticamente
usando [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — corre localmente
na VM, sem custo recorrente nem chamadas a APIs externas.

### Instalar na VM (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y build-essential git ffmpeg

# Compilar whisper.cpp
sudo git clone https://github.com/ggerganov/whisper.cpp /opt/whisper.cpp
cd /opt/whisper.cpp
sudo make -j

# Descarregar modelo (base = ~150 MB, bom equilíbrio velocidade/qualidade)
sudo bash ./models/download-ggml-model.sh base

# Disponibilizar o binário no PATH
sudo ln -sf /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
```

### Configurar no backend

Adicionar ao `.env` (ou ao `env:` do `ecosystem.config.js` por tenant):

```bash
WHISPER_MODEL=/opt/whisper.cpp/models/ggml-base.bin
# opcional — defaults indicados:
# WHISPER_BIN=whisper-cli
# WHISPER_LANG=pt
# TRANSCRIBE_ENABLED=1
```

Reiniciar o backend (`pm2 restart wa-<tenant>`). Verifica no log:

```
[transcribe] activo — bin=whisper-cli, model=/opt/whisper.cpp/models/ggml-base.bin, lang=pt
```

Se aparecer `[transcribe] inactivo — ...` significa que algo não foi encontrado
(binário, modelo ou ffmpeg). Áudios continuam a funcionar normalmente, apenas
não são transcritos.

### Modelos alternativos

| Modelo | Tamanho | Velocidade | Qualidade |
|---|---|---|---|
| `tiny`  | 75 MB | mais rápido | ok |
| `base`  | 150 MB | rápido | bom *(recomendado)* |
| `small` | 500 MB | médio | melhor |

Para mudar: descarregar (`download-ggml-model.sh small`) e actualizar `WHISPER_MODEL`.

---

## Estrutura de ficheiros

```
whatsapp-multiagent/
  backend/
    src/
      db/schema.js          ← Base de dados SQLite
      whatsapp/client.js    ← Ligação WhatsApp
      socket/handlers.js    ← Tempo real (Socket.io)
      routes/
        auth.js             ← Login / sessão
        users.js            ← Gestão de atendentes
        conversations.js    ← Conversas
        messages.js         ← Envio de mensagens
      middleware/auth.js    ← JWT
      app.js                ← Servidor principal
  frontend/
    src/
      pages/Login.jsx
      pages/AttendantPanel.jsx
      pages/AdminPanel.jsx
      components/ConversationList.jsx
      components/ChatWindow.jsx
      context/AuthContext.jsx
      api.js
```
