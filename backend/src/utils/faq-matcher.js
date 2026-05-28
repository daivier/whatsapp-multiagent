/**
 * Bot FAQ — matching por keywords++ (tokens normalizados + Jaccard).
 *
 * Não usa embeddings/IA — para abrir o caminho. Fase 2 substituirá esta
 * função por encode via modelo local sem mexer no caller.
 *
 * Algoritmo:
 *   1. Normaliza ambas (lowercase, remove acentos, remove pontuação,
 *      tokeniza por whitespace, remove stopwords PT-BR curtas).
 *   2. Calcula Jaccard = |intersect(tokens_msg, tokens_faq)| / |union|.
 *   3. Para cada FAQ item, gera tokens da `question` + cada linha de
 *      `variations`. Score = max Jaccard contra qualquer destas.
 *   4. Devolve o item com maior score se acima do threshold.
 */

const db = require('../db/schema');

const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas',
  'de','do','da','dos','das','em','no','na','nos','nas',
  'por','para','pra','pro','com','sem','sobre','até','ate',
  'e','ou','mas','que','se','não','nao','sim','é','e',
  'eu','tu','ele','ela','nós','nos','vós','vos','eles','elas',
  'me','te','lhe','nos','vos','lhes','meu','minha','seu','sua',
  'este','esta','isso','isto','aquele','aquela','aquilo',
  'aqui','ali','la','lá','assim','muito','pouco','mais','menos',
  'ja','já','ainda','também','tambem','só','so','tão','tao',
  'oi','olá','ola','bom','dia','tarde','noite','obrigado','obrigada',
]);

function normalize(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                // só letras/dígitos/espaço
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const norm = normalize(text);
  if (!norm) return [];
  return norm.split(' ').filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

/**
 * Devolve { item, score } com maior score entre os FAQs activos
 * relevantes para o department, ou null se nenhum passar do threshold.
 *
 * threshold = 0.4 — pode ser tunado depois com base nos hit_count e nas
 * conversas marcadas como bot_unhelpful.
 */
function matchFaq(text, departmentId = null, threshold = 0.4) {
  const msgTokens = new Set(tokenize(text));
  if (msgTokens.size === 0) return null;

  // Items aplicáveis: do dept específico OU sem dept (global).
  let rows;
  if (departmentId) {
    rows = db.prepare(
      'SELECT id, question, answer, variations, department_id FROM faq_items WHERE active = 1 AND (department_id IS NULL OR department_id = ?)'
    ).all(departmentId);
  } else {
    rows = db.prepare(
      'SELECT id, question, answer, variations, department_id FROM faq_items WHERE active = 1'
    ).all();
  }
  if (rows.length === 0) return null;

  let best = null;
  for (const row of rows) {
    const phrases = [row.question];
    if (row.variations) {
      for (const v of row.variations.split('\n').map(s => s.trim()).filter(Boolean)) {
        phrases.push(v);
      }
    }
    let rowScore = 0;
    for (const phrase of phrases) {
      const phraseTokens = new Set(tokenize(phrase));
      const score = jaccard(msgTokens, phraseTokens);
      if (score > rowScore) rowScore = score;
    }
    if (rowScore >= threshold && (!best || rowScore > best.score)) {
      best = { item: row, score: rowScore };
    }
  }
  return best;
}

module.exports = { matchFaq, tokenize, normalize };
