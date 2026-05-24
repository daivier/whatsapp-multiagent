const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const ioInstance = require('../io-instance');

const router = express.Router();

// GET / — lista departamentos activos, com contagens úteis para UI.
// Inclui campo `is_mine` para o atendente saber a que pertence.
router.get('/', authMiddleware, (req, res) => {
  const depts = db.prepare(`
    SELECT d.id, d.name, d.color, d.is_default, d.active, d.created_at,
      (SELECT COUNT(*) FROM user_departments ud WHERE ud.department_id = d.id) AS member_count,
      (SELECT COUNT(*) FROM conversations c WHERE c.department_id = d.id AND c.status IN ('open','waiting')) AS active_conversations,
      EXISTS (SELECT 1 FROM user_departments ud WHERE ud.department_id = d.id AND ud.user_id = ?) AS is_mine
    FROM departments d
    WHERE d.active = 1
    ORDER BY d.is_default DESC, d.name ASC
  `).all(req.user.id);
  res.json(depts);
});

// POST / — criar (owner). Se for o primeiro, fica default automaticamente.
router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { name, color, is_default } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name obrigatório' });

  try {
    const created = db.transaction(() => {
      const existing = db.prepare("SELECT COUNT(*) AS c FROM departments WHERE active = 1").get().c;
      const shouldBeDefault = existing === 0 || !!is_default;
      if (shouldBeDefault) db.prepare("UPDATE departments SET is_default = 0").run();
      const r = db.prepare("INSERT INTO departments (name, color, is_default) VALUES (?, ?, ?)")
        .run(name.trim(), color || '#6b7280', shouldBeDefault ? 1 : 0);
      return db.prepare("SELECT * FROM departments WHERE id = ?").get(r.lastInsertRowid);
    })();

    ioInstance.get()?.emit('department:created', created);
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Já existe um departamento com esse nome' });
    }
    throw err;
  }
});

// PUT /:id — actualizar nome/cor/is_default (owner).
router.put('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { id } = req.params;
  const { name, color, is_default } = req.body;

  const existing = db.prepare("SELECT id FROM departments WHERE id = ? AND active = 1").get(id);
  if (!existing) return res.status(404).json({ error: 'Departamento não encontrado' });

  try {
    db.transaction(() => {
      if (is_default) db.prepare("UPDATE departments SET is_default = 0").run();
      const fields = [];
      const params = [];
      if (name?.trim()) { fields.push("name = ?"); params.push(name.trim()); }
      if (color) { fields.push("color = ?"); params.push(color); }
      if (is_default !== undefined) { fields.push("is_default = ?"); params.push(is_default ? 1 : 0); }
      if (fields.length) {
        params.push(id);
        db.prepare(`UPDATE departments SET ${fields.join(', ')} WHERE id = ?`).run(...params);
      }
    })();

    const updated = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
    ioInstance.get()?.emit('department:updated', updated);
    res.json(updated);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Já existe um departamento com esse nome' });
    }
    throw err;
  }
});

// DELETE /:id — soft delete. Aceita ?reassign_to=<dept_id> para migrar conversas
// abertas antes de arquivar.
router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { id } = req.params;
  const reassignTo = req.query.reassign_to ? parseInt(req.query.reassign_to, 10) : null;

  const dept = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
  if (!dept) return res.status(404).json({ error: 'Departamento não encontrado' });

  const openCount = db.prepare(
    "SELECT COUNT(*) AS c FROM conversations WHERE department_id = ? AND status IN ('open','waiting')"
  ).get(id).c;

  if (openCount > 0 && !reassignTo) {
    return res.status(409).json({
      error: `${openCount} conversa(s) abertas neste departamento`,
      open_count: openCount,
      hint: 'Passe ?reassign_to=<dept_id> para migrar antes de arquivar',
    });
  }

  if (reassignTo) {
    const target = db.prepare("SELECT id FROM departments WHERE id = ? AND active = 1").get(reassignTo);
    if (!target) return res.status(400).json({ error: 'Departamento de destino inválido' });
    if (target.id === parseInt(id, 10)) return res.status(400).json({ error: 'reassign_to não pode ser o próprio departamento' });
  }

  db.transaction(() => {
    if (reassignTo) {
      db.prepare("UPDATE conversations SET department_id = ? WHERE department_id = ?").run(reassignTo, id);
    }
    db.prepare("UPDATE departments SET active = 0, is_default = 0 WHERE id = ?").run(id);
    db.prepare("DELETE FROM user_departments WHERE department_id = ?").run(id);
  })();

  ioInstance.get()?.emit('department:deleted', { id: parseInt(id, 10) });
  res.json({ ok: true });
});

// GET /:id/members — atendentes do departamento (owner only).
router.get('/:id/members', authMiddleware, ownerOnly, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.status, u.on_shift
    FROM users u
    INNER JOIN user_departments ud ON ud.user_id = u.id
    WHERE ud.department_id = ? AND u.active = 1
    ORDER BY u.name ASC
  `).all(req.params.id);
  res.json(members);
});

// PUT /:id/members — substitui a lista de membros (apaga + reinsere em transacção).
router.put('/:id/members', authMiddleware, ownerOnly, (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids deve ser array de IDs' });

  const dept = db.prepare("SELECT id FROM departments WHERE id = ? AND active = 1").get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Departamento não encontrado' });

  db.transaction(() => {
    db.prepare("DELETE FROM user_departments WHERE department_id = ?").run(req.params.id);
    const ins = db.prepare("INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)");
    for (const uid of user_ids) {
      const u = db.prepare("SELECT id FROM users WHERE id = ? AND active = 1 AND role = 'attendant'").get(uid);
      if (u) ins.run(uid, req.params.id);
    }
  })();

  ioInstance.get()?.emit('department:updated', { id: parseInt(req.params.id, 10) });
  res.json({ ok: true });
});

module.exports = router;
