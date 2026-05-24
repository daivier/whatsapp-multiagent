import { useEffect, useState } from 'react';
import api from '../api';

function fmtDate(s) {
  if (!s) return '—';
  const d = s.includes('T') ? new Date(s.endsWith('Z') ? s : s + 'Z') : new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StarRating({ score }) {
  if (score == null) return null;
  return (
    <span style={{ color: '#f59e0b', letterSpacing: '1px' }}>
      {'★'.repeat(Math.round(score))}{'☆'.repeat(5 - Math.round(score))}
    </span>
  );
}

const STATUS_BG = { waiting: '#fef3c7', open: '#d1fae5', closed: '#f3f4f6' };
const STATUS_FG = { waiting: '#b45309', open: '#047857', closed: '#6b7280' };
const STATUS_LBL = { waiting: 'Aguarda', open: 'Aberta', closed: 'Fechada' };

/**
 * Painel lateral com histórico 360 do contacto da conversa actual.
 * Aberto/fechado controlado pelo pai. Faz fetch quando abre e contactId muda.
 */
export default function ContactHistory({ open, contactId, onClose, onSelectConversation }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !contactId) return;
    setLoading(true);
    api.get(`/contacts/${contactId}/history`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, contactId]);

  if (!open) return null;

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <strong style={{ fontSize: '0.95rem' }}>📊 Histórico do contacto</strong>
        <button onClick={onClose} style={S.closeBtn}>✕</button>
      </div>

      {loading && <p style={{ padding: '1rem', color: 'var(--muted)' }}>A carregar...</p>}

      {!loading && data && (
        <div style={S.body}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{data.contact.name || data.contact.phone}</h3>
            {data.contact.email && <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>{data.contact.email}</p>}
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--hint)' }}>
              Cliente desde {fmtDate(data.stats.first_contact_at || data.contact.created_at)}
            </p>
          </div>

          {/* Stats em grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', padding: '0.75rem 1rem' }}>
            <Stat label="Conversas" value={data.stats.total_conversations} />
            <Stat label="Mensagens" value={data.stats.total_messages} />
            <Stat label="Activas" value={data.stats.active_conversations} color="#22c55e" />
            <Stat label="Fechadas" value={data.stats.closed_conversations} color="var(--muted)" />
          </div>

          {/* Avaliações */}
          {data.ratings.total > 0 && (
            <div style={{ padding: '0 1rem 0.75rem' }}>
              <div style={{ background: 'var(--bg)', padding: '0.6rem 0.75rem', borderRadius: 'var(--r-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>AVALIAÇÕES</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--hint)' }}>{data.ratings.total} no total</span>
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                  {data.ratings.avg_score?.toFixed(1) || '—'} <StarRating score={data.ratings.avg_score} />
                </div>
              </div>
            </div>
          )}

          {/* Tags acumuladas */}
          {data.tags.length > 0 && (
            <div style={{ padding: '0 1rem 0.75rem' }}>
              <p style={S.sectionLabel}>ETIQUETAS USADAS</p>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {data.tags.map(t => (
                  <span key={t.id} style={{ background: (t.color || '#6b7280') + '18', border: `1px solid ${(t.color || '#6b7280')}55`, color: t.color || '#6b7280', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 600 }}>
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Conversas anteriores */}
          <div style={{ padding: '0 1rem 1rem', overflowY: 'auto' }}>
            <p style={S.sectionLabel}>CONVERSAS ANTERIORES</p>
            {data.conversations.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--hint)', margin: 0 }}>Nenhuma conversa anterior</p>
            )}
            {data.conversations.map(c => (
              <div key={c.id}
                onClick={() => onSelectConversation?.(c)}
                style={{ padding: '0.55rem 0.65rem', borderRadius: 'var(--r-sm)', background: 'var(--bg)', marginBottom: '0.4rem', cursor: onSelectConversation ? 'pointer' : 'default', border: '1px solid transparent' }}
                onMouseEnter={e => onSelectConversation && (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 500 }}>
                    {fmtDate(c.updated_at)} · {c.message_count} msg
                  </span>
                  <span style={{ background: STATUS_BG[c.status] || 'var(--border)', color: STATUS_FG[c.status] || 'var(--muted)', borderRadius: '999px', padding: '0 6px', fontSize: '0.66rem', fontWeight: 600 }}>
                    {STATUS_LBL[c.status] || c.status}
                  </span>
                </div>
                {c.attendant_name && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>👤 {c.attendant_name}</span>
                    {c.department_name && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.department_color || '#6b7280' }} title={c.department_name} />
                    )}
                    {c.rating != null && <StarRating score={c.rating} />}
                  </div>
                )}
                {c.last_message && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.last_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !data && <p style={{ padding: '1rem', color: 'var(--danger)' }}>Erro a carregar histórico</p>}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg)', padding: '0.5rem 0.75rem', borderRadius: 'var(--r-md)' }}>
      <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted)' }}>{label.toUpperCase()}</p>
      <p style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 700, color: color || 'var(--text)' }}>{value ?? 0}</p>
    </div>
  );
}

const S = {
  panel: {
    position: 'fixed', top: 0, right: 0, bottom: 0, width: '340px', maxWidth: '90vw',
    background: 'var(--card)', borderLeft: '1px solid var(--border)',
    boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
    display: 'flex', flexDirection: 'column', zIndex: 250,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--card)',
  },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--muted)', padding: 0 },
  body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  sectionLabel: { margin: '0 0 0.4rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.05em' },
};
