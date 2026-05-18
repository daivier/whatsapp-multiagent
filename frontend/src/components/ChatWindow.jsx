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
          {tel && <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>{tel}</p>}
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
    return <a href={`${API}${msg.media_url}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#2563eb', textDecoration: 'none' }}>📎 Abrir ficheiro</a>;
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
  const typingTimer = useRef(null);
  const bottomRef = useRef(null);

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadHistory() {
    if (!conversation) return;
    const phone = conversation.phone;
    const r = await api.get(`/conversations/contact/${phone}`);
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
    // Respostas rápidas: mostrar sugestões quando começa com /
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
    return <div style={styles.empty}><p>Seleciona uma conversa para começar</p></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong>{conversation.contact_name || conversation.phone}</strong>
            {convTags.map(t => (
              <span key={t.id} style={{ background: t.color + '22', border: `1px solid ${t.color}`, color: t.color, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 600 }}>{t.name}</span>
            ))}
          </div>
          <span style={styles.phone}>{conversation.phone}</span>
        </div>
        <div style={styles.headerActions}>
          {user.role === 'owner' && (
            <span style={styles.badge}>{conversation.attendant_name || 'Sem atendente'}</span>
          )}
          <div style={{ position: 'relative' }}>
            <button style={styles.historyBtn} onClick={() => setShowTagPicker(v => !v)} title="Etiquetas">🏷️</button>
            {showTagPicker && (
              <div style={styles.tagPicker}>
                {allTags.length === 0 && <p style={{ margin: 0, color: '#999', fontSize: '0.8rem' }}>Sem etiquetas criadas</p>}
                {allTags.map(t => {
                  const active = convTags.some(ct => ct.id === t.id);
                  return (
                    <div key={t.id} onClick={() => toggleTag(t)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', borderRadius: '6px', background: active ? t.color + '15' : 'none' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.85rem', flex: 1 }}>{t.name}</span>
                      {active && <span style={{ color: t.color, fontWeight: 700, fontSize: '0.9rem' }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button style={styles.historyBtn} onClick={loadHistory} title="Histórico de conversas">🕐</button>
          {onDelete && <button style={styles.deleteBtn} onClick={onDelete}>Eliminar</button>}
          <button style={styles.closeBtn} onClick={onClose}>Fechar</button>
        </div>
      </div>

      {/* Histórico */}
      {showHistory && (
        <div style={styles.historyPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.85rem' }}>Conversas anteriores</strong>
            <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
          </div>
          {history.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#999', margin: 0 }}>Sem conversas anteriores</p> : history.map(c => (
            <div key={c.id} style={styles.historyItem}>
              <span style={{ fontSize: '0.8rem', color: '#555' }}>{new Date(c.created_at).toLocaleDateString('pt-PT')}</span>
              <span style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>{c.attendant_name || 'Sem atendente'} · {c.message_count} msgs</span>
              <span style={{ fontSize: '0.75rem', color: c.status === 'closed' ? '#6b7280' : '#10b981', marginLeft: 'auto' }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}

      <div style={styles.messages}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            ...styles.bubble,
            ...(msg.from_me ? styles.mine : styles.theirs),
            ...(msg.is_internal ? styles.internal : {}),
          }}>
            {!!msg.from_me && msg.sender_name && (
              <span style={styles.senderName}>{msg.sender_name}{msg.is_internal ? ' · nota interna' : ''}</span>
            )}
            <MessageContent msg={msg} />
            {msg.failed && <span style={{ color: '#e53e3e', fontSize: '0.8rem' }}> ⚠️</span>}
            <span style={styles.time}>{new Date(msg.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {typerNames.length > 0 && (
        <div style={styles.typingBar}>
          <span style={styles.typingDots}>●●●</span>
          {typerNames.join(', ')} {typerNames.length === 1 ? 'está' : 'estão'} a digitar...
        </div>
      )}
      {warning && <div style={styles.warning}>{warning}</div>}

      {/* Sugestões de respostas rápidas */}
      {qrSuggestions.length > 0 && (
        <div style={styles.qrDropdown}>
          {qrSuggestions.map(qr => (
            <div key={qr.id} style={styles.qrItem} onClick={() => applyQuickReply(qr)}>
              <strong style={{ color: '#25D366' }}>/{qr.shortcut}</strong>
              <span style={{ color: '#555', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{qr.body}</span>
            </div>
          ))}
        </div>
      )}

      <div style={styles.inputArea}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0.25rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              style={{ ...styles.modeBtn, background: isInternal ? '#fef3c7' : 'none', borderColor: isInternal ? '#f59e0b' : '#ddd', color: isInternal ? '#92400e' : '#888' }}
              onClick={() => setIsInternal(v => !v)}
              title="Nota interna (não enviada ao cliente)"
            >
              {isInternal ? '🔒 Nota' : '💬 Mensagem'}
            </button>
            <span style={{ fontSize: '0.75rem', color: '#aaa' }}>Digite / para respostas rápidas</span>
          </div>
          <textarea
            style={{ ...styles.textarea, background: isInternal ? '#fffbeb' : '#fff', borderColor: isInternal ? '#f59e0b' : '#ddd' }}
            value={text}
            onChange={handleTyping}
            onKeyDown={handleKey}
            placeholder={isInternal ? 'Nota interna (só a equipa vê)...' : 'Escreve uma mensagem...'}
            rows={2}
          />
        </div>
        <button style={styles.sendBtn} onClick={send} disabled={sending || !text.trim()}>
          {sending ? '...' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#f0f2f5' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#fff', borderBottom: '1px solid #e5e5e5' },
  phone: { display: 'block', fontSize: '0.8rem', color: '#888' },
  headerActions: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  badge: { background: '#e8f5e9', color: '#2e7d32', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem' },
  historyBtn: { background: 'none', border: '1px solid #ddd', padding: '0.25rem 0.5rem', borderRadius: '6px', cursor: 'pointer', fontSize: '1rem' },
  tagPicker: { position: 'absolute', right: 0, top: '110%', background: '#fff', border: '1px solid #e5e5e5', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.5rem', minWidth: '160px', zIndex: 100 },
  deleteBtn: { background: 'none', border: '1px solid #ef4444', color: '#ef4444', padding: '0.25rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' },
  closeBtn: { background: 'none', border: '1px solid #ddd', padding: '0.25rem 0.75rem', borderRadius: '6px', cursor: 'pointer' },
  historyPanel: { background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '0.75rem 1rem', maxHeight: '160px', overflowY: 'auto' },
  historyItem: { display: 'flex', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid #fef3c7', fontSize: '0.8rem' },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  bubble: { maxWidth: '70%', padding: '0.5rem 0.75rem', borderRadius: '10px', position: 'relative' },
  mine: { alignSelf: 'flex-end', background: '#dcf8c6' },
  theirs: { alignSelf: 'flex-start', background: '#fff' },
  internal: { background: '#fef3c7', border: '1px dashed #f59e0b', alignSelf: 'flex-end' },
  senderName: { fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '0.2rem' },
  time: { fontSize: '0.7rem', color: '#999', float: 'right', marginTop: '0.2rem', marginLeft: '0.5rem' },
  typingBar: { padding: '0.3rem 1rem', fontSize: '0.8rem', color: '#555', background: '#f9f9f9', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  typingDots: { color: '#25D366', fontSize: '0.6rem', letterSpacing: '2px' },
  warning: { background: '#fff3cd', color: '#856404', padding: '0.4rem 1rem', fontSize: '0.82rem', borderTop: '1px solid #ffc107' },
  qrDropdown: { background: '#fff', borderTop: '1px solid #e5e5e5', maxHeight: '180px', overflowY: 'auto' },
  qrItem: { padding: '0.5rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'baseline' },
  inputArea: { display: 'flex', gap: '0.5rem', padding: '0.75rem', background: '#fff', borderTop: '1px solid #e5e5e5', alignItems: 'flex-end' },
  modeBtn: { padding: '0.2rem 0.6rem', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap' },
  textarea: { width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '8px', resize: 'none', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  sendBtn: { padding: '0 1.25rem', background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, minHeight: '60px' },
};
