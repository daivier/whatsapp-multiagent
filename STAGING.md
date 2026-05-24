# Staging — validação antes de produção

Ambiente isolado para testar features novas sem risco para os 4 tenants em produção. Mesma VM, porta/BD/sessão WA separadas.

## Setup inicial (1ª vez)

Na VM, como `daivier`:

```bash
cd /home/daivier
# Se ainda não tens o repo clonado em sítio nenhum:
git clone https://github.com/daivier/whatsapp-multiagent.git tmp-clone
cp tmp-clone/setup-staging.sh .
rm -rf tmp-clone

# Caso contrário, basta puxar o script do branch master:
# scp ou wget do raw do GitHub:
# wget https://raw.githubusercontent.com/daivier/whatsapp-multiagent/master/setup-staging.sh

chmod +x setup-staging.sh
./setup-staging.sh
```

O script:
1. Gera VAPID keys automaticamente
2. Detecta whisper-cli (se instalado) e configura transcrição
3. Clona repo em `/home/daivier/whatsapp-tenants/staging/`
4. `npm install` + build do frontend
5. Regista no PM2 como `wa-staging` na porta 3099
6. Cria nginx vhost para `staging.<IP>.nip.io`
7. Faz GET /health no fim para confirmar

URL acessível em: `http://staging.104.197.219.5.nip.io`
Login: `staging@test.local` / `staging123`

## Actualizar staging (puxar últimas mudanças)

```bash
cd /home/daivier/whatsapp-tenants/staging
git pull
cd frontend && npm install --silent && npm run build && cd ..
pm2 restart wa-staging
```

## Reset (apagar e recriar do zero)

```bash
./setup-staging.sh --reset
```

Útil quando queres simular um tenant novo (BD limpa, sem sessão WA) e re-validar tudo do zero.

## Checklist de validação (corre todos antes de aplicar a produção)

### 1. Healthcheck
```bash
curl http://localhost:3099/health
```
Deve devolver JSON com `ok: true`, `db: 'ok'`, `push: 'configured'` (whisper só se instalaste).

### 2. Conexão WhatsApp
- Abre o URL, login → WhatsApp → escaneia QR com **um número de teste** (não os de produção)
- Depois de "ready", manda mensagem de outro telemóvel para esse número
- Verifica que aparece na lista

### 3. Departamentos
- Vai a 🏢 Departamentos → criar "Vendas" (padrão) e "Suporte"
- Em cada um, Membros → marcar atendentes (tens um só, mas ok)
- Verifica que aparece no Dashboard secção "Por departamento"

### 4. Auto-tag + routing por keyword
- 🏷️ Etiquetas → criar "VIP"
- 🤖 Automação → criar regra: keyword="vip", dept=Vendas, etiqueta=VIP, prioridade=10
- Manda mensagem com "sou vip" → confirma:
  - Conversa aparece no dept Vendas
  - Badge "VIP" aparece no chat
  - Ponto azul (cor de Vendas) aparece na lista

### 5. SLA por dept
- Editar dept Vendas → SLA = 1 minuto
- Manda mensagem nova, **não respondas**
- Espera ~90 segundos
- Confirma: notificação `sla:alert`, badge vermelho "⏰ SLA" na lista, no Dashboard contagem em "Por departamento"

### 6. Transcrição (se whisper instalado)
- Manda áudio do telemóvel
- Espera 5-15s → aparece transcrição em itálico abaixo do player

### 7. Templates dinâmicos
- ⚡ Respostas Rápidas → criar `/ola` com `{{saudacao}}, {{primeiro_nome}}! Aqui é {{atendente}}.`
- No chat, digita `/ola` → confirma que substituiu

### 8. Notas internas + @menção
- Cria 2º atendente (ou usa o mesmo)
- No chat, toggle 🔒 Nota → escreve `@<nome> testa isto` → manda
- Confirma: nota aparece com fundo amarelo, @nome destacado

### 9. PWA + Push (mobile)
- Abre o URL no Chrome do telemóvel
- Menu → "Adicionar ao ecrã principal"
- Abre a app standalone → carrega no botão **🔕 Activar** → permitir
- Botão fica **🔔 Notif.**
- Fecha a app
- De outro telemóvel, manda mensagem para o número de teste
- Confirma: notificação push aparece no telemóvel mesmo com app fechada
- Clica → app abre

### 10. Histórico 360
- Abre conversa existente → 📊 no header
- Confirma painel com stats, ratings, conversas anteriores

## Quando todos os 10 passarem

Aplicar aos prod tenants, **um de cada vez** começando pelo de menor volume:

```bash
./update-tenant.sh diaristou
# espera 10 min, observa pm2 logs wa-diaristou, confirma que /health responde
./update-tenant.sh sucataodejeova
# repete para os outros
```

## Rollback se algo partir em prod

```bash
cd /home/daivier/whatsapp-tenants/<slug>
git log --oneline -5                  # ver commits recentes
git reset --hard e1bc98f              # voltar ao commit antes desta sessão
cd frontend && npm run build && cd ..
pm2 restart wa-<slug>
```

As migrations são aditivas (ALTER TABLE ADD COLUMN), as colunas extra ficam mas
não estorvam. Não há perda de dados.
