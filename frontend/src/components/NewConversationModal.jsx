import { useState, useRef, useEffect } from 'react';
import api from '../api';

export default function NewConversationModal({ onClose, onCreated }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const phoneRef = useRef(null);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!phone.trim() || !message.trim()) return;
    setSending(true);
    setError('');
    try {
      const { data } = await api.post('/conversations/outbound', { phone: phone.trim(), message: message.trim() });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao enviar mensagem');
    }
    setSending(false);
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.header}>
          <strong style={S.title}>✏️ Nova conversa</strong>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={S.form}>
          <label style={S.label}>Número de telefone</label>
          <input
            ref={phoneRef}
            style={S.input}
            placeholder="Ex: 5585999990000"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
          />
          <p style={S.hint}>Inclui o código do país (55 para Brasil). Sem espaços.</p>

          <label style={S.label}>Primeira mensagem</label>
          <textarea
            style={{ ...S.input, resize: 'vertical', minHeight: '80px' }}
            placeholder="Olá! Gostaria de..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
            required
          />

          {error && <p style={S.error}>{error}</p>}

          <div style={S.actions}>
            <button type="button" onClick={onClose} style={S.cancelBtn}>Cancelar</button>
            <button type="submit" style={S.sendBtn} disabled={sending || !phone.trim() || !message.trim()}>
              {sending ? 'A enviar...' : '▶ Enviar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--card)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', width: '100%', maxWidth: '420px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  title: { fontSize: '1rem', color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.1rem' },
  input: { padding: '0.5rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' },
  hint: { fontSize: '0.75rem', color: 'var(--hint)', margin: '0 0 0.5rem' },
  error: { color: 'var(--danger)', fontSize: '0.82rem', margin: 0, background: 'var(--danger-l)', padding: '0.4rem 0.6rem', borderRadius: 'var(--r-sm)' },
  actions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' },
  cancelBtn: { padding: '0.45rem 1rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' },
  sendBtn: { padding: '0.45rem 1.25rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 },
};
