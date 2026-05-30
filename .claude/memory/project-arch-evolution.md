---
name: project-arch-evolution
description: "Funcionalidades adicionadas ao projeto depois do CLAUDE.md ser escrito — multi-linha por tenant, departamentos, role supervisor, chat interno, push, transcrição, bot por linha."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b9c836d-33b3-438e-ad64-81c0506e81e8
---

CLAUDE.md descreve "uma instância Baileys por tenant". A realidade actual é **uma instância Baileys por LINHA**, e um tenant pode ter várias linhas. O CLAUDE.md está desatualizado.

**Why:** Várias mudanças grandes entraram depois do CLAUDE.md ser escrito. Sem este contexto, suposições com base só no CLAUDE.md serão erradas.

**How to apply:** Antes de mexer em routing, schema, ou whatsapp client, lembrar que:

- **Multi-linha por tenant** — tabela `lines` (id, name, color, session_path, is_default, department_id). `backend/src/whatsapp/client.js` mantém um `Map<lineId, state>` (sock, isReady, qr, lidToJidMap, waContactsCache, pendingQueue). Cada função pública aceita `lineId` como primeiro argumento; se omitido cai na default line via `getDefaultLineId()`. `conversations.line_id` e `scheduled_messages.line_id` foram adicionados. Conversas do mesmo contacto em linhas diferentes são INDEPENDENTES.

- **Departamentos** — tabelas `departments`, `user_departments`, `conversations.department_id`, `keyword_rules.department_id`, `keyword_rules.tag_id`, `tags.department_id`, `lines.department_id`. Roteamento em [backend/src/whatsapp/routing.js](backend/src/whatsapp/routing.js): `computeTargetDepartment` decide departamento (linha > keyword > default); `pickLeastBusyAttendant(deptId)` escolhe atendente. Modo legacy (sem departamentos) ainda funciona — passar `null`. Atendentes devem ter `on_shift=1` para receber.

- **Role `supervisor`** — terceiro role além de owner/attendant. `App.jsx` faz `if role === 'supervisor' return <SupervisorLayout />` (4 tabs). Owner-only checks (`ownerOnly` middleware) continuam restritos ao owner.

- **Chat interno** — tabelas `internal_threads`, `internal_thread_members`, `internal_messages`, `internal_reactions`. Seed do canal "Geral" com todos os utilizadores activos no startup. Rota `/internal-chat`. Socket event `internal:typing`. Tabs "Chat Interno" em AdminPanel/AttendantPanel/SupervisorLayout. Componentes em `frontend/src/components/InternalChat/`.

- **Push notifications (WebPush)** — tabela `push_subscriptions`, módulo [backend/src/push.js](backend/src/push.js), rota `/push`. Enviado em `push.sendToUser` no `handleIncomingMessage`. Configurado via env (VAPID keys). Frontend: `hooks/usePushSubscription.js` + `components/PushNotificationsButton.jsx`.

- **Transcrição de áudio** — [backend/src/whatsapp/transcribe.js](backend/src/whatsapp/transcribe.js) é chamado quando chega áudio inbound. Configurado por env (OpenAI Whisper ou similar). Update a `messages.body` quando termina.

- **Bot de triagem agora POR LINHA** — tabela `line_bot_settings` (line_id PK, enabled, message, hours_0..6). Substitui os settings globais `bot_enabled`/`bot_message`/`hours_*` (que ainda existem como fallback/legado). Migration auto-popula a linha 1 com os valores globais.

- **Quick replies pessoais** — coluna `quick_replies.owner_user_id` permite quick replies por atendente. Owner/supervisor veem todos.

- **Broadcast logs** — tabela `broadcast_logs` regista histórico de disparos em massa.

- **Ratings** — tabela `ratings`, sistema 1-5 via WhatsApp. Após fechar conversa, é enviada mensagem de avaliação (`rating_enabled` setting). `conversations.awaiting_rating` flag.

- **Reabertura inteligente** — se mensagem chega de contacto com conversa fechada dentro de `reopen_window_days` (default 1), reabre. Se o atendente anterior estiver online, mantém-no; caso contrário vai para 'waiting'.

- **LID merge corrige duplicatas WhatsApp Business** — números `@lid` vs `@s.whatsapp.net`. Lê ficheiros `lid-mapping-*_reverse.json` da sessão. **Qualquer code path que cria contactos deve chamar `runLidMerge(lineId)` depois**.

Linkado: [[project-bug-logout-handler]]
