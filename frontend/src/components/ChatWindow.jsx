import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || '';

function parseVcard(vcf) {
  const fn = vcf.match(/FN[^:]*:(.+)/)?.[1]?.trim() || 'Contacto';
  const tel = vcf.match(/TEL[^:]*:(.+)/)?.[1]?.trim() || '';
  return { fn, tel };
}

function MessageContent({ msg }) {
  if (msg.media_type === 'vcard') {
    const { fn, tel } = parseVcard(msg.body || '');
    return (
      <div style={{ background: 'rgba(0,0,0,0.05)', borderRadius: '8px', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.5rem' }}>👤</span>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{fn}</p>
          {tel && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{tel}</p>}
        </div>
      </div>
    );
  }
  if (msg.media_url && msg.media_type?.startsWith('image/')) {
    return (
      <>
        <img src={`${API}${msg.media_url}`} alt="imagem"
          style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', display: 'block', cursor: 'pointer', marginBottom: msg.body ? '0.25rem' : 0 }}
          onClick={() => window.open(`${API}${msg.media_url}`, '_blank')} />
        {msg.body && <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{msg.body}</p>}
      </>
    );
  }
  if (msg.media_url && msg.media_type?.startsWith('audio/')) {
    return <audio controls src={`${API}${msg.media_url}`} style={{ maxWidth: '100%', display: 'block' }} />;
  }
  if (msg.media_url && msg.media_type?.startsWith('video/')) {
    return (
      <>
        <video controls src={`${API}${msg.media_url}`} style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', display: 'block' }} />
        {msg.body && <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{msg.body}</p>}
      </>
    );
  }
  if (msg.media_url) {
    return <a href={`${API}${msg.media_url}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>📎 Abrir ficheiro</a>;
  }
  return <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{msg.body}</p>;
}

export default function ChatWindow({ conversation, socket, onClose, onDelete }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState('');
  const [typers, setTypers] = useState({});
  const [quickReplies, setQuickReplies] = useState([]);
  const [qrSuggestions, setQrSuggestions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [isInternal, setIsInternal] = useState(false);
  const [allTags, setAllTags] = useState([]);
  const [convTags, setConvTags] = useState([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleBody, setScheduleBody] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const typingTimer = useRef(null);
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    api.get('/quick-replies').then(r => setQuickReplies(Array.isArray(r.data) ? r.data : []));
    api.get('/tags').then(r => setAllTags(Array.isArray(r.data) ? r.data : []));
  }, []);

  useEffect(() => {
    if (!conversation) return;
    api.get(`/conversations/${conversation.id}/messages`).then(r => setMessages(Array.isArray(r.data) ? r.data : []));
    api.get(`/tags/conversations/${conversation.id}`).then(r => setConvTags(Array.isArray(r.data) ? r.data : []));
    socket?.emit('conv:join', { conversation_id: conversation.id });
    setIsInternal(false);
    setShowTagPicker(false);
    isFirstLoad.current = true;
    return () => socket?.emit('conv:leave', { conversation_id: conversation.id });
  }, [conversation]);

  useEffect(() => {
    if (!socket || !conversation) return;
    function onMessage({ message, conversation: conv }) {
      const convId = conv?.id ?? message?.conversation_id;
      if (convId !== conversation?.id) return;
      if (message.from_me) return;
      setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
    }
    function onTyping({ userId, name, typing, conversation_id }) {
      if (conversation_id !== conversation.id) return;
      setTypers(prev => { const next = { ...prev }; if (typing) next[userId] = name; else delete next[userId]; return next; });
    }
    socket.on('message:new', onMessage);
    socket.on('typing:update', onTyping);
    return () => { socket.off('message:new', onMessage); socket.off('typing:update', onTyping); };
  }, [socket, conversation]);

  useEffect(() => {
    // Aguarda o browser terminar o paint antes de scrollar
    requestAnimationFrame(() => {
      if (!messagesRef.current) return;
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
  }, [messages]);

  async function loadHistory() {
    if (!conversation) return;
    const r = await api.get(`/conversations/contact/${conversation.phone}`);
    setHistory(Array.isArray(r.data) ? r.data.filter(c => c.id !== conversation.id) : []);
    setShowHistory(true);
  }

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setWarning('');
    const body = text;
    setText('');

    if (isInternal) {
      try {
        const r = await api.post(`/conversations/${conversation.id}/notes`, { body });
        setMessages(prev => [...prev, r.data]);
      } catch (err) {
        setWarning(err.response?.data?.error || 'Erro ao guardar nota');
        setText(body);
      }
      setSending(false);
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const tempMsg = { id: tempId, conversation_id: conversation.id, from_me: 1, body, timestamp: new Date().toISOString(), sender_name: user.name };
    setMessages(prev => [...prev, tempMsg]);

    socket.emit('message:send', { conversation_id: conversation.id, body }, (res) => {
      setSending(false);
      if (res?.message) {
        setMessages(prev => prev.map(m => m.id === tempId ? res.message : m));
      } else if (res?.error) {
        setWarning(res.error);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true } : m));
        setText(body);
      }
    });
  }

  function handleTyping(e) {
    const val = e.target.value;
    setText(val);
    if (val.startsWith('/')) {
      const q = val.slice(1).toLowerCase();
      setQrSuggestions(quickReplies.filter(r => r.shortcut.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)));
    } else {
      setQrSuggestions([]);
    }
    if (!socket || !conversation || isInternal) return;
    socket.emit('typing:start', { conversation_id: conversation.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('typing:stop', { conversation_id: conversation.id }), 2000);
  }

  function applyQuickReply(qr) {
    setText(qr.body);
    setQrSuggestions([]);
  }

  async function saveSchedule() {
    if (!scheduleBody.trim() || !scheduleAt) return;
    setScheduleSaving(true);
    try {
      await api.post('/scheduled-messages', {
        conversation_id: conversation.id,
        wa_id: conversation.wa_id || conversation.phone,
        body: scheduleBody,
        scheduled_at: scheduleAt,
      });
      setShowSchedule(false);
      setScheduleBody('');
      setScheduleAt('');
      setWarning('');
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao agendar');
    }
    setScheduleSaving(false);
  }

  async function toggleTag(tag) {
    const has = convTags.some(t => t.id === tag.id);
    if (has) {
      await api.delete(`/tags/conversations/${conversation.id}/${tag.id}`);
      setConvTags(prev => prev.filter(t => t.id !== tag.id));
    } else {
      await api.post(`/tags/conversations/${conversation.id}`, { tag_id: tag.id });
      setConvTags(prev => [...prev, tag]);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') setQrSuggestions([]);
  }

  const typerNames = Object.values(typers).filter(Boolean);

  if (!conversation) {
    return (
      <div style={S.empty}>
        <div style={S.emptyInner}>
          <span style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>💬</span>
          <p style={{ color: 'var(--hint)', fontSize: '0.9rem' }}>Seleciona uma conversa para começar</p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>{conversation.contact_name || conversation.phone}</strong>
            {convTags.map(t => (
              <span key={t.id} style={{ background: t.color + '18', border: `1px solid ${t.color}55`, color: t.color, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', fontWeight: 600 }}>{t.name}</span>
            ))}
          </div>
          <span style={S.phone}>{conversation.phone}</span>
        </div>
        <div style={S.headerActions}>
          {user.role === 'owner' && (
            <span style={S.attendantBadge}>{conversation.attendant_name || 'Sem atendente'}</span>
          )}
          <div style={{ position: 'relative' }}>
            <button style={S.iconBtn} onClick={() => setShowTagPicker(v => !v)} title="Etiquetas">🏷️</button>
            {showTagPicker && (
              <div style={S.tagPicker}>
                {allTags.length === 0 && <p style={{ margin: 0, color: 'var(--hint)', fontSize: '0.8rem' }}>Sem etiquetas criadas</p>}
                {allTags.map(t => {
                  const active = convTags.some(ct => ct.id === t.id);
                  return (
                    <div key={t.id} onClick={() => toggleTag(t)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', borderRadius: 'var(--r-sm)', background: active ? t.color + '15' : 'none', transition: 'background .1s' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.85rem', flex: 1, color: 'var(--text)' }}>{t.name}</span>
                      {active && <span style={{ color: t.color, fontWeight: 700, fontSize: '0.85rem' }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button style={S.iconBtn} onClick={loadHistory} title="Histórico de conversas">🕐</button>
          {onDelete && <button style={S.dangerBtn} onClick={onDelete}>Eliminar</button>}
          <button style={S.closeBtn} onClick={onClose}>Fechar</button>
        </div>
      </div>

      {/* Histórico */}
      {showHistory && (
        <div style={S.historyPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.82rem', color: 'var(--text)' }}>Conversas anteriores</strong>
            <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          {history.length === 0
            ? <p style={{ fontSize: '0.8rem', color: 'var(--hint)', margin: 0 }}>Sem conversas anteriores</p>
            : history.map(c => (
              <div key={c.id} style={S.historyItem}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{new Date(c.created_at).toLocaleDateString('pt-PT')}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text)', marginLeft: '0.5rem' }}>{c.attendant_name || 'Sem atendente'} · {c.message_count} msgs</span>
                <span style={{ fontSize: '0.72rem', color: c.status === 'closed' ? 'var(--hint)' : 'var(--success)', marginLeft: 'auto' }}>{c.status}</span>
              </div>
            ))}
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} style={S.messages}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            ...S.bubble,
            ...(msg.from_me ? S.mine : S.theirs),
            ...(msg.is_internal ? S.internal : {}),
          }}>
            {!!msg.from_me && msg.sender_name && (
              <span style={S.senderName}>{msg.sender_name}{msg.is_internal ? ' · nota interna' : ''}</span>
            )}
            <MessageContent msg={msg} />
            {msg.failed && <span style={{ color: 'var(--danger)', fontSize: '0.78rem' }}> ⚠️</span>}
            <span style={S.time}>{new Date(msg.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {typerNames.length > 0 && (
        <div style={S.typingBar}>
          <span style={{ color: 'var(--wa-green)', fontSize: '0.55rem', letterSpacing: '3px' }}>●●●</span>
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{typerNames.join(', ')} {typerNames.length === 1 ? 'está' : 'estão'} a digitar...</span>
        </div>
      )}

      {warning && <div style={S.warning}>{warning}</div>}

      {/* Quick reply suggestions */}
      {qrSuggestions.length > 0 && (
        <div style={S.qrDropdown}>
          {qrSuggestions.map(qr => (
            <div key={qr.id} style={S.qrItem} onClick={() => applyQuickReply(qr)}>
              <strong style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>/{qr.shortcut}</strong>
              <span style={{ color: 'var(--muted)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{qr.body}</span>
            </div>
          ))}
        </div>
      )}

      {/* Schedule panel */}
      {showSchedule && (
        <div style={S.schedulePanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Agendar mensagem</strong>
            <button onClick={() => setShowSchedule(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          <input type="datetime-local" style={{ ...S.schedInput, marginBottom: '0.5rem' }}
            value={scheduleAt} onChange={e => setScheduleAt(e.target.value)}
            min={new Date(Date.now() + 60000).toISOString().slice(0,16)} />
          <textarea style={{ ...S.schedInput, resize: 'vertical', minHeight: '60px' }}
            placeholder="Texto da mensagem..." value={scheduleBody}
            onChange={e => setScheduleBody(e.target.value)} />
          <button style={S.schedBtn} onClick={saveSchedule} disabled={scheduleSaving || !scheduleBody.trim() || !scheduleAt}>
            {scheduleSaving ? 'A guardar...' : '📅 Agendar'}
          </button>
        </div>
      )}

      {/* Input area */}
      <div style={S.inputArea}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0.3rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              style={{ ...S.modeBtn, ...(isInternal ? S.modeBtnInternal : {}) }}
              onClick={() => setIsInternal(v => !v)}
              title="Nota interna (não enviada ao cliente)"
            >
              {isInternal ? '🔒 Nota' : '💬 Mensagem'}
            </button>
            <span style={{ fontSize: '0.72rem', color: 'var(--hint)' }}>Digite / para respostas rápidas</span>
          </div>
          <textarea
            style={{ ...S.textarea, ...(isInternal ? S.textareaInternal : {}) }}
            value={text}
            onChange={handleTyping}
            onKeyDown={handleKey}
            placeholder={isInternal ? 'Nota interna (só a equipa vê)...' : 'Escreve uma mensagem...'}
            rows={2}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <button style={S.schedIconBtn} onClick={() => setShowSchedule(v => !v)} title="Agendar mensagem">📅</button>
          <button style={S.sendBtn} onClick={send} disabled={sending || !text.trim()}>
            {sending ? '...' : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  container: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--bg)' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg)' },
  emptyInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--sh)' },
  phone: { display: 'block', fontSize: '0.75rem', color: 'var(--hint)', marginTop: '1px' },
  headerActions: { display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 },
  attendantBadge: { background: 'var(--accent-l)', color: 'var(--accent)', padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 },
  iconBtn: { background: 'none', border: '1px solid var(--border-m)', padding: '0.25rem 0.5rem', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.95rem' },
  tagPicker: { position: 'absolute', right: 0, top: '110%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', padding: '0.4rem', minWidth: '170px', zIndex: 100 },
  dangerBtn: { background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.25rem 0.65rem', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.8rem' },
  closeBtn: { background: 'none', border: '1px solid var(--border-m)', color: 'var(--muted)', padding: '0.25rem 0.65rem', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem' },
  historyPanel: { background: 'var(--warn-l)', borderBottom: '1px solid rgba(217,119,6,0.2)', padding: '0.75rem 1rem', maxHeight: '150px', overflowY: 'auto' },
  historyItem: { display: 'flex', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid rgba(217,119,6,0.12)' },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  bubble: { maxWidth: '70%', padding: '0.5rem 0.75rem', borderRadius: 'var(--r-md)', position: 'relative' },
  mine: { alignSelf: 'flex-end', background: 'var(--wa-bubble)', boxShadow: 'var(--sh)' },
  theirs: { alignSelf: 'flex-start', background: 'var(--card)', boxShadow: 'var(--sh)' },
  internal: { background: 'var(--warn-l)', border: '1px dashed var(--warn)', alignSelf: 'flex-end' },
  senderName: { fontSize: '0.68rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem', fontWeight: 600 },
  time: { fontSize: '0.67rem', color: 'var(--hint)', float: 'right', marginTop: '0.25rem', marginLeft: '0.5rem' },
  typingBar: { padding: '0.3rem 1rem', background: 'var(--card)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 },
  warning: { background: 'var(--warn-l)', color: 'var(--warn)', padding: '0.4rem 1rem', fontSize: '0.82rem', borderTop: '1px solid rgba(217,119,6,0.25)', flexShrink: 0 },
  qrDropdown: { background: 'var(--card)', borderTop: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto', flexShrink: 0 },
  qrItem: { padding: '0.5rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', transition: 'background .1s' },
  schedulePanel: { background: 'var(--accent-l)', borderTop: '1px solid rgba(26,86,160,0.15)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 },
  schedInput: { padding: '0.4rem 0.6rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', background: 'var(--card)', color: 'var(--text)' },
  schedBtn: { padding: '0.4rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 600, alignSelf: 'flex-start', fontSize: '0.85rem' },
  inputArea: { display: 'flex', gap: '0.5rem', padding: '0.75rem', background: 'var(--card)', borderTop: '1px solid var(--border)', alignItems: 'flex-end', flexShrink: 0 },
  modeBtn: { padding: '0.2rem 0.6rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap', background: 'none', color: 'var(--muted)' },
  modeBtnInternal: { background: 'var(--warn-l)', borderColor: 'var(--warn)', color: '#92400e' },
  textarea: { width: '100%', padding: '0.5rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', resize: 'none', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: 'var(--card)', color: 'var(--text)' },
  textareaInternal: { background: 'var(--warn-l)', borderColor: 'var(--warn)' },
  sendBtn: { padding: '0 0.85rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 700, flex: 1, fontSize: '1rem' },
  schedIconBtn: { padding: '0.2rem 0.5rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.95rem' },
};
