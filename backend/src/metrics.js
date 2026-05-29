/**
 * Métricas Prometheus — exposição em /metrics (sem auth, padrão para scrape).
 *
 * Registadas:
 *   - whatsapp_messages_total{direction,line_id,has_media}  (counter)
 *   - whatsapp_conversations_active{status}                  (gauge)
 *   - whatsapp_line_connected{line_id}                       (gauge 0/1)
 *   - whatsapp_send_duration_seconds{line_id}                (histogram)
 *   - whatsapp_transcribe_total{outcome}                     (counter)
 *   - whatsapp_push_sent_total{outcome}                      (counter)
 *   - http_requests_total{method,route,status}               (counter)
 *   - http_request_duration_seconds{method,route}            (histogram)
 *   - default Node.js metrics (CPU, memory, event loop)
 *
 * Os callers em client.js / push.js / cron.js etc. importam este módulo e
 * chamam métodos como messagesTotal.inc({...}).
 */

const client = require('prom-client');
const db = require('./db/schema');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'node_' });

const messagesTotal = new client.Counter({
  name: 'whatsapp_messages_total',
  help: 'Total de mensagens processadas (in/out)',
  labelNames: ['direction', 'line_id', 'has_media'],
  registers: [register],
});

const conversationsActive = new client.Gauge({
  name: 'whatsapp_conversations_active',
  help: 'Conversas activas (open, waiting)',
  labelNames: ['status'],
  registers: [register],
});

const lineConnected = new client.Gauge({
  name: 'whatsapp_line_connected',
  help: 'Estado da conexão Baileys por linha (1=on, 0=off)',
  labelNames: ['line_id', 'line_name'],
  registers: [register],
});

const sendDuration = new client.Histogram({
  name: 'whatsapp_send_duration_seconds',
  help: 'Latência do sendMessage Baileys',
  labelNames: ['line_id'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const transcribeTotal = new client.Counter({
  name: 'whatsapp_transcribe_total',
  help: 'Transcrições de áudio por outcome',
  labelNames: ['outcome'], // ok, error, empty, disabled
  registers: [register],
});

const pushSentTotal = new client.Counter({
  name: 'whatsapp_push_sent_total',
  help: 'Push notifications enviadas por outcome',
  labelNames: ['outcome'], // ok, error, expired
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latência das requisições HTTP',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Refresh dos gauges de conversas a cada 15s (não tem sentido por evento)
function refreshConversationGauges() {
  try {
    const rows = db.prepare("SELECT status, COUNT(*) AS c FROM conversations WHERE status IN ('open','waiting') GROUP BY status").all();
    conversationsActive.reset();
    for (const r of rows) conversationsActive.set({ status: r.status }, r.c);
  } catch (_) {}
}
setInterval(refreshConversationGauges, 15000).unref();
refreshConversationGauges();

// Express middleware para httpRequests + duration. Anexar antes das routes.
function httpMetricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e9;
    // Usa req.route?.path se disponível para evitar cardinalidade alta com :ids
    const route = req.route?.path || req.baseUrl || req.path || 'unknown';
    httpRequestsTotal.inc({ method: req.method, route, status: String(res.statusCode) });
    httpRequestDuration.observe({ method: req.method, route }, ms);
  });
  next();
}

module.exports = {
  register,
  messagesTotal,
  conversationsActive,
  lineConnected,
  sendDuration,
  transcribeTotal,
  pushSentTotal,
  httpRequestsTotal,
  httpRequestDuration,
  httpMetricsMiddleware,
};
