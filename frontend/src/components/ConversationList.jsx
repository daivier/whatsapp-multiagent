import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const STATUS_LABEL = { waiting: 'Aguarda', open: 'Aberta', closed: 'Fechada' };
const STATUS_COLOR = { waiting: '#f59e0b', open: '#10b981', closed: '#6b7280' };

export default function ConversationList({ socket, selected, onSelect }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('open');

  useEffect(() => {
    load();
  }, [filter]);

  useEffect(() => {
    if (!socket) return;
    function handler({ conversation }) {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation?.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = conversation;
          return next;
        }
        return [conversation, ...prev];
      });
    }
    socket.on('message:new', handler);
    socket.on('message:incoming', handler);
    return () => { socket.off('message:new', handler); socket.off('message:incoming', handler); };
  }, [socket]);

  async function load() {
    const { data } = await api.get('/conversations', { params: { status: filter || undefined } });
    setConversations(data);
  }

  return (
    <div style={styles.container}>
      <div style={styles.filters}>
        {['open', 'waiting', 'closed', ''].map(s => (
          <button
            key={s}
            style={{ ...styles.filterBtn, ...(filter === s ? styles.filterActive : {}) }}
            onClick={() => setFilter(s)}
          >
            {s === '' ? 'Todas' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div style={styles.list}>
        {conversations.length === 0 && (
          <p style={styles.empty}>Nenhuma conversa</p>
        )}
        {conversations.map(conv => (
          <div
            key={conv.id}
            style={{ ...styles.item, ...(selected?.id === conv.id ? styles.itemSelected : {}) }}
            onClick={() => onSelect(conv)}
          >
            <div style={styles.avatar}>{(conv.contact_name || conv.phone)[0].toUpperCase()}</div>
            <div style={styles.info}>
              <div style={styles.topRow}>
                <strong style={styles.name}>{conv.contact_name || conv.phone}</strong>
                <span style={{ ...styles.status, color: STATUS_COLOR[conv.status] }}>
                  {STATUS_LABEL[conv.status]}
                </span>
              </div>
              {user.role === 'owner' && (
                <span style={styles.attendant}>{conv.attendant_name || 'Sem atendente'}</span>
              )}
              <span style={styles.phone}>{conv.phone}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', borderRight: '1px solid #e5e5e5' },
  filters: { display: 'flex', gap: '0.25rem', padding: '0.75rem', borderBottom: '1px solid #e5e5e5', flexWrap: 'wrap' },
  filterBtn: { padding: '0.3rem 0.75rem', borderRadius: '999px', border: '1px solid #ddd', background: 'none', cursor: 'pointer', fontSize: '0.8rem' },
  filterActive: { background: '#25D366', color: '#fff', border: '1px solid #25D366' },
  list: { flex: 1, overflowY: 'auto' },
  empty: { textAlign: 'center', color: '#999', padding: '2rem' },
  item: { display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', alignItems: 'center' },
  itemSelected: { background: '#e8f5e9' },
  avatar: { width: '40px', height: '40px', borderRadius: '50%', background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 },
  info: { flex: 1, minWidth: 0 },
  topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  status: { fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 },
  attendant: { display: 'block', fontSize: '0.75rem', color: '#888' },
  phone: { display: 'block', fontSize: '0.75rem', color: '#aaa' },
};
