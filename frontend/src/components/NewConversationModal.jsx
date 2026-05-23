import { useState, useRef, useEffect } from 'react';
import api from '../api';

export default function NewConversationModal({ onClose, onCreated }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null); // { assigned_to_name }
  const phoneRef = useRef(null);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  async function submit(force = false) {
    setSending(true);
    setError('');
    try {
      const { data } = await api.post('/conversations/outbound', { phone: phone.trim(), message: message.trim(), force });
      onCreated(data);
    } catch (err) {
      console.log('[conflict-debug] caught error, status:', err.response?.status, 'data:', JSON.stringify(err.response?.data));
      if (err.response?.status === 409 && err.response.data?.conflict) {
        setConflict(err.response.data);
      } else {
        setError(err.response?.data?.error || 'Erro ao enviar mensagem');
      }
    }
    setSending(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      setError('Número de telefone inválido. Usa apenas dígitos (ex: 5585999990000).');
      return;
    }
    if (!message.trim()) return;
    await submit(false);
  }

  if (conflict) {
    return (
      <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={S.modal}>
          <div style={S.header}>
            <strong style={S.title}>⚠️ Conversa já existe</strong>
            <button onClick={onClose} style={S.closeBtn}>✕</button>
          </div>
          <p style={{ color: 'var(--text)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
            Já existe uma conversa aberta para este contacto, atribuída a <strong>{conflict.assigned_to_name}</strong>.
            <br /><br />
            Queres assumir a conversa e enviar a mensagem na mesma?
          </p>
          <div style={S.actions}>
            <button type="button" onClick={onClose} style={S.cancelBtn}>Cancelar</button>
            <button type="button" onClick={() => submit(true)} style={S.sendBtn} disabled={sending}>
              {sending ? 'A enviar...' : 'Assumir e enviar'}
            </button>
          </div>
        </div>
      </div>
    );
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
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            required
          />
          <p style={S.hint}>Inclui o código do país (55 para Brasil). Apenas dígitos.</p>

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
