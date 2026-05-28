import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const STATUS_COLOR = { online: '#22c55e', busy: '#f97316', away: '#eab308', offline: '#6b7280' };

function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(880, ctx.currentTime);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.35);
  } catch (_) {}
}

function showBrowserNotif(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: '/icon.svg', tag: 'internal-chat' });
    setTimeout(() => n.close(), 5000);
  } else if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

let titleInterval = null;
let originalTitle = document.title;
function flashTitle(msg) {
  if (titleInterval) return;
  originalTitle = document.title;
  let toggle = false;
  titleInterval = setInterval(() => {
    document.title = toggle ? '[Chat] ' + msg : originalTitle;
    toggle = !toggle;
  }, 1200);
  const stop = () => {
    clearInterval(titleInterval);
    titleInterval = null;
    document.title = originalTitle;
    window.removeEventListener('focus', stop);
  };
  window.addEventListener('focus', stop);
}

function Avatar({ name, size = 32, status }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#ef4444', '#06b6d4'];
  const color = colors[(name || '').charCodeAt(0) % colors.length];
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size * 0.38, fontWeight: 700 }}>
        {initials}
      </div>
      {status && (
        <div style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[status] || '#6b7280', border: '2px solid var(--card)' }} />
      )}
    </div>
  );
}

export default function ThreadList({ selectedThreadId, onSelectThread, socket, onUnreadChange }) {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState([]);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [channelForm, setChannelForm] = useState({ name: '', member_ids: [] });
  const [channelError, setChannelError] = useState('');
  const [creating, setCreating] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [userStatuses, setUserStatuses] = useState({});

  const loadThreads = useCallback(async () => {
    try {
      const params = adminView ? { admin: '1' } : {};
      const { data } = await api.get('/internal-chat/threads', { params });
      setThreads(Array.isArray(data) ? data : []);
      const total = (Array.isArray(data) ? data : []).reduce((s, t) => s + (t.unread_count || 0), 0);
      onUnreadChange?.(total);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [adminView, onUnreadChange]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const loadUsers = () => api.get('/internal-chat/users').then(r => setAllUsers(Array.isArray(r.data) ? r.data : [])).catch(e => console.error('[internal-chat] users error:', e));
  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    if (!socket) return;

    const onMessage = ({ thread_id, message, sender_name }) => {
      const isActive = thread_id === selectedThreadId && document.visibilityState === 'visible';
      if (!isActive && message?.from_user_id !== user.id) {
        setThreads(prev => {
          const thread = prev.find(t => t.id === thread_id);
          if (!thread?.muted) {
            const threadName = thread?.type === 'dm'
              ? (thread?.members?.find(m => m.user_id !== user.id)?.name || 'Chat')
              : (thread?.name || 'Chat');
            const msgBody = message?.body || (message?.media_url ? 'Ficheiro' : '...');
            const notifTitle = 'Nova msg de ' + (sender_name || 'Alguem');
            const notifBody = thread?.type === 'channel' ? '#' + threadName + ': ' + msgBody : msgBody;
            playPing();
            showBrowserNotif(notifTitle, notifBody);
            flashTitle(threadName);
          }
          return prev;
        });
      }
      setThreads(prev => {
        const updated = prev.map(t => {
          if (t.id !== thread_id) return t;
          const unread = t.id === selectedThreadId ? t.unread_count : (t.unread_count || 0) + 1;
          return { ...t, unread_count: unread };
        });
        onUnreadChange?.(updated.reduce((s, t) => s + (t.unread_count || 0), 0));
        return updated;
      });
      // Refresh thread list to get updated last_message
      loadThreads();
    };

    const onRead = ({ thread_id, user_id }) => {
      if (user_id !== user.id) return;
      setThreads(prev => {
        const updated = prev.map(t => t.id === thread_id ? { ...t, unread_count: 0 } : t);
        onUnreadChange?.(updated.reduce((s, t) => s + (t.unread_count || 0), 0));
        return updated;
      });
    };

    const onNewThread = (thread) => {
      setThreads(prev => {
        if (prev.find(t => t.id === thread.id)) return prev;
        return [thread, ...prev];
      });
    };

    const onUserStatus = ({ userId, status }) => {
      setUserStatuses(prev => ({ ...prev, [userId]: status }));
    };

    socket.on('internal:message', onMessage);
    socket.on('internal:read', onRead);
    socket.on('internal:thread_new', onNewThread);
    socket.on('user:status', onUserStatus);

    return () => {
      socket.off('internal:message', onMessage);
      socket.off('internal:read', onRead);
      socket.off('internal:thread_new', onNewThread);
      socket.off('user:status', onUserStatus);
    };
  }, [socket, selectedThreadId, user.id, loadThreads, onUnreadChange]);

  async function startDM(targetUser) {
    setCreating(true);
    try {
      const { data } = await api.post('/internal-chat/threads/dm', { userId: targetUser.id });
      setThreads(prev => {
        if (prev.find(t => t.id === data.id)) return prev;
        return [data, ...prev];
      });
      onSelectThread(data);
      setShowNewDM(false);
      setDmSearch('');
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao criar DM');
    } finally {
      setCreating(false);
    }
  }

  async function createChannel(e) {
    e.preventDefault();
    setChannelError('');
    if (!channelForm.name.trim()) return setChannelError('Nome obrigatório');
    setCreating(true);
    try {
      const { data } = await api.post('/internal-chat/channels', {
        name: channelForm.name.trim(),
        member_ids: channelForm.member_ids,
      });
      setThreads(prev => [data, ...prev]);
      onSelectThread(data);
      setShowNewChannel(false);
      setChannelForm({ name: '', member_ids: [] });
    } catch (e) {
      setChannelError(e.response?.data?.error || 'Erro ao criar canal');
    } finally {
      setCreating(false);
    }
  }

  const dms = threads.filter(t => t.type === 'dm');
  const channels = threads.filter(t => t.type === 'channel');

  const filteredDMUsers = allUsers.filter(u => {
    if (u.id === user.id) return false;
    const q = dmSearch.toLowerCase();
    return !q || u.name.toLowerCase().includes(q);
  });

  function getThreadStatus(t) {
    if (t.type !== 'dm') return null;
    const other = t.members?.find(m => m.user_id !== user.id);
    if (!other) return null;
    return userStatuses[other.user_id] || other.status || 'offline';
  }

  function getThreadDisplayName(t) {
    if (t.type === 'dm') {
      const other = t.members?.find(m => m.user_id !== user.id);
      return other?.name || t.display_name || 'DM';
    }
    return t.name || 'Canal';
  }

  const S = {
    container: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--card)', borderRight: '1px solid var(--border)' },
    header: { padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' },
    title: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)', margin: 0 },
    scroll: { flex: 1, overflowY: 'auto' },
    section: { padding: '0.5rem 0.75rem 0.25rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    addBtn: { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '2px 4px', borderRadius: '4px' },
    item: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.75rem', cursor: 'pointer', borderRadius: '6px', margin: '1px 0.5rem', transition: 'background 0.1s' },
    itemActive: { background: 'var(--accent-l)' },
    itemName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' },
    itemNameUnread: { fontWeight: 700, color: 'var(--text)' },
    itemMeta: { fontSize: '0.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' },
    badge: { background: 'var(--accent)', color: '#fff', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px', minWidth: '18px', textAlign: 'center', flexShrink: 0 },
    iconBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', padding: '0.3rem 0.6rem', fontWeight: 600 },
    input: { width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--border-m)', borderRadius: '6px', fontSize: '0.85rem', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal: { background: 'var(--card)', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '360px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
    modalTitle: { margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' },
  };

  return (
    <div style={S.container}>
      <div style={S.header}>
        <p style={S.title}>Chat interno</p>
        {user.role === 'owner' && (
          <button
            style={{ ...S.iconBtn, background: adminView ? 'var(--accent)' : 'var(--accent-l)', color: adminView ? '#fff' : 'var(--accent)', fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
            onClick={() => setAdminView(v => !v)}
            title="Ver todas as threads (admin)"
          >
            Admin
          </button>
        )}
      </div>

      <div style={S.scroll}>
        {/* Channels */}
        <div style={S.section}>
          <span>Canais</span>
          {user.role === 'owner' && (
            <button style={S.addBtn} onClick={() => { loadUsers(); setShowNewChannel(true); }} title="Novo canal">+</button>
          )}
        </div>
        {channels.length === 0 && !loading && (
          <div style={{ padding: '0.4rem 1rem', color: 'var(--hint)', fontSize: '0.8rem' }}>Sem canais</div>
        )}
        {channels.map(t => {
          const isActive = t.id === selectedThreadId;
          const hasUnread = t.unread_count > 0;
          const lastMsg = t.last_message;
          return (
            <div key={t.id}
              style={{ ...S.item, ...(isActive ? S.itemActive : {}) }}
              onClick={() => onSelectThread(t)}
            >
              <div style={{ width: 28, height: 28, borderRadius: '6px', background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, flexShrink: 0 }}>
                #
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...S.itemName, ...(hasUnread ? S.itemNameUnread : {}) }}>{t.name || 'Canal'}</div>
                {lastMsg && (
                  <div style={S.itemMeta}>
                    {lastMsg.deleted ? 'Mensagem apagada' : (lastMsg.body || (lastMsg.media_url ? 'Ficheiro' : ''))}
                  </div>
                )}
              </div>
              {hasUnread && <span style={S.badge}>{t.unread_count > 99 ? '99+' : t.unread_count}</span>}
              {t.muted ? <span title="Silenciado" style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>muted</span> : null}
            </div>
          );
        })}

        {/* DMs */}
        <div style={{ ...S.section, marginTop: '0.5rem' }}>
          <span>Mensagens Directas</span>
          <button style={S.addBtn} onClick={() => { loadUsers(); setShowNewDM(true); }} title="Nova mensagem directa">+</button>
        </div>
        {dms.length === 0 && !loading && (
          <div style={{ padding: '0.4rem 1rem', color: 'var(--hint)', fontSize: '0.8rem' }}>Sem DMs</div>
        )}
        {dms.map(t => {
          const isActive = t.id === selectedThreadId;
          const hasUnread = t.unread_count > 0;
          const status = getThreadStatus(t);
          const displayName = getThreadDisplayName(t);
          const lastMsg = t.last_message;
          return (
            <div key={t.id}
              style={{ ...S.item, ...(isActive ? S.itemActive : {}) }}
              onClick={() => onSelectThread(t)}
            >
              <Avatar name={displayName} size={28} status={status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...S.itemName, ...(hasUnread ? S.itemNameUnread : {}) }}>{displayName}</div>
                {lastMsg && (
                  <div style={S.itemMeta}>
                    {lastMsg.deleted ? 'Mensagem apagada' : (lastMsg.body || (lastMsg.media_url ? 'Ficheiro' : ''))}
                  </div>
                )}
              </div>
              {hasUnread && <span style={S.badge}>{t.unread_count > 99 ? '99+' : t.unread_count}</span>}
              {t.muted ? <span title="Silenciado" style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>muted</span> : null}
            </div>
          );
        })}

        {loading && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--hint)', fontSize: '0.82rem' }}>A carregar...</div>
        )}
      </div>

      {/* New DM Modal */}
      {showNewDM && (
        <div style={S.overlay} onClick={() => { setShowNewDM(false); setDmSearch(''); }}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={S.modalTitle}>Nova mensagem directa</h3>
              <button onClick={() => { setShowNewDM(false); setDmSearch(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.1rem' }}>X</button>
            </div>
            <input
              style={S.input}
              placeholder="Pesquisar utilizador..."
              value={dmSearch}
              onChange={e => setDmSearch(e.target.value)}
              autoFocus
            />
            <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {filteredDMUsers.length === 0 && (
                <div style={{ color: 'var(--hint)', fontSize: '0.85rem', padding: '0.5rem' }}>Sem resultados</div>
              )}
              {filteredDMUsers.map(u => (
                <div key={u.id}
                  onClick={() => !creating && startDM(u)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.4rem', borderRadius: '8px', cursor: creating ? 'not-allowed' : 'pointer', background: 'transparent', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Avatar name={u.name} size={30} status={userStatuses[u.id] || u.status} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text)' }}>{u.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{u.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New Channel Modal */}
      {showNewChannel && (
        <div style={S.overlay} onClick={() => { setShowNewChannel(false); setChannelForm({ name: '', member_ids: [] }); setChannelError(''); }}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={S.modalTitle}>Novo canal</h3>
              <button onClick={() => setShowNewChannel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.1rem' }}>X</button>
            </div>
            <form onSubmit={createChannel} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Nome do canal</label>
                <input
                  style={S.input}
                  placeholder="ex: suporte, vendas..."
                  value={channelForm.name}
                  onChange={e => setChannelForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Adicionar membros</label>
                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-m)', borderRadius: '6px', background: 'var(--bg)' }}>
                  {allUsers.filter(u => u.id !== user.id).map(u => (
                    <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                      <input
                        type="checkbox"
                        checked={channelForm.member_ids.includes(u.id)}
                        onChange={e => setChannelForm(f => ({
                          ...f,
                          member_ids: e.target.checked ? [...f.member_ids, u.id] : f.member_ids.filter(id => id !== u.id),
                        }))}
                      />
                      <Avatar name={u.name} size={22} />
                      <span style={{ color: 'var(--text)' }}>{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              {channelError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', margin: 0 }}>{channelError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowNewChannel(false)}
                  style={{ padding: '0.4rem 0.9rem', border: '1px solid var(--border-m)', borderRadius: '6px', cursor: 'pointer', background: 'none', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={creating}
                  style={{ padding: '0.4rem 0.9rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: creating ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                  {creating ? 'A criar...' : 'Criar canal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
