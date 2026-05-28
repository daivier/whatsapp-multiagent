import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function NewConversationModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [lines, setLines] = useState([]);
  const [lineId, setLineId] = useState('');

  // Contact search
  const [contactSearch, setContactSearch] = useState('');
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounce = useRef(null);
  const searchRef = useRef(null);
  const suggestionsRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
    Promise.all([
      api.get('/lines'),
      api.get('/departments'),
    ]).then(([linesRes, deptsRes]) => {
      const allLines = Array.isArray(linesRes.data) ? linesRes.data : [];
      const myDeptIds = new Set(
        (Array.isArray(deptsRes.data) ? deptsRes.data : [])
          .filter(d => d.is_mine)
          .map(d => d.id)
      );
      const allowed = user.role === 'owner'
        ? allLines
        : allLines.filter(l => !l.department_id || myDeptIds.has(l.department_id));
      setLines(allowed);
      const def = allowed.find(l => l.is_default) || allowed[0];
      if (def) setLineId(String(def.id));
    }).catch(() => {});
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleContactSearchChange(val) {
    setContactSearch(val);
    setSelectedContact(null);
    setShowSuggestions(true);
    clearTimeout(searchDebounce.current);
    if (!val.trim()) {
      setContactSuggestions([]);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data } = await api.get('/contacts', { params: { q: val.trim() } });
        setContactSuggestions(Array.isArray(data) ? data.slice(0, 8) : []);
      } catch (_) {
        setContactSuggestions([]);
      }
      setSearchLoading(false);
    }, 280);
  }

  function selectContact(contact) {
    setSelectedContact(contact);
    setContactSearch(contact.name || contact.phone);
    setPhone(contact.phone.replace(/\D/g, ''));
    setShowSuggestions(false);
    setContactSuggestions([]);
  }

  function clearContact() {
    setSelectedContact(null);
    setContactSearch('');
    setPhone('');
    setContactSuggestions([]);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  async function submit(force = false) {
    setSending(true);
    setError('');
    try {
      const payload = { phone: phone.trim(), message: message.trim(), force };
      if (lineId) payload.line_id = parseInt(lineId, 10);
      const { data } = await api.post('/conversations/outbound', payload);
      onCreated(data);
    } catch (err) {
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
      setError('Número inválido. Usa apenas dígitos com código do país (ex: 5585999990000).');
      return;
    }
    if (!message.trim()) return;
    await submit(false);
  }

  // Cria contacto sem enviar mensagem nem abrir conversa. Usa contactSearch
  // como nome se for texto (não dígitos), senão phone como fallback.
  async function saveContactOnly() {
    setError('');
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      setError('Número inválido. Usa apenas dígitos com código do país (ex: 5585999990000).');
      return;
    }
    // Se contactSearch tem texto não-numérico, é nome; senão pede via prompt
    let name = '';
    if (contactSearch && !/^\d+$/.test(contactSearch.replace(/\D/g, ''))) {
      name = contactSearch.trim();
    }
    if (!name) {
      name = window.prompt('Nome do contacto (ou vazio para usar o número):', '') || '';
      name = name.trim();
    }
    setSending(true);
    try {
      const { data } = await api.post('/contacts', { phone: cleanPhone, name: name || cleanPhone });
      onClose();
      // Avisa o utilizador no nível de toast simples — sem componente dedicado
      window.alert(`Contacto ${data.name} guardado.`);
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Este contacto já existe.');
      } else {
        setError(err.response?.data?.error || 'Erro ao guardar contacto');
      }
    }
    setSending(false);
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
          {/* Line selector */}
          {lines.length >= 2 && (
            <>
              <label style={S.label}>Linha (qual número usa)</label>
              <select style={S.input} value={lineId} onChange={e => setLineId(e.target.value)}>
                {lines.map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.is_default ? ' (padrão)' : ''}</option>
                ))}
              </select>
            </>
          )}

          {/* Contact search */}
          <label style={S.label}>Contacto ou número</label>
          <div style={{ position: 'relative' }}>
            {selectedContact ? (
              /* Selected contact badge */
              <div style={S.selectedBadge}>
                <span style={S.badgeAvatar}>{(selectedContact.name || '?')[0].toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedContact.name || selectedContact.phone}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{selectedContact.phone}</div>
                </div>
                <button type="button" onClick={clearContact} style={S.clearBtn} title="Remover">✕</button>
              </div>
            ) : (
              <input
                ref={searchRef}
                style={S.input}
                placeholder="Pesquisar contacto ou digitar número..."
                value={contactSearch}
                onChange={e => handleContactSearchChange(e.target.value)}
                onFocus={() => contactSearch && setShowSuggestions(true)}
                autoComplete="off"
              />
            )}

            {/* Dropdown suggestions */}
            {showSuggestions && !selectedContact && (
              <div ref={suggestionsRef} style={S.dropdown}>
                {searchLoading && (
                  <div style={S.dropdownItem}>
                    <span style={{ color: 'var(--hint)', fontSize: '0.83rem' }}>A pesquisar...</span>
                  </div>
                )}
                {!searchLoading && contactSuggestions.length === 0 && contactSearch.trim() && (
                  <div style={{ ...S.dropdownItem, flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--hint)', fontSize: '0.83rem' }}>Nenhum contacto encontrado.</span>
                    <span style={{ color: 'var(--hint)', fontSize: '0.75rem' }}>Podes digitar o número diretamente em baixo.</span>
                  </div>
                )}
                {contactSuggestions.map(c => (
                  <button key={c.id} type="button" style={S.dropdownItem} onClick={() => selectContact(c)}>
                    <span style={S.dropdownAvatar}>{(c.name || c.phone)[0].toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name || c.phone}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>{c.phone}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Manual phone input — shown when no contact selected */}
          {!selectedContact && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.15rem 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                <span style={{ fontSize: '0.72rem', color: 'var(--hint)', flexShrink: 0 }}>ou digitar número</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              </div>
              <input
                style={S.input}
                placeholder="Ex: 5585999990000"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
              <p style={S.hint}>Inclui o código do país (55 para Brasil). Apenas dígitos.</p>
            </>
          )}

          <label style={S.label}>Primeira mensagem <span style={{ color: 'var(--hint)', fontWeight: 400 }}>(opcional se for só guardar)</span></label>
          <textarea
            style={{ ...S.input, resize: 'vertical', minHeight: '80px' }}
            placeholder="Olá! Gostaria de..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
          />

          {error && <p style={S.error}>{error}</p>}

          <div style={S.actions}>
            <button type="button" onClick={onClose} style={S.cancelBtn}>Cancelar</button>
            {!selectedContact && (
              <button type="button" onClick={saveContactOnly}
                disabled={sending || !phone.trim()}
                title="Guarda na agenda sem abrir conversa nem enviar mensagem"
                style={{ ...S.cancelBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                💾 Só guardar
              </button>
            )}
            <button type="submit" style={S.sendBtn} disabled={sending || (!phone.trim() && !selectedContact) || !message.trim()}>
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
  hint: { fontSize: '0.75rem', color: 'var(--hint)', margin: '0 0 0.25rem' },
  error: { color: 'var(--danger)', fontSize: '0.82rem', margin: 0, background: 'var(--danger-l)', padding: '0.4rem 0.6rem', borderRadius: 'var(--r-sm)' },
  actions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' },
  cancelBtn: { padding: '0.45rem 1rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' },
  sendBtn: { padding: '0.45rem 1.25rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 },
  // Contact search styles
  selectedBadge: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.75rem', border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--accent-l)' },
  badgeAvatar: { width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 },
  clearBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem', padding: '0.1rem 0.3rem', borderRadius: '4px', flexShrink: 0 },
  dropdown: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--card)', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--sh-md)', zIndex: 600, overflow: 'hidden', maxHeight: '220px', overflowY: 'auto' },
  dropdownItem: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem', cursor: 'pointer', background: 'none', border: 'none', width: '100%', borderBottom: '1px solid var(--border)' },
  dropdownAvatar: { width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 },
};
