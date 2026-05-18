import { useState, useEffect } from 'react';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import { useAuth } from '../context/AuthContext';
import api from '../api';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Disponível', color: '#10b981' },
  { value: 'busy', label: 'Ocupado', color: '#f59e0b' },
  { value: 'away', label: 'Ausente', color: '#6b7280' },
];

export default function AttendantPanel({ socket }) {
  const { user, logout } = useAuth();
  const [selectedConv, setSelectedConv] = useState(null);
  const [status, setStatus] = useState(() => {
    const s = user.status;
    return (s && s !== 'offline') ? s : 'online';
  });

  // Quando o socket liga, o backend emite user:status com o preferred_status restaurado
  useEffect(() => {
    if (!socket) return;
    function onUserStatus({ userId, status: s }) {
      if (userId === user.id && s !== 'offline') setStatus(s);
    }
    socket.on('user:status', onUserStatus);
    return () => socket.off('user:status', onUserStatus);
  }, [socket, user.id]);

  async function changeStatus(newStatus) {
    setStatus(newStatus);
    socket?.emit('user:status', { status: newStatus });
    await api.patch('/auth/status', { status: newStatus });
  }

  const currentStatus = STATUS_OPTIONS.find(s => s.value === status);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.logoArea}>
          <span style={{ fontSize: '1.4rem' }}>💬</span>
          <strong style={{ color: '#fff' }}>WhatsApp Multi-Atendente</strong>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.userName}>{user.name}</span>
          <select
            value={status}
            onChange={e => changeStatus(e.target.value)}
            style={{ ...styles.statusSelect, borderColor: currentStatus?.color }}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button style={styles.logoutBtn} onClick={logout}>Sair</button>
        </div>
      </header>

      <div style={styles.body}>
        <div style={styles.listPane}>
          <ConversationList socket={socket} selected={selectedConv} onSelect={setSelectedConv} />
        </div>
        <div style={styles.chatPane}>
          <ChatWindow conversation={selectedConv} socket={socket} onClose={() => setSelectedConv(null)} />
        </div>
      </div>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', height: '56px', background: '#1a1a2e', flexShrink: 0 },
  logoArea: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  headerRight: { display: 'flex', gap: '0.75rem', alignItems: 'center' },
  userName: { color: '#ccc', fontSize: '0.9rem' },
  statusSelect: { padding: '0.3rem 0.5rem', borderRadius: '6px', border: '2px solid', background: '#2a2a4e', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' },
  logoutBtn: { padding: '0.3rem 0.75rem', background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: '6px', cursor: 'pointer' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  listPane: { width: '320px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};
