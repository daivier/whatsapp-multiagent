---
name: project-brand
description: "A marca oficial do produto é 'Atendize' (não 'MultiAtendente'). Domínio atendize.com. 'multiatendente' mantém-se só como keyword SEO nos artigos."
metadata:
  node_type: memory
  type: project
---

A marca oficial é **Atendize** (decidido 2026-05-30, rebrand de "MultiAtendente"). O domínio é `atendize.com`.

**How to apply:** Ao escrever UI, emails, títulos ou copy, usar **Atendize**. NÃO usar "MultiAtendente"/"WhatsApp Multi-Atendente" como nome do produto.

- **Landing + blog (atendize.com):** já rebrandado (logo, nav, rodapé, CTAs, títulos, `SITE.name` em landing/blog/template.mjs, autor dos artigos = "Equipe Atendize"). Commit `737fc87`.
- **Keyword SEO:** "multiatendente"/"multi-atendente" em **minúsculas** mantém-se de propósito no *corpo* dos artigos do blog — é termo de pesquisa (categoria), não a marca. Não apagar.
- **Control-plane:** o email de boas-vindas já diz "Atendize" (consistente).

**Ainda por rebrandar (surfaces separadas, não feitas):**
1. **App dos clientes** (`frontend/`): fallback "WhatsApp Multi-Atendente" em index.html, public/manifest.json, public/sw.js, Login.jsx, AttendantPanel.jsx (só aparece se `VITE_TENANT_NAME` não definido) e **hardcoded** em SupervisorLayout.jsx. Mudar exige rebuild+redeploy do frontend por tenant.
2. **Email de suporte** em [[project-saas-domain-subdomains]]/new-tenant.sh ainda usa domínio `multiatendente.app` (decidir se passa a suporte@atendize.com).
3. `og-default.png` do blog ainda não existe.
