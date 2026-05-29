/**
 * Web Push helper — envia notificações para devices subscritos por cada user.
 *
 * Configuração via env (gerar com `npx web-push generate-vapid-keys`):
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_CONTACT   (mailto:...  ou URL — exigido pelo protocolo)
 *
 * Se as keys não estiverem configuradas, o módulo entra em no-op silencioso —
 * subscribe e sendToUser retornam sem rebentar, e o sistema continua a funcionar
 * apenas com as notificações in-browser do hook useNotifications.
 *
 * Quando uma subscription falha com 410 (Gone) ou 404, é apagada da BD
 * (device desinstalou a app ou removeu a permissão).
 */

const webpush = require('web-push');
const db = require('./db/schema');
const metrics = require('./metrics');

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const CONTACT = process.env.VAPID_CONTACT || 'mailto:admin@example.com';

let _ready = false;
if (PUBLIC && PRIVATE) {
  try {
    webpush.setVapidDetails(CONTACT, PUBLIC, PRIVATE);
    _ready = true;
    console.log('[push] activo — VAPID configurado');
  } catch (err) {
    console.error('[push] inactivo — VAPID inválido:', err.message);
  }
} else {
  console.log('[push] inactivo — VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes');
}

function isReady() { return _ready; }
function getPublicKey() { return _ready ? PUBLIC : null; }

/**
 * Envia notificação push para todos os devices subscritos de um utilizador.
 * Fire-and-forget — não bloqueia o caller. Erros são logged e subscriptions
 * inválidas são apagadas.
 *
 * @param {number} userId
 * @param {object} payload  {title, body, tag?, url?, icon?}
 */
// Verifica se a hora actual cai na janela quiet hours do user. Suporta
// janelas que atravessam meia-noite (ex: 22:00 → 08:00). Em PT-BR / UTC-3.
function isInQuietHours(start, end) {
  if (!start || !end) return false;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const cur = `${hh}:${mm}`;
  if (start === end) return false;
  // Mesma noite (ex: 13:00 → 14:00): start <= cur < end
  if (start < end) return cur >= start && cur < end;
  // Atravessa meia-noite (ex: 22:00 → 08:00): cur >= start OU cur < end
  return cur >= start || cur < end;
}

async function sendToUser(userId, payload) {
  if (!_ready || !userId) return;

  // Mute por conversa — se conversation_id está no payload e o user mutou-a, skip
  if (payload?.conversation_id) {
    const muted = db.prepare('SELECT 1 FROM conversation_mutes WHERE user_id = ? AND conversation_id = ?').get(userId, payload.conversation_id);
    if (muted) return;
  }

  // Quiet hours — se o user definiu janela e a hora actual cai dentro, skip
  // (excepto se for mention que tem flag urgent)
  if (!payload?.urgent) {
    const u = db.prepare('SELECT quiet_hours_start, quiet_hours_end FROM users WHERE id = ?').get(userId);
    if (u && isInQuietHours(u.quiet_hours_start, u.quiet_hours_end)) return;
  }

  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (subs.length === 0) return;

  const json = JSON.stringify({
    title: payload.title || 'Nova notificação',
    body: payload.body || '',
    tag: payload.tag || `n-${Date.now()}`,
    url: payload.url || '/',
    icon: payload.icon || '/icon.svg',
  });

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, json, { TTL: 60 });
      metrics.pushSentTotal.inc({ outcome: 'ok' });
    } catch (err) {
      const code = err.statusCode;
      if (code === 410 || code === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        console.log(`[push] subscription ${sub.id} expirada (${code}) — removida`);
        metrics.pushSentTotal.inc({ outcome: 'expired' });
      } else {
        console.error(`[push] envio falhou para sub ${sub.id}: ${err.message}`);
        metrics.pushSentTotal.inc({ outcome: 'error' });
      }
    }
  }
}

module.exports = { isReady, getPublicKey, sendToUser };
