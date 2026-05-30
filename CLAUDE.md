# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Multi-tenant WhatsApp customer-service platform (Portuguese UI). One backend instance per tenant manages a single WhatsApp number via Baileys and distributes conversations among multiple attendants in real time. Production deploys 4+ tenants on a single VM via PM2, each isolated by `PORT`, `DB_PATH`, and `WA_SESSION_PATH`.

## Common commands

```powershell
# Backend (dev — auto-reload via nodemon, default port 3001 unless PORT in .env)
cd backend
Copy-Item .env.example .env    # first time only
npm install
npm run dev                    # or `npm start` for plain node

# Frontend (Vite dev server, http://localhost:5173)
cd frontend
Copy-Item .env.example .env
npm install
npm run dev                    # `npm run build` for production bundle

# No tests, no linter — verification is manual (run the app, scan QR, send messages)
```

Production / multi-tenant (Linux VM scripts in repo root, bash):
- `bash deploy/setup-vm.sh` — first-time VM provisioning (Node, PM2, Chrome, Nginx, single-tenant install)
- `bash deploy/update.sh` — pull + rebuild + `pm2 restart whatsapp-backend` for the single-tenant install
- `bash deploy/update-landing.sh` — git pull + rebuild do blog estático; atualiza a landing de `atendize.com` (servida do repo principal). **Correr sempre que mudar a landing ou os artigos do blog** — o HTML do blog é gitignored e tem de ser regenerado na VM
- `./new-tenant.sh <slug> <port> "<name>" <owner-email> <owner-password>` — provisions a new tenant under `/home/daivier/whatsapp-tenants/<slug>` with its own `.env`, frontend build, PM2 entry, and Nginx vhost
- `./update-tenant.sh <slug>` — git pull + frontend rebuild + `pm2 restart wa-<slug>` for one tenant
- `bash deploy-frontend.sh` — rebuilds the frontend once per tenant with the correct `VITE_API_URL` baked in, copying to `/home/daivier/clientes/<slug>/dist/`
- `pm2 reload ecosystem.config.js` — reload all clients defined in [ecosystem.config.js](ecosystem.config.js)

There are two coexisting deployment layouts: the older shared-repo model driven by [ecosystem.config.js](ecosystem.config.js) + `deploy-frontend.sh` (one repo at `/home/daivier/whatsapp-multiagent`, four PM2 apps pointing at it, frontends rebuilt and copied per client), and the newer per-tenant-clone model driven by `new-tenant.sh` / `update-tenant.sh` (each tenant gets its own clone under `/home/daivier/whatsapp-tenants/<slug>`). Check which one is in use before editing deploy scripts.

## Architecture

**Backend** ([backend/src/app.js](backend/src/app.js)) — Express + Socket.io on a single HTTP server. On boot it (1) opens SQLite, (2) seeds an owner user from `OWNER_*` env vars if no owner exists, (3) registers REST routes, (4) starts Socket.io, (5) initializes the WhatsApp client, (6) starts the scheduled-messages cron. Sends `process.send('ready')` for PM2 `wait_ready`.

**Frontend** (`frontend/src/`) — React 18 + Vite SPA. `AuthContext` stores JWT in `localStorage` and connects Socket.io with the token in `handshake.auth`. Routes by role: Owner → AdminPanel/Dashboard/Reports/Supervisor; Attendant → AttendantPanel.

**Realtime path** — Two writers emit `message:new`: [socket/handlers.js](backend/src/socket/handlers.js) for outbound (attendant types in UI) and [whatsapp/client.js](backend/src/whatsapp/client.js) for inbound (Baileys `messages.upsert`). Both must emit the **same event shape** `{ message, conversation }` — keep them in sync when changing either side. The outbound flow writes to DB *first*, emits to UI, *then* calls Baileys; the returned `wa_message_id` is written back so edits/replies can reference it.

**WhatsApp client** ([backend/src/whatsapp/client.js](backend/src/whatsapp/client.js)) — Baileys v7 with `useMultiFileAuthState(WA_SESSION_PATH)`. Three pieces of in-memory state that future changes must respect:
- `lidToJidMap` — WhatsApp Business numbers appear under `@lid` but real chats use `@s.whatsapp.net`. `runLidMerge()` walks the map and merges duplicate contact rows; it runs on startup, after `contacts.upsert`, after creating any new contact, and on reconnect. **If you add a code path that creates contacts, call `runLidMerge()` afterwards** or duplicates will reappear (see commit `2ad2fa0`).
- `waContactsCache` — agenda cache populated from `contacts.upsert`, read by `GET /whatsapp/contacts` for the import-from-WhatsApp flow.
- `pendingQueue` — outbound messages from the last 2 minutes, replayed via `retryPendingMessages()` if the socket drops. Keyed by `wa_message_id`; on successful retry the DB row's `wa_message_id` is rewritten to the new ID.

**Conversation routing** — New inbound messages with no open conversation auto-assign to the *online* attendant with the fewest open conversations (round-robin by load). If none online → `status='waiting'`. Owners see all conversations; attendants only see `assigned_to = user.id` (enforced in routes and in `message:send`).

**Database** ([backend/src/db/schema.js](backend/src/db/schema.js)) — better-sqlite3, WAL mode, foreign keys on. Schema lives entirely in this one file: `CREATE TABLE IF NOT EXISTS` for new tables + a list of `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch (_) {}` lines for migrations. **To add a column, append a new try/catch ALTER at the bottom** — do not edit the original CREATE statement (existing prod DBs already have the table). Default rows for the `settings` table are seeded via `INSERT OR IGNORE` at the end of the file; add new settings the same way.

**Auth** ([backend/src/middleware/auth.js](backend/src/middleware/auth.js)) — `authMiddleware` validates JWT and loads the user; `ownerOnly` gates owner-only endpoints. JWT lifetime is 12h; the frontend has a proactive expiry timer that logs the user out client-side. `users.status` is the live presence; `users.preferred_status` is the last status the user explicitly chose (never `'offline'`) and is restored on reconnect.

**File uploads** — Multer to `uploads/` at the repo root (32 MB limit), served as `/uploads/*` static. Path is `path.join(__dirname, '../../uploads')` from `app.js` — relative to the repo, not the cwd, so it works under PM2.

**Routes** — Each feature has its own router under [backend/src/routes/](backend/src/routes/) (auth, users, conversations, messages, quick-replies, tags, settings, scheduled-messages, contacts, search, keyword-rules, blacklist, broadcast). The three WhatsApp endpoints (`/whatsapp/status`, `/whatsapp/disconnect`, `/whatsapp/contacts*`) are defined inline in `app.js`, not in a router file.

**Scheduled messages** — [backend/src/scheduled/cron.js](backend/src/scheduled/cron.js) is a setInterval loop (not node-cron) that scans `scheduled_messages` and dispatches due rows through the same `sendMessage()` used by the live path.

## Environment

Backend `.env` (see [backend/.env.example](backend/.env.example)): `PORT`, `JWT_SECRET`, `OWNER_NAME/EMAIL/PASSWORD` (only used on first boot to seed owner), `FRONTEND_URL` (CORS allowlist — single origin, not a list), `WA_SESSION_PATH` (absolute path required in multi-tenant), `DB_PATH` (absolute, isolates per tenant — defaults to repo-relative `database.sqlite` for single-tenant dev).

Frontend `.env`: `VITE_API_URL` is the *full* origin of the backend (e.g. `https://atendimento.example.com`), and it's baked at build time — production deploys must rebuild per tenant with the correct value (that's what `deploy-frontend.sh` and `new-tenant.sh` do). `VITE_TENANT_NAME` is optional and shown in the UI.

## Conventions

- Codebase comments, commit messages, log strings, and UI are in **Portuguese**. Match the existing language when editing user-facing strings or log output.
- Windows dev box (PowerShell), Linux production (bash deploy scripts). Don't port bash scripts to PowerShell or vice versa — keep both.
- No test suite, no ESLint config. Verification is manual: start backend + frontend, log in, scan QR, send a real message both ways.
- The Baileys logger is intentionally silenced ([client.js:19-24](backend/src/whatsapp/client.js)). Use plain `console.log` for app-level logging; keep Baileys' own logs muted.
- `INSTRUCOES.md` is the end-user setup guide (Portuguese) — keep it accurate when changing install/setup flow.
