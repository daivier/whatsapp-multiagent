# Blog (atendize.com/blog)

Blog estático gerado a partir de arquivos Markdown. Servido pelo Nginx direto de `landing/blog/`
(o `try_files $uri` da landing já cobre estas páginas — sem mudança de servidor).

## Como funciona

- Os artigos ficam em `content/*.md` (Markdown com frontmatter).
- `node build.mjs` (ou `npm run build`) lê todos os `.md` e gera o HTML estático:
  `index.html`, um `<slug>.html` por artigo, `categoria/<categoria>.html` e `sitemap.xml`.
- O HTML gerado **não é versionado** (ver `.gitignore`) — é recriado no deploy.

## Rodar localmente

```bash
cd landing/blog
npm install      # primeira vez (instala marked + gray-matter)
npm run build    # gera o HTML
```

Depois sirva a pasta `landing/` (ex.: `npx serve landing`) e abra `/blog/`.

## Adicionar um artigo novo

1. Crie `content/meu-artigo.md` com este frontmatter:

```yaml
---
title: "Título do artigo"
description: "Resumo de ~155 caracteres (vira a meta description do Google)."
slug: titulo-do-artigo            # opcional; vira titulo-do-artigo.html
category: Atendimento             # define a página de categoria
tags: [whatsapp, atendimento]
date: 2026-05-30
author: Equipe MultiAtendente
image: https://images.unsplash.com/photo-XXXX?auto=format&fit=crop&w=1200&q=70
imageAlt: "Descrição da imagem (acessibilidade + SEO)"
imageCredit: Nome do Fotógrafo
imageCreditUrl: https://unsplash.com/@usuario
featured: false                   # true = aparece em destaque no topo do índice
---

Corpo do artigo em Markdown. Use ## para seções, listas, **negrito** e
links internos para outros posts: [veja este guia](/blog/outro-artigo.html).
```

2. Rode `npm run build`. Pronto.

## Imagens

Use fotos do **Unsplash** (hotlink permitido pela licença) e preencha `imageCredit` /
`imageCreditUrl` — o crédito aparece sob a imagem do artigo. Não use Freepik aqui
(precisa de licença/conta). Boas buscas: "customer service", "team office", "whatsapp business".

## Categorias atuais

Atendimento · WhatsApp para Empresas · Gestão de Equipes · Vendas · Produtividade · Métricas & SLA

As categorias são criadas automaticamente a partir do campo `category` dos artigos.
