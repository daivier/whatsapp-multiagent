const express = require('express');
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const push = require('../push');

const router = express.Router();

// GET /push/vapid-key — chave pública para o browser usar no subscribe.
// Endpoint público (sem auth) porque é só uma chave pública; o segredo
// está em VAPID_PRIVATE_KEY do lado do servidor.
router.get('/vapid-key', (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push notifications não configuradas neste servidor' });
  res.json({ key });
});

// POST /push/subscribe — regista subscription do device do utilizador.
// Body: PushSubscription serializada do browser ({ endpoint, keys: { p256dh, auth } })
router.post('/subscribe', authMiddleware, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'subscription inválida' });
  }
  const ua = req.headers['user-agent'] || null;

  // Upsert por endpoint — se o mesmo device se registar de novo, actualiza as keys
  // mas mantém o vínculo ao utilizador actual (pode ter sido outro a usar o device).
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  if (existing) {
    db.prepare('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE id = ?')
      .run(req.user.id, keys.p256dh, keys.auth, ua, existing.id);
    return res.json({ ok: true, id: existing.id, updated: true });
  }

  const r = db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, endpoint, keys.p256dh, keys.auth, ua);
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});

// DELETE /push/subscribe — body: { endpoint } para remover apenas o device actual
// (se omitido, remove todas as subscriptions do utilizador — útil para "logout em todos os devices").
router.delete('/subscribe', authMiddleware, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, endpoint);
  } else {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;
