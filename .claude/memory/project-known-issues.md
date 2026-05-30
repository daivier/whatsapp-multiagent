---
name: project-known-issues
description: "Bugs conhecidos em produção (tenant supermercados) que apareceram em logs durante incidentes — não causados por trabalho recente, ainda por resolver."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b9c836d-33b3-438e-ad64-81c0506e81e8
---

Detetados durante incidente do spam de assinatura (2026-05-28). **Não** foram causados pelos PRs desse dia — são pré-existentes. Tudo no tenant `supermercados`.

**Why:** Em logs do `wa-supermercados`, estes 3 erros aparecem consistentemente. Vale ter no radar caso voltem a causar problemas.

**How to apply:** Se um deles começar a causar instabilidade ou queixa de cliente, atacar separadamente — não tentar incluir num PR que tenha outro foco.

1. **`PATCH /conversations/:id/reopen` rebenta com UNIQUE constraint** quando já há outra conversa não-fechada para o mesmo `(contact_id, line_id)`. O `client.js` no inbound já tem try/catch para isso, mas a rota `/reopen` não. Vira 500 para o utilizador. Fix simples: envolver o UPDATE em try/catch e devolver 409 com o id da conversa existente.

2. **`DELETE /conversations/:id` rebenta com FOREIGN KEY constraint failed** em [conversations.js:701](backend/src/routes/conversations.js#L701). Alguma child table referencia conversations sem `ON DELETE CASCADE`. Candidatos: `ratings`, `transfer_logs`. Verificar `PRAGMA foreign_key_list(table)` para todas e adicionar CASCADE onde falta (via migration ALTER ou recriar tabela).

3. **Sessão Baileys instável — `Closing open session in favor of incoming prekey bundle`** dezenas de vezes por hora em wa-supermercados. Indica colisão de sessão WhatsApp: o número está conectado em vários dispositivos a competir, ou foi re-pareado externamente. Antes de [[retry-pending-loop]] estar corrigido, isto causava spam de mensagens (cada reconnect → re-envio do pendingQueue). Agora só gera ruído de logs, mas é a causa raíz de mensagens entregues fora de ordem ou perdidas. Solução: cliente tem de garantir que só o servidor Baileys tem a sessão activa.

4. **`wa-supermercados` com ~55 restarts em 4h** no PM2 antes do fix do loop. Pode ter sido o loop a esgotar memória/causar throw não apanhado. Monitorar contador `↺` após o fix `cbf086d` — se continuar a subir rapidamente, há outra causa de crash (provavelmente better-sqlite3@12 + sessão instável, ou um dos erros acima escalou).

Backup BD pré-cleanup: `/home/daivier/whatsapp-tenants/supermercados/database-backup-20260528-121033.sqlite` (3.4 MB).
