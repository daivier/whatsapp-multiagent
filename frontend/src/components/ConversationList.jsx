import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const STATUS_LABEL = { waiting: 'Aguarda', open: 'Aberta', closed: 'Fechada' };
const STATUS_COLOR = { waiting: 'var(--warn)', open: 'var(--success)', closed: 'var(--hint)' };
const STATUS_BG    = { waiting: 'var(--warn-l)', open: 'var(--success-l)', closed: '#f3f4f6' };

export default function ConversationList({ socket, selected, onSelect }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('open');

  useEffect(() => { load(); }, [filter]);

  useEffect(() => {
    if (!socket) return;
    function handler({ conversation }) {
      if (user.role === 'attendant' && conversation?.assigned_to !== user.id) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation?.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = conversation; return next; }
        return [conversation, ...prev];
      });
    }
    socket.on('message:new', handler);
    socket.on('message:incoming', handler);
    return () => { socket.off('message:new', handler); socket.off('message:incoming', handler); };
  }, [socket]);

  async function load() {
    const { data } = await api.get('/conversations', { params: { status: filter || undefined } });
    setConversations(Array.isArray(data) ? data : []);
  }

  const FILTERS = [['open','Abertas'],['waiting','Aguarda'],['closed','Fechadas'],['','Todas']];

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span style={S.headerTitle}>Conversas</span>
        <span style={S.count}>{conversations.length}</span>
      </div>
      <div style={S.filters}>
        {FILTERS.map(([val, label]) => (
          <button key={val} style={{ ...S.filterBtn, ...(filter === val ? S.filterActive : {}) }}
            onClick={() => setFilter(val)}>{label}</button>
        ))}
      </div>
      <div style={S.list}>
        {conversations.length === 0 && <p style={S.empty}>Nenhuma conversa</p>}
        {conversations.map(conv => {
          const isSelected = selected?.id === conv.id;
          const initial = (conv.contact_name || conv.phone || '?')[0].toUpperCase();
          return (
            <div key={conv.id} style={{ ...S.item, ...(isSelected ? S.itemActive : {}) }} onClick={() => onSelect(conv)}>
              <div style={{ ...S.avatar, background: isSelected ? 'var(--accent)' : 'var(--accent-l)', color: isSelected ? '#fff' : 'var(--accent)' }}>
                {initial}
              </div>
              <div style={S.info}>
                <div style={S.row}>
                  <span style={S.name}>{conv.contact_name || conv.phone}</span>
                  <span style={{ ...S.badge, background: STATUS_BG[conv.status], color: STATUS_COLOR[conv.status] }}>
                    {STATUS_LABEL[conv.status]}
                  </span>
                </div>
                {user.role === 'owner' && (
                  <span style={S.sub}>{conv.attendant_name || 'Sem atendente'}</span>
                )}
                <span style={S.phone}>{conv.phone}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--card)', borderRight: '1px solid var(--border)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1rem 0.5rem', gap: '0.5rem' },
  headerTitle: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' },
  count: { background: 'var(--accent-l)', color: 'var(--accent)', borderRadius: '20px', padding: '1px 8px', fontSize: '0.75rem', fontWeight: 600 },
  filters: { display: 'flex', gap: '0.25rem', padding: '0.5rem 1rem 0.75rem', flexWrap: 'wrap' },
  filterBtn: { padding: '0.25rem 0.65rem', borderRadius: '20px', border: '1px solid var(--border-m)', background: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 },
  filterActive: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  list: { flex: 1, overflowY: 'auto' },
  empty: { textAlign: 'center', color: 'var(--hint)', padding: '2rem', fontSize: '0.85rem' },
  item: { display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', alignItems: 'center', transition: 'background .1s' },
  itemActive: { background: 'var(--accent-l)' },
  avatar: { width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem', flexShrink: 0, transition: 'all .1s' },
  info: { flex: 1, minWidth: 0 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' },
  name: { fontSize: '0.875rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' },
  badge: { borderRadius: '20px', padding: '1px 7px', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 },
  sub: { display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginTop: '1px' },
  phone: { display: 'block', fontSize: '0.72rem', color: 'var(--hint)' },
};
