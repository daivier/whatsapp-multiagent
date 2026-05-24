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
async function sendToUser(userId, payload) {
  if (!_ready || !userId) return;
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
    } catch (err) {
      const code = err.statusCode;
      if (code === 410 || code === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        console.log(`[push] subscription ${sub.id} expirada (${code}) — removida`);
      } else {
        console.error(`[push] envio falhou para sub ${sub.id}: ${err.message}`);
      }
    }
  }
}

module.exports = { isReady, getPublicKey, sendToUser };
