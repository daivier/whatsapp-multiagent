---
name: project-known-issues
description: "Bugs conhecidos em produção (tenant supermercados). #1 reopen e #2 delete RESOLVIDOS (verificado 2026-05-30). Resta #3 sessão Baileys instável (ambiental)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b9c836d-33b3-438e-ad64-81c0506e81e8
---

Detetados durante incidente do spam de assinatura (2026-05-28). **Não** foram causados pelos PRs desse dia — são pré-existentes. Tudo no tenant `supermercados`.

**Why:** Em logs do `wa-supermercados`, estes 3 erros aparecem consistentemente. Vale ter no radar caso voltem a causar problemas.

**How to apply:** Se um deles começar a causar instabilidade ou queixa de cliente, atacar separadamente — não tentar incluir num PR que tenha outro foco.

1. ✅ **RESOLVIDO (verificado 2026-05-30).** `PATCH /conversations/:id/reopen` já tem pré-verificação de conversa aberta existente (→409 com `existing_id`) E try/catch a apanhar `SQLITE_CONSTRAINT_UNIQUE` (→409). Ver [conversations.js:574-592](backend/src/routes/conversations.js#L574). Já não dá 500.

2. ✅ **RESOLVIDO (verificado 2026-05-30).** `DELETE /conversations/:id` ([conversations.js:838](backend/src/routes/conversations.js#L838)) apaga à mão as filhas SEM cascade (`messages`, `scheduled_messages`) antes da conversa; as restantes (`ratings`, `transfer_logs`, `conversation_tags`, `conversation_mutes`) têm `ON DELETE CASCADE` — confirmado via `PRAGMA foreign_key_list` nas BDs reais de supermercados (clone) E diaadia (antiga). Já não dá 500.

3. **Sessão Baileys instável — `Closing open session in favor of incoming prekey bundle`** dezenas de vezes por hora em wa-supermercados. Indica colisão de sessão WhatsApp: o número está conectado em vários dispositivos a competir, ou foi re-pareado externamente. Antes de [[retry-pending-loop]] estar corrigido, isto causava spam de mensagens (cada reconnect → re-envio do pendingQueue). Agora só gera ruído de logs, mas é a causa raíz de mensagens entregues fora de ordem ou perdidas. Solução: cliente tem de garantir que só o servidor Baileys tem a sessão activa.

4. **`wa-supermercados` com ~55 restarts em 4h** no PM2 antes do fix do loop. Pode ter sido o loop a esgotar memória/causar throw não apanhado. Monitorar contador `↺` após o fix `cbf086d` — se continuar a subir rapidamente, há outra causa de crash (provavelmente better-sqlite3@12 + sessão instável, ou um dos erros acima escalou).

Backup BD pré-cleanup: `/home/daivier/whatsapp-tenants/supermercados/database-backup-20260528-121033.sqlite` (3.4 MB).
