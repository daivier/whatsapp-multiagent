const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, ownerOnly, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

router.patch('/', authMiddleware, ownerOnly, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const update = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) upsert.run(key, String(value));
  });
  update(req.body);
  res.json({ ok: true });
});

module.exports = router;
