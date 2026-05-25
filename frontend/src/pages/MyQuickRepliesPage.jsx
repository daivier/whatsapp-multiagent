import { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

/**
 * Página para o atendente gerir os seus próprios atalhos pessoais.
 * Mostra também (read-only) os globais criados pelo Owner, com badge "Global".
 *
 * Mesmo componente também usável pelo Owner — distinção é só visual:
 * Owner vê todos os globais como editáveis; atendente vê-os como read-only.
 */
export default function MyQuickRepliesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ shortcut: '', body: '', category: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const { data } = await api.get('/quick-replies');
      setItems(Array.isArray(data) ? data : []);
    } catch (_) {}
  }

  async function add(e) {
    e.preventDefault();
    if (!form.shortcut.trim() || !form.body.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/quick-replies', {
        shortcut: form.shortcut.trim(),
        body: form.body.trim(),
        category: form.category.trim() || null,
        is_personal: true,   // Atendente sempre cria pessoal; Owner explicitamente pessoal aqui
      });
      setForm({ shortcut: '', body: '', category: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao guardar');
    }
    setSaving(false);
  }

  async function remove(item) {
    if (!confirm(`Eliminar "/${item.shortcut}"?`)) return;
    try { await api.delete(`/quick-replies/${item.id}`); load(); }
    catch (err) { alert(err.response?.data?.error || 'Erro'); }
  }

  const mine = items.filter(i => i.owner_user_id === user.id);
  const globals = items.filter(i => i.owner_user_id === null);
  const TEMPLATE_HINT = '{{primeiro_nome}}, {{nome}}, {{saudacao}}, {{atendente}}, {{empresa}}';

  return (
    <div style={S.wrap}>
      <h2 style={S.h2}>⚡ Os meus atalhos</h2>
      <p style={S.hint}>
        Cria atalhos só visíveis para ti. Outros atendentes não os vêem nem podem usar. No chat, digita
        <code style={S.code}> /atalho </code> para inserir o texto.<br />
        Suporta variáveis: <code style={S.code}>{TEMPLATE_HINT}</code>
      </p>

      <form onSubmit={add} style={S.form}>
        <input style={{ ...S.input, width: '120px' }} placeholder="/atalho"
          value={form.shortcut}
          onChange={e => setForm(p => ({ ...p, shortcut: e.target.value }))} required />
        <input style={{ ...S.input, flex: 1, minWidth: '200px' }} placeholder="Texto da resposta (suporta {{variáveis}})"
          value={form.body}
          onChange={e => setForm(p => ({ ...p, body: e.target.value }))} required />
        <input style={{ ...S.input, width: '120px' }} placeholder="Categoria (opcional)"
          value={form.category}
          onChange={e => setForm(p => ({ ...p, category: e.target.value }))} />
        <button style={S.add} type="submit" disabled={saving}>{saving ? '...' : 'Adicionar'}</button>
      </form>
      {error && <p style={S.error}>{error}</p>}

      <h3 style={S.h3}>Os meus ({mine.length})</h3>
      {mine.length === 0 && <p style={S.empty}>Ainda não tens atalhos pessoais. Adiciona acima.</p>}
      {mine.length > 0 && (
        <table style={S.table}>
          <thead><tr><th>Atalho</th><th>Mensagem</th><th>Categoria</th><th></th></tr></thead>
          <tbody>
            {mine.map(qr => (
              <tr key={qr.id}>
                <td><strong style={S.shortcutCol}>/{qr.shortcut}</strong></td>
                <td style={S.bodyCol}>{qr.body}</td>
                <td>{qr.category ? <span style={S.cat}>{qr.category}</span> : <span style={S.dim}>—</span>}</td>
                <td><button style={S.del} onClick={() => remove(qr)}>Eliminar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ ...S.h3, marginTop: '1.5rem' }}>Globais ({globals.length}) <span style={S.dim}>read-only</span></h3>
      <p style={S.hint}>Criados pelo Dono — disponíveis para toda a equipa.</p>
      {globals.length === 0 && <p style={S.empty}>Sem atalhos globais.</p>}
      {globals.length > 0 && (
        <table style={S.table}>
          <thead><tr><th>Atalho</th><th>Mensagem</th><th>Categoria</th></tr></thead>
          <tbody>
            {globals.map(qr => (
              <tr key={qr.id}>
                <td><strong style={{ ...S.shortcutCol, color: 'var(--muted)' }}>/{qr.shortcut}</strong></td>
                <td style={S.bodyCol}>{qr.body}</td>
                <td>{qr.category ? <span style={S.cat}>{qr.category}</span> : <span style={S.dim}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const S = {
  wrap: { padding: '1.5rem 2rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
  h2: { margin: '0 0 0.4rem', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' },
  h3: { margin: '1.25rem 0 0.5rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' },
  hint: { color: 'var(--muted)', fontSize: '0.82rem', margin: '0 0 1rem', lineHeight: 1.5 },
  code: { background: 'var(--accent-l)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '4px', fontSize: '0.78rem' },
  form: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' },
  input: { padding: '0.5rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.9rem', background: 'var(--bg)', color: 'var(--text)', outline: 'none' },
  add: { padding: '0.5rem 1.1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' },
  error: { color: 'var(--danger)', fontSize: '0.82rem', background: 'var(--danger-l)', padding: '0.4rem 0.6rem', borderRadius: 'var(--r-sm)', margin: '0.4rem 0 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  empty: { color: 'var(--hint)', fontSize: '0.85rem', margin: '0.5rem 0' },
  shortcutCol: { color: 'var(--accent)' },
  bodyCol: { maxWidth: '400px', wordBreak: 'break-word', color: 'var(--muted)', fontSize: '0.85rem' },
  cat: { background: 'var(--accent-l)', color: 'var(--accent)', padding: '1px 8px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 },
  dim: { color: 'var(--hint)', fontSize: '0.78rem' },
  del: { padding: '0.25rem 0.75rem', border: '1px solid var(--danger)', color: 'var(--danger)', background: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem' },
};
