/**
 * Análise de sentimento simples baseada em keywords PT-BR (e algumas PT-PT).
 *
 * Devolve 'negative' | 'positive' | 'neutral'. Caller agrega resultados
 * sucessivos em `conversations.anger_score`:
 *   - 'negative' → +1 (acumula)
 *   - 'positive' → reset para 0
 *   - 'neutral'  → mantém
 *
 * Threshold para flag visual: anger_score >= 2 (duas msgs negativas
 * seguidas sem nada positivo no meio).
 *
 * Falsos positivos esperados (~20-30%): "não estou irritado", "sem
 * problema nenhum". Para reduzir, considerámos negação simples ("não")
 * antes dos keywords positivos.
 */

// Palavras / expressões negativas. Usar fronteira de palavra implícita
// via lower.includes() — basta o substring aparecer.
const NEGATIVE = [
  // Xingos / palavrões
  'porra', 'merda', 'caralho', 'foda-se', 'fodase', 'pqp', 'fdp', 'vsf',
  'vai se foder', 'vai tomar', 'puta que pariu', 'cuzão', 'cuzao',
  // Raiva / frustração
  'irritado', 'irritada', 'puto', 'raiva', 'ódio', 'odio', 'odeio',
  'furioso', 'furiosa', 'revoltado', 'revoltada', 'absurdo', 'absurda',
  'inaceitável', 'inaceitavel', 'inadmissível', 'inadmissivel',
  // Queixa / insatisfação
  'péssimo', 'pessimo', 'péssima', 'pessima', 'horrível', 'horrivel',
  'ridículo', 'ridiculo', 'vergonha', 'vergonhoso', 'decepcionado',
  'decepcionada', 'frustrado', 'frustrada', 'lixo', 'porcaria',
  'desrespeito', 'desrespeitoso',
  // Ameaças
  'processar', 'processo', 'denunciar', 'procon', 'reclame aqui',
  'reclameaqui', 'ir na imprensa', 'imprensa', 'advogado',
  'justiça', 'justica', 'idec',
  // Impaciência (acumulada — soa irritação)
  'até quando', 'ate quando', 'demora', 'demorou demais', 'demorando',
  'esperando há', 'esperando ha', 'cadê', 'cade vcs', 'cade voces',
  'não recebi', 'nao recebi', 'sem retorno', 'sem resposta',
  // Cancelamento / abandono
  'cancelar tudo', 'quero cancelar', 'cancelamento', 'nunca mais compro',
  'nunca mais', 'jamais', 'desisto', 'desistir',
];

// Palavras / expressões positivas (reset do score).
const POSITIVE = [
  'obrigado', 'obrigada', 'valeu', 'show', 'top', 'maravilha',
  'maravilhoso', 'maravilhosa', 'excelente', 'ótimo', 'otimo',
  'ótima', 'otima', 'perfeito', 'perfeita', 'gostei', 'amei',
  'adorei', 'parabéns', 'parabens', 'gentileza', 'atencioso',
  'atenciosa', 'rápido', 'rapido', 'rápida', 'rapida', 'recomendo',
  'satisfeito', 'satisfeita', 'feliz', 'agradeço', 'agradeco',
  'agradecida', 'agradecido', 'beleza', 'bem atendido', 'bem atendida',
];

// Negações que invertem positivos próximos: "não gostei", "não recomendo".
// Janela de 20 caracteres antes do termo positivo.
const NEGATION_WINDOW = 20;
const NEGATIONS = ['não ', 'nao ', 'nunca ', 'jamais '];

function hasNegationBefore(text, posTerm) {
  const idx = text.indexOf(posTerm);
  if (idx < 0) return false;
  const window = text.slice(Math.max(0, idx - NEGATION_WINDOW), idx);
  return NEGATIONS.some(neg => window.includes(neg));
}

function normalize(text) {
  return (text || '').toLowerCase()
    // remove zalgo + reduz repetidos exagerados ("aaaaaa" → "aa")
    .replace(/(.)\1{3,}/g, '$1$1');
}

/**
 * Classifica uma mensagem em negative/positive/neutral. Heurística simples
 * por substring matching. Negative tem prioridade sobre positive (se a
 * mensagem tem ambos, conta como negative — usualmente é o caso real:
 * "obrigado mas o serviço foi péssimo").
 */
function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') return 'neutral';
  const t = normalize(text);
  if (t.length < 3) return 'neutral';

  const hasNeg = NEGATIVE.some(k => t.includes(k));
  if (hasNeg) return 'negative';

  // Positivo só se não tiver negação imediatamente antes
  const posTerm = POSITIVE.find(k => t.includes(k));
  if (posTerm && !hasNegationBefore(t, posTerm)) return 'positive';

  return 'neutral';
}

module.exports = { analyzeSentiment };
