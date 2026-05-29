const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

// GET /blacklist
router.get('/', authMiddleware, ownerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, u.name as created_by_name
    FROM blacklist b
    LEFT JOIN users u ON u.id = b.created_by
    ORDER BY b.created_at DESC
  `).all();
  res.json(rows);
});

// POST /blacklist — adicionar número
router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { phone, reason } = req.body;
  if (!phone?.trim()) return res.status(400).json({ error: 'phone obrigatório' });

  const clean = phone.trim().replace(/[\s\-().]/g, '');

  // Verificar se já existe
  const existing = db.prepare('SELECT id FROM blacklist WHERE phone = ?').get(clean);
  if (existing) return res.status(409).json({ error: 'Número já está na blacklist' });

  // Tentar obter wa_id do contacto se existir
  const contact = db.prepare('SELECT wa_id FROM contacts WHERE phone = ? OR phone = ? OR wa_id LIKE ?')
    .get(clean, clean.replace(/^55/, ''), `${clean}%`);

  db.prepare('INSERT INTO blacklist (phone, wa_id, reason, created_by) VALUES (?, ?, ?, ?)')
    .run(clean, contact?.wa_id || null, reason?.trim() || null, req.user.id);

  const entry = db.prepare(`
    SELECT b.*, u.name as created_by_name FROM blacklist b
    LEFT JOIN users u ON u.id = b.created_by WHERE b.phone = ?
  `).get(clean);
  logAction(req, 'blacklist.add', { type: 'blacklist', id: entry.id, details: { phone: clean, reason: reason?.trim() || null } });
  res.status(201).json(entry);
});

// DELETE /blacklist/:id
router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  const entry = db.prepare('SELECT id, phone FROM blacklist WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Não encontrado' });
  db.prepare('DELETE FROM blacklist WHERE id = ?').run(req.params.id);
  logAction(req, 'blacklist.remove', { type: 'blacklist', id: entry.id, details: { phone: entry.phone } });
  res.json({ ok: true });
});

// GET /blacklist/check/:phone — verificar se número está bloqueado
router.get('/check/:phone', authMiddleware, (req, res) => {
  const phone = req.params.phone.replace(/[\s\-().]/g, '');
  const entry = db.prepare('SELECT id FROM blacklist WHERE phone = ? OR phone = ? OR wa_id = ?')
    .get(phone, phone.replace(/^55/, ''), phone);
  res.json({ blocked: !!entry });
});

module.exports = router;
