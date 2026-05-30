---
name: project-vm-tenant-layout
description: "Mapeamento de tenants na VM (nome PM2 vs domínio) e divergência do ecosystem.config.js da VM vs repo (PLAN definido à mão, não commitado)."
metadata:
  node_type: memory
  type: project
---

Na VM (`104.197.219.5`, alias SSH `vmfortaleza`, chave `claude_session`, sudo sem senha) há DOIS modelos de tenant a coexistir (ver CLAUDE.md), e os nomes não batem com os domínios. Mapa real (2026-05-30):

**Modelo partilhado (ecosystem.config.js, repo `/home/daivier/whatsapp-multiagent`):**
- `whatsapp-supermercados` → porta 3002 → atendimento.supermercadosfortaleza.com.br
- `whatsapp-sucataodejeova` → porta 3005 → **diaadia.code2scan.com** (o cliente "diaadia" é este!). Frontend em `clientes/sucataodejeova/dist`. Vhost no ficheiro mal-nomeado `/etc/nginx/sites-enabled/wa-sucataodejeova`.
- `whatsapp-diaristou` → porta 3006 → atendimento.diaristou.com.br
- `whatsapp-sac-supermercados` → porta 3007 → atendimentosac.supermercadosfortaleza.com.br

**Modelo clone (new-tenant.sh, `/home/daivier/whatsapp-tenants/<slug>`):** `staging`, `supermercados`, e agora `teste` (porta 3030, teste.atendize.com).

⚠️ **DIVERGÊNCIA IMPORTANTE:** o `ecosystem.config.js` **da VM** foi editado à mão e tem `PLAN: '...'` em blocos de tenant — mas o ficheiro **no git NÃO tem nenhum PLAN**. Logo, mudanças de plano nos tenants do modelo partilhado vivem só na VM. Um deploy que reescreva esse ficheiro repõe o default (empresarial). Para mudar plano no modelo partilhado: editar a linha PLAN no ecosystem da VM + `PLAN=<plano> pm2 restart <app> --update-env` (preserva os script args VAPID, que o reload via ecosystem perderia) + `pm2 save`. O `set-plan.sh` só serve o modelo clone.

**Reconciliado em 2026-05-30:** o `ecosystem.config.js` do repo agora tem `PLAN` por tenant (sucataodejeova=profissional, restantes=empresarial) + VAPID via secrets. E foi recriado o **`secrets.local.js`** na VM (`/home/daivier/whatsapp-multiagent/secrets.local.js`, modo 600, gitignored) com os JWT_SECRET/OWNER_PASSWORD/VAPID **reais** extraídos dos processos em execução — antes não existia, e um `pm2 reload` cairia nos defaults inseguros (`change_me_*`/`admin123`), deslogando todos. Os blocos `supermercados` e `sac-supermercados` no ecosystem estão DORMENTES (migraram para o modelo clone wa-*). Agora um `pm2 reload ecosystem.config.js` é seguro — mas confirmar sempre que o secrets.local.js da VM existe antes de o correr.

Relacionado: [[project-saas-domain-subdomains]], [[project-arch-evolution]]. Planos/csat: ver backend/src/plan.js (csat é PRO+).
