/**
 * Planos comerciais — enforcement de funcionalidades e limites.
 *
 * O plano de cada tenant vem da env PLAN: basico | profissional | empresarial.
 * Default 'empresarial' quando não definida — tenants existentes mantêm tudo
 * (zero regressão). Para "descer" um cliente: definir PLAN no .env + pm2 restart.
 *
 * REGRA DE OURO: o bloqueio real é SEMPRE server-side (requireFeature/checkLimit).
 * A UI apenas esconde para conforto — nunca confiar só no frontend.
 *
 * `features` lista apenas as capacidades GATED que o plano desbloqueia. Tudo o
 * que não está aqui (respostas rápidas, etiquetas, notas, contactos, mídia,
 * reações, histórico, distribuição automática) é base e está sempre disponível.
 */

const PRO_FEATURES = [
  'departamentos',   // departments + routing by department
  'roteamento',      // keyword_rules
  'bot',             // FAQ bot
  'agendamento',     // scheduled-messages
  'broadcast',       // envio em massa
  'chat_interno',    // internal-chat
  'relatorios',      // reports / dashboard / ratings / export
  'transferencia',   // transferir conversas
  'csat',            // avaliação de atendimento
  'transcricao',     // transcrição de áudios
];

const ENTERPRISE_FEATURES = [
  ...PRO_FEATURES,
  'supervisores',    // role supervisor + painel supervisor
  'sentimento',      // análise de sentimento
  'auditoria',       // audit log
  'metricas',        // métricas + saúde
  'multi_idioma',    // PT/ES/EN
  'quiet_hours',     // horário de silêncio por user
  'blacklist',       // blacklist
  'pdf',             // exportar conversa em PDF
];

const PLANS = {
  basico:       { label: 'Básico',       maxLinhas: 1,        maxAtendentes: 3,        features: [] },
  profissional: { label: 'Profissional', maxLinhas: 2,        maxAtendentes: 10,       features: PRO_FEATURES },
  empresarial:  { label: 'Empresarial',  maxLinhas: Infinity, maxAtendentes: Infinity, features: ENTERPRISE_FEATURES },
};

function currentPlanKey() {
  const k = (process.env.PLAN || 'empresarial').toLowerCase().trim();
  return PLANS[k] ? k : 'empresarial';
}
function currentPlan() { return PLANS[currentPlanKey()]; }
function hasFeature(name) { return currentPlan().features.includes(name); }
function getLimit(key) { return currentPlan()[key]; }

/**
 * Middleware: bloqueia a rota se a funcionalidade não estiver no plano.
 * Responde 403 com { upgrade: true } para o frontend mostrar o upsell.
 */
function requireFeature(name) {
  return (req, res, next) => {
    if (hasFeature(name)) return next();
    return res.status(403).json({
      error: `Recurso indisponível no plano ${currentPlan().label}.`,
      feature: name,
      upgrade: true,
    });
  };
}

/** Info do plano para o frontend (GET /plan). null = ilimitado. */
function planInfo() {
  const p = currentPlan();
  return {
    plan: currentPlanKey(),
    label: p.label,
    limits: {
      maxLinhas: p.maxLinhas === Infinity ? null : p.maxLinhas,
      maxAtendentes: p.maxAtendentes === Infinity ? null : p.maxAtendentes,
    },
    features: p.features,
  };
}

module.exports = { PLANS, currentPlanKey, currentPlan, hasFeature, getLimit, requireFeature, planInfo };
