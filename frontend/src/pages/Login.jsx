import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      login(data.token, data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoIcon}>💬</div>
          <h1 style={S.title}>{import.meta.env.VITE_TENANT_NAME || 'WhatsApp Multi-Atendente'}</h1>
          <p style={S.sub}>Entra na tua conta</p>
        </div>
        <form onSubmit={handleSubmit} style={S.form}>
          <div style={S.field}>
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" placeholder="email@empresa.com"
              value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p style={S.error}>{error}</p>}
          <button style={{ ...S.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
            {loading ? 'A entrar...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

const S = {
  page: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' },
  card: { background: 'var(--card)', padding: '2.5rem 2rem', borderRadius: 'var(--r-lg)', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', width: '100%', maxWidth: '380px', border: '1px solid var(--border)' },
  logo: { textAlign: 'center', marginBottom: '2rem' },
  logoIcon: { fontSize: '2.5rem', marginBottom: '0.5rem' },
  title: { fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem' },
  sub: { color: 'var(--muted)', fontSize: '0.875rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' },
  input: { padding: '0.65rem 0.875rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-md)', fontSize: '0.9rem', outline: 'none', background: 'var(--bg)', color: 'var(--text)', transition: 'border-color .15s' },
  error: { color: 'var(--danger)', fontSize: '0.82rem', background: 'var(--danger-l)', padding: '0.5rem 0.75rem', borderRadius: 'var(--r-sm)' },
  btn: { padding: '0.7rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-md)', fontSize: '0.95rem', cursor: 'pointer', fontWeight: 600, transition: 'background .15s', marginTop: '0.25rem' },
};
