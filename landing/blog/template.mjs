// Layout compartilhado do blog — replica a nav/footer e o estilo da landing (index.html).
// Todas as funcoes retornam strings de HTML. As paginas sao montadas em build.mjs.

export const SITE = {
  baseUrl: 'https://atendize.com',
  blogBase: '/blog',
  name: 'Atendize',
  brandTagline: 'Atendimento profissional para WhatsApp',
  waNumber: '5596981373574',
};

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Caminho relativo ate a raiz do blog ('' para a raiz, '../' para subpastas como /categoria/)
function assetPrefix(depth = 0) {
  return depth > 0 ? '../'.repeat(depth) : '';
}

export function head({ title, description, canonical, image, type = 'website', jsonLd = [], depth = 0 }) {
  const pre = assetPrefix(depth);
  const fullTitle = title;
  const img = image || `${SITE.baseUrl}/blog/assets/og-default.png`;
  const ld = (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
    .filter(Boolean)
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .join('\n  ');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description || '')}" />
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : ''}
  <meta property="og:type" content="${type}" />
  <meta property="og:title" content="${escapeHtml(fullTitle)}" />
  <meta property="og:description" content="${escapeHtml(description || '')}" />
  ${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}" />` : ''}
  <meta property="og:image" content="${escapeHtml(img)}" />
  <meta property="og:site_name" content="${SITE.name}" />
  <meta property="og:locale" content="pt_BR" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(description || '')}" />
  <meta name="twitter:image" content="${escapeHtml(img)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${pre}blog.css">
  ${ld}
</head>
<body>`;
}

export function nav() {
  return `<header class="nav"><div class="container nav-inner">
  <a href="/" class="brand"><span class="brand-mark">&#9742;</span><span>Atend<span class="gradient-text">ize</span></span></a>
  <nav class="navlinks" id="navlinks">
    <a href="/#solucao">Como funciona</a>
    <a href="/#recursos">Recursos</a>
    <a href="/#planos">Planos</a>
    <a href="/tutorial.html">Tutorial</a>
    <a href="/blog/" class="active">Blog</a>
    <a href="/#faq">FAQ</a>
    <a class="btn btn-primary menu-cta" data-wa>Testar gr&aacute;tis</a>
  </nav>
  <a class="btn btn-primary nav-cta" data-wa>Testar gr&aacute;tis</a>
  <button class="menu-toggle" id="menuToggle" aria-label="Abrir menu" aria-expanded="false">&#9776;</button>
</div></header>`;
}

export function footer() {
  return `<footer><div class="container footer-row">
  <a href="/" class="brand"><span class="brand-mark">&#9742;</span><span>${SITE.name}</span></a>
  <div>&copy; <span id="year"></span> &middot; ${SITE.brandTagline}</div>
</div></footer>
<a class="wa-float" data-wa title="Falar no WhatsApp">&#9742;</a>
<script>
  window.WA_NUMBER = '${SITE.waNumber}';
  window.waLink = function(msg){ return 'https://wa.me/' + window.WA_NUMBER + '?text=' + encodeURIComponent(msg || 'Ol\\u00e1! Quero testar o Atendize.'); };
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('[data-wa]').forEach(function(a){ a.href = window.waLink(a.dataset.wa || ''); a.target = '_blank'; a.rel = 'noopener'; });
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    var btn = document.getElementById('menuToggle'), menu = document.getElementById('navlinks');
    if (btn && menu) btn.addEventListener('click', function(){ var open = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  });
</script>
</body>
</html>`;
}

// Bloco de CTA reutilizavel no fim dos artigos
export function ctaBox() {
  return `<aside class="cta-box">
  <h2>Pronto para organizar o atendimento da sua empresa?</h2>
  <p>Coloque v&aacute;rios atendentes no mesmo WhatsApp, com departamentos, relat&oacute;rios e hist&oacute;rico centralizado. Teste gr&aacute;tis, sem cart&atilde;o.</p>
  <a class="btn btn-primary" data-wa="Ol&aacute;! Quero testar o Atendize gr&aacute;tis.">Come&ccedil;ar teste gr&aacute;tis &rarr;</a>
</aside>`;
}
