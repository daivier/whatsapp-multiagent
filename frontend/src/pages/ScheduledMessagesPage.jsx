import { useState, useEffect, useCallback } from 'react';
import api from '../api';

function parseDate(str) {
  if (!str) return new Date(str);
  if (/[Z+]/.test(str.slice(-6))) return new Date(str);
  // Formato SQLite "YYYY-MM-DD HH:MM:SS" — UTC sem 'Z'
  if (!str.includes('T')) return new Date(str.replace(' ', 'T') + 'Z');
  // Formato ISO com T mas sem timezone (vem do datetime-local input) — já é hora local
  return new Date(str);
}

function fmtDateTime(str) {
  if (!str) return '—';
  return parseDate(str).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toInputValue(str) {
  if (!str) return '';
  // Se já está no formato datetime-local (sem timezone), devolver directamente
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str) && !/[Z+]/.test(str.slice(-6))) {
    return str.slice(0, 16);
  }
  const d = parseDate(str);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduledMessagesPage({ socket }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ body: '', scheduled_at: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, [showCancelled]);

  // Atualizar em tempo real quando o cron envia um agendamento
  useEffect(() => {
    if (!socket) return;
    function onScheduledSent({ id, sent_at }) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, sent_at } : i));
    }
    socket.on('scheduled:sent', onScheduledSent);
    return () => socket.off('scheduled:sent', onScheduledSent);
  }, [socket]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/scheduled-messages', {
        params: { show_cancelled: showCancelled ? '1' : '0' },
      });
      setItems(Array.isArray(data) ? data : []);
    } catch (_) {}
    setLoading(false);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({ body: item.body, scheduled_at: toInputValue(item.scheduled_at) });
    setError('');
  }

  function cancelEdit() { setEditingId(null); setError(''); }

  async function saveEdit(id) {
    if (!editForm.body.trim() || !editForm.scheduled_at) return;
    if (new Date(editForm.scheduled_at) <= new Date()) {
      setError('A data/hora deve ser no futuro');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch(`/scheduled-messages/${id}`, {
        body: editForm.body.trim(),
        scheduled_at: editForm.scheduled_at,
      });
      setItems(prev => prev.map(i => i.id === id ? { ...i, ...data } : i));
      setEditingId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao guardar');
    }
    setSaving(false);
  }

  async function cancel(id) {
    if (!confirm('Cancelar este agendamento?')) return;
    try {
      await api.delete(`/scheduled-messages/${id}`);
      setItems(prev => showCancelled
        ? prev.map(i => i.id === id ? { ...i, cancelled: 1 } : i)
        : prev.filter(i => i.id !== id)
      );
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao cancelar');
    }
  }

  const pending = items.filter(i => !i.sent_at && !i.cancelled);
  const sent    = items.filter(i => !!i.sent_at);
  const cancelled = items.filter(i => !!i.cancelled);

  return (
    <div style={S.page}>
      <div style={S.topBar}>
        <h2 style={S.title}>📅 Mensagens Agendadas</h2>
        <label style={S.toggle}>
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />
          <span style={{ marginLeft: '0.4rem', fontSize: '0.82rem', color: 'var(--muted)' }}>Mostrar canceladas</span>
        </label>
      </div>

      {loading ? (
        <p style={S.empty}>A carregar...</p>
      ) : items.length === 0 ? (
        <p style={S.empty}>Sem agendamentos</p>
      ) : (
        <div style={S.sections}>

          {/* PENDENTES */}
          {pending.length > 0 && (
            <section>
              <h3 style={S.sectionTitle}>⏳ Pendentes ({pending.length})</h3>
              <div style={S.list}>
                {pending.map(item => (
                  <div key={item.id} style={S.card}>
                    {editingId === item.id ? (
                      <div style={S.editForm}>
                        <div style={S.editRow}>
                          <label style={S.label}>Data e hora</label>
                          <input
                            type="datetime-local"
                            style={S.input}
                            value={editForm.scheduled_at}
                            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                            onChange={e => setEditForm(p => ({ ...p, scheduled_at: e.target.value }))}
                          />
                        </div>
                        <div style={S.editRow}>
                          <label style={S.label}>Mensagem</label>
                          <textarea
                            style={{ ...S.input, resize: 'vertical', minHeight: '72px' }}
                            value={editForm.body}
                            onChange={e => setEditForm(p => ({ ...p, body: e.target.value }))}
                          />
                        </div>
                        {error && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>{error}</p>}
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                          <button onClick={cancelEdit} style={S.btnOutline}>Cancelar</button>
                          <button onClick={() => saveEdit(item.id)} disabled={saving} style={S.btnPrimary}>
                            {saving ? 'A guardar...' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={S.cardTop}>
                          <div style={S.contactInfo}>
                            <span style={S.contactName}>{item.contact_name || item.wa_id}</span>
                            {item.contact_name && <span style={S.phone}>{item.wa_id?.replace('@s.whatsapp.net','').replace('@lid','')}</span>}
                          </div>
                          <span style={{ ...S.badge, background: 'var(--accent-l)', color: 'var(--accent)' }}>
                            🕐 {fmtDateTime(item.scheduled_at)}
                          </span>
                        </div>
                        <p style={S.body}>{item.body}</p>
                        <div style={S.actions}>
                          <button onClick={() => startEdit(item)} style={S.btnOutline}>✏️ Editar</button>
                          <button onClick={() => cancel(item.id)} style={S.btnDanger}>✕ Cancelar</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ENVIADAS */}
          {sent.length > 0 && (
            <section>
              <h3 style={S.sectionTitle}>✅ Enviadas ({sent.length})</h3>
              <div style={S.list}>
                {sent.map(item => (
                  <div key={item.id} style={{ ...S.card, opacity: 0.75 }}>
                    <div style={S.cardTop}>
                      <div style={S.contactInfo}>
                        <span style={S.contactName}>{item.contact_name || item.wa_id}</span>
                        {item.contact_name && <span style={S.phone}>{item.wa_id?.replace('@s.whatsapp.net','').replace('@lid','')}</span>}
                      </div>
                      <span style={{ ...S.badge, background: 'var(--success-l)', color: 'var(--success)' }}>
                        ✓ Enviada {fmtDateTime(item.sent_at)}
                      </span>
                    </div>
                    <p style={S.body}>{item.body}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* CANCELADAS */}
          {showCancelled && cancelled.length > 0 && (
            <section>
              <h3 style={S.sectionTitle}>✕ Canceladas ({cancelled.length})</h3>
              <div style={S.list}>
                {cancelled.map(item => (
                  <div key={item.id} style={{ ...S.card, opacity: 0.6 }}>
                    <div style={S.cardTop}>
                      <div style={S.contactInfo}>
                        <span style={S.contactName}>{item.contact_name || item.wa_id}</span>
                        {item.contact_name && <span style={S.phone}>{item.wa_id?.replace('@s.whatsapp.net','').replace('@lid','')}</span>}
                      </div>
                      <span style={{ ...S.badge, background: '#f3f4f6', color: 'var(--hint)' }}>
                        Agendado para {fmtDateTime(item.scheduled_at)}
                      </span>
                    </div>
                    <p style={S.body}>{item.body}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}

const S = {
  page: { flex: 1, overflowY: 'auto', padding: '1.5rem', background: 'var(--bg)' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' },
  title: { margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' },
  toggle: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  sections: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  sectionTitle: { fontSize: '0.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.6rem' },
  list: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  card: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.85rem 1rem', boxShadow: 'var(--sh)' },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.4rem', flexWrap: 'wrap' },
  contactInfo: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, overflow: 'hidden', flex: 1 },
  contactName: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' },
  phone: { fontSize: '0.75rem', color: 'var(--hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' },
  badge: { borderRadius: '999px', padding: '0.15rem 0.65rem', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 },
  body: { margin: '0 0 0.6rem', fontSize: '0.88rem', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  actions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' },
  editForm: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  editRow: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  label: { fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' },
  input: { padding: '0.4rem 0.6rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.85rem', background: 'var(--bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' },
  btnOutline: { padding: '0.3rem 0.75rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 500 },
  btnPrimary: { padding: '0.3rem 0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
  btnDanger: { padding: '0.3rem 0.75rem', background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500 },
  empty: { textAlign: 'center', color: 'var(--hint)', padding: '3rem', fontSize: '0.9rem' },
};
