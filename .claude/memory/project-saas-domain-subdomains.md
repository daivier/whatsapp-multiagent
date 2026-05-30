---
name: project-saas-domain-subdomains
description: "Domínio do SaaS é atendize.com; tenants vivem em <slug>.atendize.com via wildcard DNS + cert wildcard Cloudflare. Setup único, não por cliente."
metadata:
  node_type: memory
  type: project
---

O SaaS usa o domínio **`atendize.com`**. Cada tenant fica em **`<slug>.atendize.com`** (ex: `loja-abc.atendize.com`). A landing/marketing fica em `atendize.com` / `www`.

**Why:** Decidido em 2026-05-30 ao preparar a Fase 3b (provisionamento automático). O `new-tenant.sh` antigo usava `nip.io` (DNS falso, só HTTP) — não serve para cliente pagante. Mudámos para subdomínios reais com HTTPS via abordagem **wildcard** (Cloudflare é setup ÚNICO, não há chamada de API por cliente).

**How to apply:** O provisionamento de um tenant novo NÃO toca em DNS nem emite cert — tudo já está pronto pelo setup único abaixo. O `new-tenant.sh` só cria o vhost Nginx que referencia o cert wildcard partilhado.

Setup único — **FEITO em 2026-05-30** (cert wildcard emitido, expira 2026-08-28, renova sozinho):
- **Cloudflare:** zona `atendize.com`; registos A `@`, `www`, `*` → `104.197.219.5`, todos **DNS only (cinza)** para começar (Socket.io em tempo real + emissão de cert). Pode passar a proxied (laranja) depois para DDoS/esconder IP.
- **API Token** Cloudflare (Zone:DNS:Edit em atendize.com) guardado na VM em `/root/.secrets/cloudflare.ini` (chmod 600) como `dns_cloudflare_api_token = ...`.
- **Cert wildcard** via `certbot certonly --dns-cloudflare ... -d atendize.com -d '*.atendize.com'` → vive em `/etc/letsencrypt/live/atendize.com/` (fullchain.pem + privkey.pem), renova sozinho. Precisa do plugin `python3-certbot-dns-cloudflare` (o `setup-vm.sh` só instalava `python3-certbot-nginx`, que NÃO emite wildcard).

O `new-tenant.sh` tem as variáveis `ZONE`, `DOMAIN=<slug>.atendize.com`, `CERT_DIR=/etc/letsencrypt/live/atendize.com` e o vhost com redirect 80→443 + `listen 443 ssl`.

**Fase 3b FEITA (2026-05-30):** o control-plane (control-plane/server.js) provisiona o tenant sozinho ao aprovar o pagamento — gera slug+porta livre+senha, dispara `new-tenant.sh` em background (spawn a partir do processo PM2; PATH explícito; sudo/pm2 do filho funcionam), e quando termina expõe URL+login+senha no `GET /signup/:id/status` (a landing mostra ao cliente). Idempotente via lock `provision_status`. Colunas novas em `signups`: slug, port, owner_password, url, provision_status, provision_error, provisioned_at. Log por signup em `/home/daivier/wa-control/provision-<id>.log`. Desligável com `AUTO_PROVISION=0`. Validado end-to-end com signup falso (provisionou auto-demo.atendize.com e foi limpo).

**DEPLOY do control-plane (IMPORTANTE):** o processo PM2 `wa-control` corre de `/home/daivier/wa-control/` que é uma **cópia manual** (não git) do `control-plane/` do repo. Para deployar: editar repo → `git pull` na VM em /home/daivier/whatsapp-multiagent → `cp control-plane/server.js /home/daivier/wa-control/server.js` → `pm2 restart wa-control`. A BD `signups.sqlite` vive em `wa-control/` (não tocar). A landing é servida direto do repo (`/home/daivier/whatsapp-multiagent/landing`), logo `git pull` já a atualiza.
