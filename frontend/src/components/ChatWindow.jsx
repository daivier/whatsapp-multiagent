import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function ChatWindow({ conversation, socket, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!conversation) return;
    api.get(`/conversations/${conversation.id}/messages`).then(r => setMessages(r.data));
  }, [conversation]);

  useEffect(() => {
    if (!socket) return;
    function handler({ message, conversation: conv }) {
      const convId = conv?.id ?? message?.conversation_id;
      if (convId !== conversation?.id) return;
      // Evita duplicar mensagens próprias que já vieram via optimistic update
      if (message.from_me) return;
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
    }
    socket.on('message:new', handler);
    return () => socket.off('message:new', handler);
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

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

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
            {msg.from_me && msg.sender_name && (
              <span style={styles.senderName}>{msg.sender_name}</span>
            )}
            <p style={styles.msgText}>{msg.body}{msg.failed ? ' ⚠️' : ''}</p>
            <span style={styles.time}>{new Date(msg.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {warning && (
        <div style={styles.warning}>{warning}</div>
      )}
      <div style={styles.inputArea}>
        <textarea
          style={styles.textarea}
          value={text}
          onChange={e => setText(e.target.value)}
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
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f2f5' },
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
};
