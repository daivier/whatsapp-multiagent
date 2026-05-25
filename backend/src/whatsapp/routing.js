/**
 * Roteamento de conversas por departamento.
 *
 * Comportamento opt-in: se não houver nenhum departamento activo,
 * `computeTargetDepartment` devolve null e `pickLeastBusyAttendant(null)`
 * cai no modo legacy (qualquer atendente online), exactamente como antes
 * desta feature existir.
 *
 * Para activar: o Dono cria pelo menos um departamento, marca-o como
 * is_default = 1 e associa atendentes via user_departments.
 */

const db = require('../db/schema');

function hasAnyDepartment() {
  return db.prepare('SELECT COUNT(*) AS c FROM departments WHERE active = 1').get().c > 0;
}

/**
 * Decide para que departamento uma conversa nova deve ir, baseado no corpo
 * da primeira mensagem e/ou na linha por onde chegou.
 *
 * Ordem:
 *   1. Sem departamentos configurados → null (modo legacy)
 *   2. A linha tem department_id configurado → usa esse departamento directamente
 *   3. Regra de keyword_rules com department_id que case com a mensagem
 *      (ordem: priority ASC, id ASC — primeira que casa vence)
 *   4. Departamento marcado como is_default
 *   5. null (há departamentos mas nenhum default e nenhum match) — neste
 *      caso o caller deve assignar via pickLeastBusyAttendant(null) para
 *      garantir que a conversa não fica órfã
 */
function computeTargetDepartment(messageBody, lineId) {
  if (!hasAnyDepartment()) return null;

  // Prioridade 0: a linha de entrada tem um departamento fixo configurado
  if (lineId) {
    const line = db.prepare('SELECT department_id FROM lines WHERE id = ? AND active = 1').get(lineId);
    if (line?.department_id) return line.department_id;
  }

  const body = (messageBody || '').toLowerCase().trim();

  if (body) {
    const rules = db.prepare(`
      SELECT keyword, department_id FROM keyword_rules
      WHERE active = 1 AND department_id IS NOT NULL
      ORDER BY priority ASC, id ASC
    `).all();
    for (const r of rules) {
      const kw = (r.keyword || '').toLowerCase();
      if (kw && body.includes(kw)) return r.department_id;
    }
  }

  const def = db.prepare(
    'SELECT id FROM departments WHERE is_default = 1 AND active = 1 LIMIT 1'
  ).get();
  return def?.id || null;
}

/**
 * Escolhe o atendente disponível com menos conversas abertas.
 *
 * Critérios de disponibilidade (idênticos ao auto-assign legado em
 * whatsapp/client.js): role='attendant', status != 'offline', active=1,
 * on_shift=1.
 *
 * Se `departmentId` for um id válido, restringe aos membros desse
 * departamento (via user_departments). Se for null/undefined, considera
 * todos os atendentes (modo legacy).
 *
 * Retorna { id, load } do atendente escolhido, ou undefined se ninguém
 * disponível.
 */
function pickLeastBusyAttendant(departmentId) {
  if (departmentId) {
    return db.prepare(`
      SELECT u.id, COUNT(c.id) AS load
      FROM users u
      INNER JOIN user_departments ud ON ud.user_id = u.id AND ud.department_id = ?
      LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
      WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1 AND u.on_shift = 1
      GROUP BY u.id
      ORDER BY load ASC
      LIMIT 1
    `).get(departmentId);
  }
  return db.prepare(`
    SELECT u.id, COUNT(c.id) AS load
    FROM users u
    LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
    WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1 AND u.on_shift = 1
    GROUP BY u.id
    ORDER BY load ASC
    LIMIT 1
  `).get();
}

module.exports = {
  hasAnyDepartment,
  computeTargetDepartment,
  pickLeastBusyAttendant,
};
