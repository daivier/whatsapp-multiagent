import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function ChatWindow({ conversation, socket, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState('');
  const [typers, setTypers] = useState({}); // { userId: name }
  const typingTimer = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!conversation) return;
    api.get(`/conversations/${conversation.id}/messages`).then(r => setMessages(Array.isArray(r.data) ? r.data : []));
    socket?.emit('conv:join', { conversation_id: conversation.id });
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
      setTypers(prev => {
        const next = { ...prev };
        if (typing) next[userId] = name;
        else delete next[userId];
        return next;
      });
    }

    socket.on('message:new', onMessage);
    socket.on('typing:update', onTyping);
    return () => {
      socket.off('message:new', onMessage);
      socket.off('typing:update', onTyping);
    };
  }, [socket, conversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setWarning('');
    const body = text;
    setText('');

    // Mostra a mensagem imediatamente (optimistic update)
    const tempId = `temp-${Date.now()}`;
    const tempMsg = { id: tempId, conversation_id: conversation.id, from_me: 1, body, timestamp: new Date().toISOString(), sender_name: user.name };
    setMessages(prev => [...prev, tempMsg]);

    socket.emit('message:send', { conversation_id: conversation.id, body }, (res) => {
      setSending(false);
      if (res?.message) {
        // Substitui a msg temporária pela real (com ID correto da BD)
        setMessages(prev => prev.map(m => m.id === tempId ? res.message : m));
      } else if (res?.error) {
        setWarning(res.error);
        // Mantém a mensagem mas marca como falhou
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true } : m));
        setText(body);
      }
    });
  }

  function handleTyping(e) {
    setText(e.target.value);
    if (!socket || !conversation) return;
    socket.emit('typing:start', { conversation_id: conversation.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('typing:stop', { conversation_id: conversation.id });
    }, 2000);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const typerNames = Object.values(typers).filter(Boolean);

  if (!conversation) {
    return (
      <div style={styles.empty}>
        <p>Seleciona uma conversa para começar</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <strong>{conversation.contact_name || conversation.phone}</strong>
          <span style={styles.phone}>{conversation.phone}</span>
        </div>
        <div style={styles.headerActions}>
          {user.role === 'owner' && (
            <span style={styles.badge}>{conversation.attendant_name || 'Sem atendente'}</span>
          )}
          <button style={styles.closeBtn} onClick={onClose}>Fechar</button>
        </div>
      </div>

      <div style={styles.messages}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ ...styles.bubble, ...(msg.from_me ? styles.mine : styles.theirs) }}>
            {!!msg.from_me && msg.sender_name && (
              <span style={styles.senderName}>{msg.sender_name}</span>
            )}
            <p style={styles.msgText}>{msg.body}{msg.failed ? ' ⚠️' : ''}</p>
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
      {warning && (
        <div style={styles.warning}>{warning}</div>
      )}
      <div style={styles.inputArea}>
        <textarea
          style={styles.textarea}
          value={text}
          onChange={handleTyping}
          onKeyDown={handleKey}
          placeholder="Escreve uma mensagem..."
          rows={2}
        />
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
  closeBtn: { background: 'none', border: '1px solid #ddd', padding: '0.25rem 0.75rem', borderRadius: '6px', cursor: 'pointer' },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  bubble: { maxWidth: '70%', padding: '0.5rem 0.75rem', borderRadius: '10px', position: 'relative' },
  mine: { alignSelf: 'flex-end', background: '#dcf8c6' },
  theirs: { alignSelf: 'flex-start', background: '#fff' },
  senderName: { fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '0.2rem' },
  msgText: { margin: 0, fontSize: '0.9rem' },
  time: { fontSize: '0.7rem', color: '#999', float: 'right', marginTop: '0.2rem', marginLeft: '0.5rem' },
  inputArea: { display: 'flex', gap: '0.5rem', padding: '0.75rem', background: '#fff', borderTop: '1px solid #e5e5e5' },
  textarea: { flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '8px', resize: 'none', fontSize: '0.9rem', outline: 'none' },
  sendBtn: { padding: '0 1.25rem', background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 },
  warning: { background: '#fff3cd', color: '#856404', padding: '0.4rem 1rem', fontSize: '0.82rem', borderTop: '1px solid #ffc107' },
  typingBar: { padding: '0.3rem 1rem', fontSize: '0.8rem', color: '#555', background: '#f9f9f9', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  typingDots: { color: '#25D366', fontSize: '0.6rem', letterSpacing: '2px', animation: 'pulse 1s infinite' },
};
