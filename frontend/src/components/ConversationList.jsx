import { useEffect, useState, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const STATUS_LABEL = { waiting: 'Aguarda', open: 'Aberta', closed: 'Fechada' };
const STATUS_COLOR = { waiting: 'var(--warn)', open: 'var(--success)', closed: 'var(--hint)' };
const STATUS_BG    = { waiting: 'var(--warn-l)', open: 'var(--success-l)', closed: '#f3f4f6' };

function formatWait(dateStr) {
  if (!dateStr) return null;
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return { label: `${diff}s`, level: 'ok' };
  if (diff < 3600) { const m = Math.floor(diff / 60); return { label: `${m}min`, level: m < 10 ? 'ok' : m < 30 ? 'warn' : 'danger' }; }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return { label: `${h}h`, level: 'danger' }; }
  return { label: `${Math.floor(diff / 86400)}d`, level: 'danger' };
}

const WAIT_COLORS = { ok: 'var(--success)', warn: 'var(--warn)', danger: 'var(--danger)' };
const WAIT_BGS    = { ok: 'var(--success-l)', warn: 'var(--warn-l)', danger: 'var(--danger-l)' };

export default function ConversationList({ socket, selected, onSelect }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('open');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  useEffect(() => { load(); }, [filter]);

  useEffect(() => {
    if (!socket) return;

    function onNewMessage({ conversation }) {
      if (user.role === 'attendant' && conversation?.assigned_to !== user.id) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation?.id);
        if (idx >= 0) {
          const next = [...prev];
          const wasSelected = selected?.id === conversation?.id;
          next[idx] = { ...conversation, unread_count: wasSelected ? 0 : (next[idx].unread_count || 0) + 1 };
          return next;
        }
        return [{ ...conversation, unread_count: 1 }, ...prev];
      });
    }

    function onConversationUpdated(conversation) {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation.id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...conversation };
        return next;
      });
    }

    socket.on('message:new', onNewMessage);
    socket.on('message:incoming', onNewMessage);
    socket.on('conversation:updated', onConversationUpdated);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:incoming', onNewMessage);
      socket.off('conversation:updated', onConversationUpdated);
    };
  }, [socket, selected]);

  useEffect(() => {
    if (!selected) return;
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, unread_count: 0 } : c));
  }, [selected?.id]);

  async function load() {
    const { data } = await api.get('/conversations', { params: { status: filter || undefined } });
    setConversations(Array.isArray(data) ? data : []);
  }

  function handleSearch(val) {
    setSearchQ(val);
    clearTimeout(searchTimer.current);
    if (!val.trim() || val.trim().length < 2) { setSearchResults(null); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/search', { params: { q: val.trim() } });
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (_) { setSearchResults([]); }
      setSearching(false);
    }, 350);
  }

  function clearSearch() { setSearchQ(''); setSearchResults(null); setSearching(false); }

  const FILTERS = [['open','Abertas'],['waiting','Aguarda'],['closed','Fechadas'],['','Todas']];

  const isSearching = searchResults !== null;

  return (
    <div style={S.wrap}>
      {/* Search bar */}
      <div style={S.searchBar}>
        <span style={S.searchIcon}>🔍</span>
        <input
          style={S.searchInput}
          placeholder="Pesquisar conversas e mensagens..."
          value={searchQ}
          onChange={e => handleSearch(e.target.value)}
        />
        {searchQ && <button onClick={clearSearch} style={S.searchClear}>✕</button>}
      </div>

      {!isSearching && (
        <>
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
        </>
      )}

      <div style={S.list}>
        {/* SEARCH RESULTS */}
        {isSearching && (
          <>
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>
              {searching ? 'A pesquisar...' : `${searchResults.length} resultado(s)`}
            </div>
            {searchResults.map((r, i) => {
              const initial = (r.contact_name || r.phone || '?')[0].toUpperCase();
              const fakeConv = { id: r.conversation_id, contact_name: r.contact_name, phone: r.phone, status: r.status, attendant_name: r.attendant_name, updated_at: r.updated_at };
              return (
                <div key={`${r.match_type}-${r.conversation_id}-${i}`} style={S.item} onClick={() => { onSelect(fakeConv); clearSearch(); }}>
                  <div style={{ ...S.avatar, background: 'var(--accent-l)', color: 'var(--accent)' }}>{initial}</div>
                  <div style={S.info}>
                    <div style={S.row}>
                      <span style={{ ...S.name, fontWeight: 600 }}>{r.contact_name || r.phone}</span>
                      <span style={{ ...S.badge, background: STATUS_BG[r.status], color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    {r.match_type === 'message' && r.message_body && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        💬 {r.message_body}
                      </span>
                    )}
                    <span style={S.phone}>{r.phone}</span>
                  </div>
                </div>
              );
            })}
            {!searching && searchResults.length === 0 && <p style={S.empty}>Sem resultados</p>}
          </>
        )}

        {/* NORMAL LIST */}
        {!isSearching && (
          <>
            {conversations.length === 0 && <p style={S.empty}>Nenhuma conversa</p>}
            {conversations.map(conv => {
              const isSelected = selected?.id === conv.id;
              const initial = (conv.contact_name || conv.phone || '?')[0].toUpperCase();
              const unread = conv.unread_count || 0;
              const wait = (conv.status !== 'closed') ? formatWait(conv.last_client_at) : null;
              return (
                <div key={conv.id} style={{ ...S.item, ...(isSelected ? S.itemActive : {}) }} onClick={() => onSelect(conv)}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{ ...S.avatar, background: isSelected ? 'var(--accent)' : 'var(--accent-l)', color: isSelected ? '#fff' : 'var(--accent)' }}>
                      {initial}
                    </div>
                    {unread > 0 && !isSelected && (
                      <span style={S.unreadBadge}>{unread > 99 ? '99+' : unread}</span>
                    )}
                  </div>
                  <div style={S.info}>
                    <div style={S.row}>
                      <span style={{ ...S.name, fontWeight: unread > 0 && !isSelected ? 700 : 600 }}>
                        {conv.contact_name || conv.phone}
                      </span>
                      <span style={{ ...S.badge, background: STATUS_BG[conv.status], color: STATUS_COLOR[conv.status] }}>
                        {STATUS_LABEL[conv.status]}
                      </span>
                    </div>
                    {user.role === 'owner' && (
                      <span style={S.sub}>{conv.attendant_name || 'Sem atendente'}</span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={S.phone}>{conv.phone}</span>
                      {wait && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, background: WAIT_BGS[wait.level], color: WAIT_COLORS[wait.level], borderRadius: '4px', padding: '0 4px' }}>
                          ⏱ {wait.label}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--card)', borderRight: '1px solid var(--border)' },
  searchBar: { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg)' },
  searchIcon: { fontSize: '0.85rem', color: 'var(--hint)', flexShrink: 0 },
  searchInput: { flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: '0.83rem', color: 'var(--text)', minWidth: 0 },
  searchClear: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--hint)', fontSize: '0.85rem', padding: 0, flexShrink: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem 0.25rem', gap: '0.5rem' },
  headerTitle: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' },
  count: { background: 'var(--accent-l)', color: 'var(--accent)', borderRadius: '20px', padding: '1px 8px', fontSize: '0.75rem', fontWeight: 600 },
  filters: { display: 'flex', gap: '0.25rem', padding: '0.4rem 1rem 0.6rem', flexWrap: 'wrap' },
  filterBtn: { padding: '0.25rem 0.65rem', borderRadius: '20px', border: '1px solid var(--border-m)', background: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 },
  filterActive: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  list: { flex: 1, overflowY: 'auto' },
  empty: { textAlign: 'center', color: 'var(--hint)', padding: '2rem', fontSize: '0.85rem' },
  item: { display: 'flex', gap: '0.75rem', padding: '0.65rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', alignItems: 'center', transition: 'background .1s' },
  itemActive: { background: 'var(--accent-l)' },
  avatar: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.88rem', transition: 'all .1s' },
  unreadBadge: { position: 'absolute', top: -4, right: -4, background: 'var(--danger)', color: '#fff', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 700, padding: '0 4px', minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  info: { flex: 1, minWidth: 0 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' },
  name: { fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' },
  badge: { borderRadius: '20px', padding: '1px 7px', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 },
  sub: { display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginTop: '1px' },
  phone: { display: 'block', fontSize: '0.72rem', color: 'var(--hint)' },
};
