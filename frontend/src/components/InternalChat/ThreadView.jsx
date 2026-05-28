import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import MessageItem from './MessageItem';
import MessageInput from './MessageInput';

function formatDateDivider(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a.includes('T') ? a : a.replace(' ', 'T') + 'Z');
  const db = new Date(b.includes('T') ? b : b.replace(' ', 'T') + 'Z');
  return da.toDateString() === db.toDateString();
}

export default function ThreadView({ thread, socket, onClose, onThreadUpdated, onChannelDeleted }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [replyTo, setReplyTo] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [muted, setMuted] = useState(!!thread?.muted);
  const [allUsers, setAllUsers] = useState([]);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  // Manage modal state
  const [showManage, setShowManage] = useState(false);
  const [manageForm, setManageForm] = useState({ name: '', member_ids: [] });
  const [managing, setManaging] = useState(false);
  const [manageError, setManageError] = useState('');
  const bottomRef = useRef(null);
  const topRef = useRef(null);
  const scrollRef = useRef(null);
  const typingTimerRef = useRef(null);
  const isAtBottomRef = useRef(true);

  const threadId = thread?.id;

  const loadMessages = useCallback(async (beforeId = null) => {
    if (!threadId) return;
    if (beforeId) setLoadingMore(true);
    else setLoading(true);

    try {
      const params = { limit: 50 };
      if (beforeId) params.before = beforeId;
      const { data } = await api.get(`/internal-chat/threads/${threadId}/messages`, { params });

      if (beforeId) {
        setMessages(prev => [...data, ...prev]);
        setHasMore(data.length === 50);
      } else {
        setMessages(data);
        setHasMore(data.length === 50);
        // Scroll to bottom
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'instant' }), 50);
      }
    } catch (_) {
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    setMessages([]);
    setReplyTo(null);
    setTypingUsers([]);
    setHasMore(true);
    setMuted(!!thread?.muted);
    loadMessages();

    // Mark as read
    api.post(`/internal-chat/threads/${threadId}/read`).catch(() => {});
  }, [threadId]);

  useEffect(() => {
    api.get('/internal-chat/users').then(r => setAllUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  // Infinite scroll (load more on scrolling to top)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (el.scrollTop < 80 && hasMore && !loadingMore && messages.length > 0) {
        const firstId = messages[0]?.id;
        if (firstId) loadMessages(firstId);
      }
    }
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingMore, messages, loadMessages]);

  // Socket events
  useEffect(() => {
    if (!socket || !threadId) return;

    const onMessage = ({ message, thread_id }) => {
      if (thread_id !== threadId) return;
      setMessages(prev => {
        if (prev.find(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      // Mark as read if we're looking at this thread
      api.post(`/internal-chat/threads/${threadId}/read`).catch(() => {});
      if (isAtBottomRef.current) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
      }
    };

    const onUpdated = ({ message }) => {
      setMessages(prev => prev.map(m => m.id === message.id ? message : m));
    };

    const onReaction = ({ message_id, thread_id, reactions }) => {
      if (thread_id !== threadId) return;
      setMessages(prev => prev.map(m => m.id === message_id ? { ...m, reactions } : m));
    };

    const onTyping = ({ thread_id, user_id, user_name }) => {
      if (thread_id !== threadId) return;
      if (user_id === user.id) return;
      setTypingUsers(prev => {
        if (prev.find(u => u.user_id === user_id)) return prev;
        return [...prev, { user_id, user_name }];
      });
      // Clear typing after 3s
      setTimeout(() => {
        setTypingUsers(prev => prev.filter(u => u.user_id !== user_id));
      }, 3000);
    };

    socket.on('internal:message', onMessage);
    socket.on('internal:message_updated', onUpdated);
    socket.on('internal:reaction', onReaction);
    socket.on('internal:typing', onTyping);

    return () => {
      socket.off('internal:message', onMessage);
      socket.off('internal:message_updated', onUpdated);
      socket.off('internal:reaction', onReaction);
      socket.off('internal:typing', onTyping);
    };
  }, [socket, threadId, user.id]);

  // Emit typing
  function handleTypingStart() {
    if (!socket || !threadId) return;
    socket.emit('internal:typing', { thread_id: threadId });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {}, 2500);
  }

  async function handleReaction(messageId, emoji) {
    try {
      await api.post(`/internal-chat/messages/${messageId}/react`, { emoji });
    } catch (_) {}
  }

  async function toggleMute() {
    try {
      const { data } = await api.patch(`/internal-chat/threads/${threadId}/mute`);
      setMuted(!!data.muted);
    } catch (_) {}
  }

  // Search
  async function doSearch(q) {
    if (!q.trim() || q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const { data } = await api.get('/internal-chat/search', { params: { q } });
      setSearchResults(Array.isArray(data) ? data.filter(r => r.thread_id === threadId) : []);
    } catch (_) {
    } finally {
      setSearchLoading(false);
    }
  }

  // Open manage modal
  async function openManage() {
    setManageError('');
    setManageForm({
      name: thread.name || '',
      member_ids: (thread.members || []).map(m => m.user_id),
    });
    // Refresh users list
    try {
      const { data } = await api.get('/internal-chat/users');
      setAllUsers(Array.isArray(data) ? data : []);
    } catch (_) {}
    setShowManage(true);
  }

  async function handleRename() {
    if (!manageForm.name.trim()) return;
    setManaging(true);
    setManageError('');
    try {
      const { data } = await api.patch(`/internal-chat/channels/${threadId}`, { name: manageForm.name.trim() });
      if (onThreadUpdated) onThreadUpdated(data);
      setShowManage(false);
    } catch (e) {
      setManageError(e?.response?.data?.error || 'Erro ao renomear canal');
    } finally {
      setManaging(false);
    }
  }

  async function handleSaveMembers() {
    setManaging(true);
    setManageError('');
    try {
      await api.put(`/internal-chat/channels/${threadId}/members`, { member_ids: manageForm.member_ids });
      // Reload thread data
      const { data } = await api.get(`/internal-chat/threads`);
      const updated = Array.isArray(data) ? data.find(t => t.id === threadId) : null;
      if (updated && onThreadUpdated) onThreadUpdated(updated);
      setShowManage(false);
    } catch (e) {
      setManageError(e?.response?.data?.error || 'Erro ao actualizar membros');
    } finally {
      setManaging(false);
    }
  }

  async function handleDeleteChannel() {
    if (!window.confirm(`Tens a certeza que queres apagar o canal "#${thread.name}"? Esta accao e irreversivel.`)) return;
    setManaging(true);
    setManageError('');
    try {
      await api.delete(`/internal-chat/channels/${threadId}`);
      setShowManage(false);
      if (onChannelDeleted) onChannelDeleted(threadId);
      if (onClose) onClose();
    } catch (e) {
      setManageError(e?.response?.data?.error || 'Erro ao apagar canal');
      setManaging(false);
    }
  }

  function getThreadTitle() {
    if (!thread) return '';
    if (thread.type === 'dm') {
      const other = thread.members?.find(m => m.user_id !== user.id);
      return other?.name || thread.display_name || 'DM';
    }
    return `# ${thread.name || 'Canal'}`;
  }

  function getThreadSubtitle() {
    if (!thread) return '';
    if (thread.type === 'channel') {
      const count = thread.members?.length || 0;
      return `${count} membro${count !== 1 ? 's' : ''}`;
    }
    if (thread.type === 'dm') {
      const other = thread.members?.find(m => m.user_id !== user.id);
      const status = other?.status || 'offline';
      const statusLabel = { online: 'Online', busy: 'Ocupado', away: 'Ausente', offline: 'Offline' }[status] || status;
      return statusLabel;
    }
    return '';
  }

  // Build message groups (group consecutive messages from same user)
  function buildGroups(msgs) {
    const groups = [];
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const prev = msgs[i - 1];
      const showAvatar = !prev
        || prev.from_user_id !== msg.from_user_id
        || (new Date(msg.created_at) - new Date(prev.created_at)) > 5 * 60 * 1000
        || msg.reply_to_id;
      const showDateDiv = !prev || !isSameDay(prev.created_at, msg.created_at);
      groups.push({ msg, showAvatar, showDateDiv });
    }
    return groups;
  }

  if (!thread) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '3rem' }}>💬</div>
        <div style={{ color: 'var(--muted)', fontSize: '1rem' }}>Selecciona uma conversa ou canal</div>
      </div>
    );
  }

  const groups = buildGroups(messages);
  const pinnedMsgs = messages.filter(m => m.pinned && !m.deleted);

  const S = {
    container: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0, overflow: 'hidden' },
    header: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', flexShrink: 0 },
    scroll: { flex: 1, overflowY: 'auto', padding: '0.5rem 0 0.25rem' },
    dateDivider: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600 },
    dateLine: { flex: 1, height: 1, background: 'var(--border)' },
    typingBar: { padding: '0.3rem 1rem 0.1rem', fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic', minHeight: '22px' },
    pinnedBanner: { padding: '0.4rem 1rem', background: 'var(--accent-l)', borderBottom: '1px solid var(--accent)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
    iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.9rem', padding: '0.3rem 0.5rem', borderRadius: '6px' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal: { background: 'var(--card)', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '480px', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
    section: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
    sectionTitle: { fontWeight: 700, fontSize: '0.85rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
    input: { padding: '0.5rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: '6px', fontSize: '0.875rem', background: 'var(--bg)', color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' },
    btn: { padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 },
    memberList: { maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.25rem 0' },
    memberItem: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', cursor: 'pointer' },
  };

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        {onClose && (
          <button onClick={onClose} style={{ ...S.iconBtn, fontSize: '1.1rem' }}>&#8592;</button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getThreadTitle()}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{getThreadSubtitle()}</div>
        </div>

        {/* Search toggle */}
        <button style={{ ...S.iconBtn, color: searchMode ? 'var(--accent)' : 'var(--muted)' }} onClick={() => { setSearchMode(v => !v); setSearchQuery(''); setSearchResults([]); }} title="Pesquisar mensagens">
          &#128269;
        </button>

        {/* Mute toggle */}
        <button style={{ ...S.iconBtn, color: muted ? 'var(--accent)' : 'var(--muted)' }} onClick={toggleMute} title={muted ? 'Activar notificacoes' : 'Silenciar'}>
          {muted ? '🔕' : '🔔'}
        </button>

        {/* Manage channel button -- only for channels and owners */}
        {thread.type === 'channel' && user.role === 'owner' && (
          <button style={S.iconBtn} onClick={openManage} title="Gerir canal">
            &#9881;&#65039;
          </button>
        )}
      </div>

      {/* Search bar */}
      {searchMode && (
        <div style={{ padding: '0.5rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); doSearch(e.target.value); }}
            placeholder="Pesquisar mensagens neste canal..."
            autoFocus
            style={{ flex: 1, padding: '0.4rem 0.7rem', border: '1px solid var(--border-m)', borderRadius: '6px', fontSize: '0.875rem', background: 'var(--bg)', color: 'var(--text)', outline: 'none' }}
          />
          {searchLoading && <span style={{ color: 'var(--muted)', fontSize: '0.8rem', alignSelf: 'center' }}>...</span>}
        </div>
      )}

      {/* Search results */}
      {searchMode && searchResults.length > 0 && (
        <div style={{ maxHeight: '240px', overflowY: 'auto', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ padding: '0.3rem 1rem', fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>{searchResults.length} resultado(s)</div>
          {searchResults.map(r => (
            <div key={r.id} style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{r.sender_name}</span>
              <span style={{ color: 'var(--muted)', marginLeft: '0.4rem', fontSize: '0.72rem' }}>{new Date(r.created_at.includes('T') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}</span>
              <div style={{ color: 'var(--text)', marginTop: '2px' }}>{r.body}</div>
            </div>
          ))}
        </div>
      )}
      {searchMode && searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', color: 'var(--hint)', fontSize: '0.82rem' }}>
          Sem resultados para &quot;{searchQuery}&quot;
        </div>
      )}

      {/* Pinned messages banner */}
      {pinnedMsgs.length > 0 && (
        <div style={S.pinnedBanner}>
          <span>&#128204;</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{pinnedMsgs.length} mensagem(s) fixada(s):</span>
          <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {pinnedMsgs[pinnedMsgs.length - 1].body?.substring(0, 80)}
          </span>
        </div>
      )}

      {/* Messages scroll area */}
      <div ref={scrollRef} style={S.scroll}>
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--hint)', fontSize: '0.85rem' }}>A carregar...</div>
        )}

        {!loading && hasMore && (
          <div style={{ textAlign: 'center', padding: '0.75rem' }}>
            <button onClick={() => loadMessages(messages[0]?.id)} disabled={loadingMore}
              style={{ background: 'none', border: '1px solid var(--border-m)', borderRadius: '6px', cursor: 'pointer', padding: '0.35rem 0.9rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
              {loadingMore ? 'A carregar...' : 'Carregar mais'}
            </button>
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--hint)', fontSize: '0.88rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>&#128075;</div>
            <div style={{ fontWeight: 600, color: 'var(--muted)', marginBottom: '0.25rem' }}>Inicio da conversa</div>
            <div>Se o primeiro a enviar uma mensagem!</div>
          </div>
        )}

        {groups.map(({ msg, showAvatar, showDateDiv }) => (
          <div key={msg.id}>
            {showDateDiv && (
              <div style={S.dateDivider}>
                <div style={S.dateLine} />
                <span>{formatDateDivider(msg.created_at)}</span>
                <div style={S.dateLine} />
              </div>
            )}
            <MessageItem
              message={msg}
              isOwn={msg.from_user_id === user.id}
              showAvatar={showAvatar}
              onReply={setReplyTo}
              onReactionChange={handleReaction}
              isOwner={user.role === 'owner'}
            />
          </div>
        ))}

        {/* Typing indicator */}
        <div style={S.typingBar}>
          {typingUsers.length > 0 && (
            <span>
              {typingUsers.map(u => u.user_name).join(', ')} {typingUsers.length === 1 ? 'esta a escrever' : 'estao a escrever'}...
            </span>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput
        threadId={threadId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        allUsers={allUsers}
        onMessageSent={(msg) => {
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
        }}
      />

      {/* Manage channel modal */}
      {showManage && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setShowManage(false); }}>
          <div style={S.modal}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Gerir Canal</h3>
              <button onClick={() => setShowManage(false)} style={{ ...S.iconBtn, fontSize: '1.1rem' }}>&#10005;</button>
            </div>

            {manageError && (
              <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                {manageError}
              </div>
            )}

            {/* Rename section */}
            <div style={S.section}>
              <div style={S.sectionTitle}>Renomear Canal</div>
              <input
                style={S.input}
                value={manageForm.name}
                onChange={e => setManageForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nome do canal"
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
              />
              <button
                style={{ ...S.btn, background: 'var(--accent)', color: '#fff', alignSelf: 'flex-start' }}
                onClick={handleRename}
                disabled={managing || !manageForm.name.trim()}
              >
                {managing ? 'A guardar...' : 'Guardar nome'}
              </button>
            </div>

            {/* Members section */}
            <div style={S.section}>
              <div style={S.sectionTitle}>Membros ({manageForm.member_ids.length} seleccionados)</div>
              <div style={S.memberList}>
                {allUsers.map(u => {
                  const checked = manageForm.member_ids.includes(u.id);
                  return (
                    <label key={u.id} style={S.memberItem}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setManageForm(f => ({
                            ...f,
                            member_ids: checked
                              ? f.member_ids.filter(id => id !== u.id)
                              : [...f.member_ids, u.id],
                          }));
                        }}
                      />
                      <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>{u.name}</span>
                      {u.role === 'owner' && <span style={{ fontSize: '0.72rem', color: 'var(--muted)', marginLeft: 'auto' }}>owner</span>}
                    </label>
                  );
                })}
              </div>
              <button
                style={{ ...S.btn, background: 'var(--accent)', color: '#fff', alignSelf: 'flex-start' }}
                onClick={handleSaveMembers}
                disabled={managing}
              >
                {managing ? 'A guardar...' : 'Guardar membros'}
              </button>
            </div>

            {/* Delete section */}
            <div style={{ ...S.section, borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={S.sectionTitle}>Zona de Perigo</div>
              <button
                style={{ ...S.btn, background: '#dc2626', color: '#fff', alignSelf: 'flex-start' }}
                onClick={handleDeleteChannel}
                disabled={managing}
              >
                &#128465; Apagar canal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
