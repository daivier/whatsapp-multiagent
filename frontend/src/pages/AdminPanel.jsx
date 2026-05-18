import { useState, useEffect } from 'react';
import api from '../api';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import { useAuth } from '../context/AuthContext';

export default function AdminPanel({ socket }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('conversations');
  const [selectedConv, setSelectedConv] = useState(null);
  const [attendants, setAttendants] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [whatsappReady, setWhatsappReady] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [transferTo, setTransferTo] = useState('');
  const [userStatuses, setUserStatuses] = useState({});

  useEffect(() => {
    loadAttendants();
    loadMetrics();
    checkWhatsapp();
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('whatsapp:qr', (qr) => { setQrCode(qr); setWhatsappReady(false); });
    socket.on('whatsapp:ready', () => { setWhatsappReady(true); setQrCode(null); });
    socket.on('whatsapp:disconnected', () => setWhatsappReady(false));
    socket.on('user:status', ({ userId, status }) => setUserStatuses(prev => ({ ...prev, [userId]: status })));
    return () => {
      socket.off('whatsapp:qr');
      socket.off('whatsapp:ready');
      socket.off('whatsapp:disconnected');
      socket.off('user:status');
    };
  }, [socket]);

  async function loadAttendants() {
    const { data } = await api.get('/users');
    setAttendants(Array.isArray(data) ? data.filter(u => u.role === 'attendant') : []);
  }

  async function loadMetrics() {
    const { data } = await api.get('/conversations/metrics');
    setMetrics(data);
  }

  async function checkWhatsapp() {
    const { data } = await api.get('/whatsapp/status');
    setWhatsappReady(data.isReady);
    if (data.qrCode) setQrCode(data.qrCode);
  }

  async function createAttendant(e) {
    e.preventDefault();
    await api.post('/users', newUser);
    setNewUser({ name: '', email: '', password: '' });
    loadAttendants();
  }

  async function toggleAttendant(id, active) {
    await api.patch(`/users/${id}`, { active: !active });
    loadAttendants();
  }

  async function transferConversation() {
    if (!selectedConv || !transferTo) return;
    try {
      const { data } = await api.post(`/conversations/${selectedConv.id}/transfer`, { attendant_id: parseInt(transferTo) });
      setSelectedConv(data); // actualiza a conversa com o novo atendente
      setTransferTo('');
      alert(`Transferido para ${activeAttendants.find(a => a.id == transferTo)?.name}`);
    } catch (err) {
      alert('Erro ao transferir: ' + (err.response?.data?.error || err.message));
    }
  }

  const activeAttendants = attendants.filter(a => a.active);

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <div style={styles.logoArea}>
            <span style={{ fontSize: '1.5rem' }}>💬</span>
            <div>
              <p style={styles.userName}>{user.name}</p>
              <span style={styles.ownerBadge}>Dono</span>
            </div>
          </div>
          <nav style={styles.nav}>
            {[['conversations', 'Conversas'], ['attendants', 'Atendentes'], ['metrics', 'Métricas'], ['whatsapp', 'WhatsApp']].map(([key, label]) => (
              <button key={key} style={{ ...styles.navBtn, ...(tab === key ? styles.navActive : {}) }} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>
        </div>
        <button style={styles.logoutBtn} onClick={logout}>Sair</button>
      </aside>

      <main style={styles.main}>
        {tab === 'conversations' && (
          <div style={styles.chatLayout}>
            <div style={styles.listPane}>
              <ConversationList socket={socket} selected={selectedConv} onSelect={setSelectedConv} />
            </div>
            <div style={styles.chatPane}>
              {selectedConv && (
                <div style={{ padding: '0.5rem 1rem', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {activeAttendants.length === 0 ? (
                    <span style={{ color: '#e53e3e', fontSize: '0.85rem' }}>
                      Sem atendentes activos — cria atendentes em <strong>Atendentes</strong>
                    </span>
                  ) : (
                    <>
                      <select value={transferTo} onChange={e => setTransferTo(e.target.value)} style={styles.select}>
                        <option value="">Transferir para...</option>
                        {activeAttendants.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({userStatuses[a.id] || a.status || 'offline'})
                          </option>
                        ))}
                      </select>
                      <button style={styles.transferBtn} onClick={transferConversation} disabled={!transferTo}>
                        Transferir
                      </button>
                    </>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#888' }}>
                    Atendente: <strong>{selectedConv.attendant_name || 'Sem atendente'}</strong>
                  </span>
                </div>
              )}
              <ChatWindow conversation={selectedConv} socket={socket} onClose={() => setSelectedConv(null)} />
            </div>
          </div>
        )}

        {tab === 'attendants' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Atendentes</h2>
            <form onSubmit={createAttendant} style={styles.form}>
              <input style={styles.input} placeholder="Nome" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} required />
              <input style={styles.input} type="email" placeholder="Email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} required />
              <input style={styles.input} type="password" placeholder="Password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} required />
              <button style={styles.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={styles.table}>
              <thead><tr><th>Nome</th><th>Email</th><th>Estado</th><th>Ativo</th><th></th></tr></thead>
              <tbody>
                {attendants.map(a => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.email}</td>
                    <td><span style={{ color: a.status === 'online' ? '#10b981' : a.status === 'busy' ? '#f59e0b' : '#6b7280' }}>{a.status}</span></td>
                    <td>{a.active ? 'Sim' : 'Não'}</td>
                    <td>
                      <button style={styles.toggleBtn} onClick={() => toggleAttendant(a.id, a.active)}>
                        {a.active ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'metrics' && metrics && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Métricas</h2>
            <div style={styles.cards}>
              {[['Total', metrics.total, '#3b82f6'], ['Aguarda', metrics.waiting, '#f59e0b'], ['Abertas', metrics.open, '#10b981'], ['Fechadas', metrics.closed, '#6b7280']].map(([label, value, color]) => (
                <div key={label} style={{ ...styles.card, borderTop: `4px solid ${color}` }}>
                  <p style={styles.cardValue}>{value}</p>
                  <p style={styles.cardLabel}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'whatsapp' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>WhatsApp</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: whatsappReady ? '#10b981' : '#ef4444' }} />
              <span>{whatsappReady ? 'Conectado' : 'Desconectado'}</span>
            </div>
            {!whatsappReady && qrCode && (
              <div>
                <p style={{ marginBottom: '1rem', color: '#555' }}>Escaneia o QR Code com o WhatsApp do número da loja:</p>
                <img src={qrCode} alt="QR Code" style={{ width: 240, height: 240, border: '1px solid #ddd', borderRadius: '8px' }} />
              </div>
            )}
            {!whatsappReady && !qrCode && <p style={{ color: '#999' }}>A aguardar QR Code...</p>}
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: '200px', background: '#1a1a2e', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '1rem 0' },
  sidebarTop: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  logoArea: { display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0 1rem' },
  userName: { margin: 0, color: '#fff', fontSize: '0.85rem', fontWeight: 600 },
  ownerBadge: { background: '#25D366', color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem' },
  nav: { display: 'flex', flexDirection: 'column' },
  navBtn: { padding: '0.75rem 1rem', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem' },
  navActive: { background: '#25D36622', color: '#25D366', fontWeight: 600 },
  logoutBtn: { margin: '0 1rem', padding: '0.5rem', background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: '6px', cursor: 'pointer' },
  main: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  chatLayout: { display: 'flex', height: '100%' },
  listPane: { width: '320px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  section: { padding: '1.5rem 2rem', overflowY: 'auto', height: '100%' },
  sectionTitle: { marginTop: 0, marginBottom: '1.5rem', fontSize: '1.2rem' },
  form: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.9rem' },
  addBtn: { padding: '0.5rem 1rem', background: '#25D366', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  toggleBtn: { padding: '0.25rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', background: 'none' },
  cards: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  card: { background: '#fff', padding: '1.5rem', borderRadius: '10px', minWidth: '140px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' },
  cardValue: { fontSize: '2rem', fontWeight: 700, margin: 0 },
  cardLabel: { color: '#888', margin: '0.25rem 0 0', fontSize: '0.9rem' },
  select: { padding: '0.4rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' },
  transferBtn: { padding: '0.4rem 1rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' },
};
