// Gerador estatico do blog. Le content/*.md e escreve HTML em landing/blog/.
// Uso: npm run build  (ou: node build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { SITE, escapeHtml, head, nav, footer, ctaBox } from './template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, 'content');
const OUT_DIR = __dirname; // gera na propria pasta /blog
const CAT_DIR = path.join(OUT_DIR, 'categoria');

marked.setOptions({ mangle: false, headerIds: false });

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function slugify(str = '') {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
}

function readingTimeFromText(text) {
  const words = text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// ---- Carregar artigos ----
function loadPosts() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
  const posts = files.map((file) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const { data, content } = matter(raw);
    const slug = data.slug || slugify(path.basename(file, '.md'));
    const html = marked.parse(content);
    const readingTime = data.readingTime || readingTimeFromText(content);
    const excerpt = data.description || content.replace(/[#>*_`\-]/g, '').trim().slice(0, 160);
    return {
      ...data,
      slug,
      html,
      readingTime,
      excerpt,
      category: data.category || 'Geral',
      categorySlug: slugify(data.category || 'Geral'),
      url: `${SITE.blogBase}/${slug}.html`,
      canonical: `${SITE.baseUrl}${SITE.blogBase}/${slug}.html`,
      date: data.date ? new Date(data.date) : new Date(0),
    };
  });
  posts.sort((a, b) => b.date - a.date);
  return posts;
}

// ---- Componentes ----
function postCard(p) {
  return `<article class="post-card">
  ${p.image ? `<a href="${p.url}"><img class="post-thumb" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.imageAlt || p.title)}" loading="lazy"></a>` : ''}
  <div class="post-body">
    <a class="post-cat" href="${SITE.blogBase}/categoria/${p.categorySlug}.html">${escapeHtml(p.category)}</a>
    <h3><a href="${p.url}">${escapeHtml(p.title)}</a></h3>
    <p class="post-excerpt">${escapeHtml(p.excerpt)}</p>
    <div class="post-meta"><span>${fmtDate(p.date)}</span><span class="dot"></span><span>${p.readingTime} min de leitura</span></div>
  </div>
</article>`;
}

function catBar(categories, activeSlug) {
  const all = `<a class="cat-chip ${activeSlug ? '' : 'active'}" href="${SITE.blogBase}/">Todos</a>`;
  const chips = categories.map((c) =>
    `<a class="cat-chip ${activeSlug === c.slug ? 'active' : ''}" href="${SITE.blogBase}/categoria/${c.slug}.html">${escapeHtml(c.name)}</a>`
  ).join('');
  return `<div class="cat-bar">${all}${chips}</div>`;
}

// ---- Paginas ----
function renderIndex(posts, categories) {
  const featured = posts.find((p) => p.featured) || posts[0];
  const rest = posts.filter((p) => p !== featured);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: posts.slice(0, 30).map((p, i) => ({
      '@type': 'ListItem', position: i + 1, url: p.canonical, name: p.title,
    })),
  };
  const featuredBlock = featured ? `<div class="featured">
    ${featured.image ? `<a href="${featured.url}"><img class="featured-img" src="${escapeHtml(featured.image)}" alt="${escapeHtml(featured.imageAlt || featured.title)}"></a>` : ''}
    <div class="featured-body">
      <span class="featured-tag">Em destaque</span>
      <h2><a href="${featured.url}">${escapeHtml(featured.title)}</a></h2>
      <p>${escapeHtml(featured.excerpt)}</p>
      <div class="post-meta"><span>${escapeHtml(featured.category)}</span><span class="dot"></span><span>${featured.readingTime} min de leitura</span></div>
    </div>
  </div>` : '';
  return [
    head({
      title: `Blog do ${SITE.name} — atendimento no WhatsApp para empresas`,
      description: 'Guias práticos sobre atendimento no WhatsApp, multiatendente, gestão de equipes, vendas, produtividade e métricas para sua empresa vender e atender melhor.',
      canonical: `${SITE.baseUrl}${SITE.blogBase}/`,
      jsonLd,
    }),
    nav(),
    `<main>
  <section class="blog-hero"><div class="container">
    <span class="eyebrow">Blog</span>
    <h1>Atenda e venda melhor pelo WhatsApp.</h1>
    <p>Guias práticos sobre atendimento em equipe, organização de conversas, vendas e produtividade — para transformar o WhatsApp da sua empresa numa central profissional.</p>
    ${catBar(categories, null)}
  </div></section>
  <section class="posts"><div class="container">
    ${featuredBlock}
    <div class="section-label">Artigos recentes</div>
    <div class="post-grid">${rest.map(postCard).join('\n')}</div>
  </div></section>
</main>`,
    footer(),
  ].join('\n');
}

function renderCategory(cat, posts, categories) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: posts.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: p.canonical, name: p.title })),
  };
  return [
    head({
      title: `${cat.name} — Blog do ${SITE.name}`,
      description: `Artigos sobre ${cat.name.toLowerCase()} no atendimento via WhatsApp.`,
      canonical: `${SITE.baseUrl}${SITE.blogBase}/categoria/${cat.slug}.html`,
      jsonLd,
      depth: 1,
    }),
    nav(),
    `<main>
  <section class="blog-hero"><div class="container">
    <div class="breadcrumb"><a href="/blog/">Blog</a><span>/</span>${escapeHtml(cat.name)}</div>
    <span class="eyebrow">Categoria</span>
    <h1>${escapeHtml(cat.name)}</h1>
    ${catBar(categories, cat.slug)}
  </div></section>
  <section class="posts"><div class="container">
    <div class="post-grid">${posts.map(postCard).join('\n')}</div>
  </div></section>
</main>`,
    footer(),
  ].join('\n');
}

function renderArticle(p, posts) {
  const related = posts.filter((x) => x.categorySlug === p.categorySlug && x.slug !== p.slug).slice(0, 3);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: p.title,
      description: p.description || p.excerpt,
      image: p.image ? [p.image] : undefined,
      datePublished: isoDate(p.date),
      dateModified: isoDate(p.date),
      author: { '@type': 'Organization', name: p.author || SITE.name },
      publisher: { '@type': 'Organization', name: SITE.name },
      mainEntityOfPage: p.canonical,
      articleSection: p.category,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Blog', item: `${SITE.baseUrl}${SITE.blogBase}/` },
        { '@type': 'ListItem', position: 2, name: p.category, item: `${SITE.baseUrl}${SITE.blogBase}/categoria/${p.categorySlug}.html` },
        { '@type': 'ListItem', position: 3, name: p.title, item: p.canonical },
      ],
    },
  ];
  const credit = p.imageCredit
    ? `<p class="img-credit">Foto: ${p.imageCreditUrl ? `<a href="${escapeHtml(p.imageCreditUrl)}" target="_blank" rel="noopener nofollow">${escapeHtml(p.imageCredit)}</a>` : escapeHtml(p.imageCredit)} / Unsplash</p>`
    : '';
  const relatedBlock = related.length
    ? `<section class="related"><div class="container">
      <div class="section-label">Continue lendo</div>
      <div class="post-grid">${related.map(postCard).join('\n')}</div>
    </div></section>`
    : '';
  return [
    head({
      title: `${p.title} — Blog do ${SITE.name}`,
      description: p.description || p.excerpt,
      canonical: p.canonical,
      image: p.image,
      type: 'article',
      jsonLd,
    }),
    nav(),
    `<main>
  <article class="article-wrap"><div class="container">
    <div class="breadcrumb"><a href="/blog/">Blog</a><span>/</span><a href="/blog/categoria/${p.categorySlug}.html">${escapeHtml(p.category)}</a></div>
    <header class="article-head">
      <a class="post-cat" href="/blog/categoria/${p.categorySlug}.html">${escapeHtml(p.category)}</a>
      <h1>${escapeHtml(p.title)}</h1>
      ${p.description ? `<p class="lead">${escapeHtml(p.description)}</p>` : ''}
      <div class="article-meta"><span>${escapeHtml(p.author || SITE.name)}</span><span class="dot"></span><span>${fmtDate(p.date)}</span><span class="dot"></span><span>${p.readingTime} min de leitura</span></div>
    </header>
    ${p.image ? `<figure class="article-hero"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.imageAlt || p.title)}"></figure>${credit}` : ''}
    <div class="article-body">
      ${p.html}
    </div>
    ${ctaBox()}
  </div></article>
  ${relatedBlock}
</main>`,
    footer(),
  ].join('\n');
}

function renderSitemap(posts, categories) {
  const urls = [
    { loc: `${SITE.baseUrl}${SITE.blogBase}/`, prio: '0.9' },
    ...categories.map((c) => ({ loc: `${SITE.baseUrl}${SITE.blogBase}/categoria/${c.slug}.html`, prio: '0.6' })),
    ...posts.map((p) => ({ loc: p.canonical, prio: '0.8', lastmod: isoDate(p.date) })),
  ];
  const body = urls.map((u) =>
    `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.prio}</priority></url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

// ---- Build ----
function build() {
  const posts = loadPosts();
  if (!posts.length) {
    console.warn('Nenhum artigo encontrado em content/. Nada a gerar.');
    return;
  }
  const catMap = new Map();
  for (const p of posts) {
    if (!catMap.has(p.categorySlug)) catMap.set(p.categorySlug, { name: p.category, slug: p.categorySlug, posts: [] });
    catMap.get(p.categorySlug).posts.push(p);
  }
  const categories = [...catMap.values()];

  fs.mkdirSync(CAT_DIR, { recursive: true });

  // Index
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderIndex(posts, categories));
  // Artigos
  for (const p of posts) {
    fs.writeFileSync(path.join(OUT_DIR, `${p.slug}.html`), renderArticle(p, posts));
  }
  // Categorias
  for (const c of categories) {
    fs.writeFileSync(path.join(CAT_DIR, `${c.slug}.html`), renderCategory(c, c.posts, categories));
  }
  // Sitemap
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), renderSitemap(posts, categories));

  console.log(`Blog gerado: ${posts.length} artigos, ${categories.length} categorias.`);
  console.log(` - index.html`);
  console.log(` - ${posts.length} paginas de artigo`);
  console.log(` - ${categories.length} paginas de categoria (categoria/*.html)`);
  console.log(` - sitemap.xml`);
}

build();
