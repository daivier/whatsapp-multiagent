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
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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

  const showList = !isMobile || !selectedConv;
  const showChat = !isMobile || !!selectedConv;

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.logoArea}>
          {isMobile && selectedConv && (
            <button onClick={() => setSelectedConv(null)} style={styles.backBtn}>←</button>
          )}
          <span style={{ fontSize: '1.4rem' }}>💬</span>
          {!isMobile && <strong style={{ color: '#fff' }}>{import.meta.env.VITE_TENANT_NAME || 'WhatsApp Multi-Atendente'}</strong>}
          {isMobile && selectedConv && (
            <strong style={{ color: '#fff', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
              {selectedConv.contact_name || selectedConv.phone}
            </strong>
          )}
          {isMobile && !selectedConv && <strong style={{ color: '#fff', fontSize: '0.95rem' }}>{import.meta.env.VITE_TENANT_NAME || 'Atendimento'}</strong>}
        </div>
        <div style={styles.headerRight}>
          {!isMobile && <span style={styles.userName}>{user.name}</span>}
          <select
            value={status}
            onChange={e => changeStatus(e.target.value)}
            style={{ ...styles.statusSelect, borderColor: currentStatus?.color }}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{isMobile ? s.label.slice(0,3) : s.label}</option>
            ))}
          </select>
          <button style={styles.logoutBtn} onClick={logout}>Sair</button>
        </div>
      </header>

      <div style={styles.body}>
        {showList && (
          <div style={{ ...(isMobile ? { flex: 1 } : styles.listPane) }}>
            <ConversationList socket={socket} selected={selectedConv} onSelect={setSelectedConv} />
          </div>
        )}
        {showChat && (
          <div style={{ ...(isMobile ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : styles.chatPane) }}>
            <ChatWindow conversation={selectedConv} socket={socket} onClose={() => setSelectedConv(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem', height: '52px', background: '#1a1a2e', flexShrink: 0 },
  logoArea: { display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 },
  headerRight: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 },
  userName: { color: '#ccc', fontSize: '0.9rem' },
  statusSelect: { padding: '0.3rem 0.4rem', borderRadius: '6px', border: '2px solid', background: '#2a2a4e', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' },
  logoutBtn: { padding: '0.3rem 0.6rem', background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' },
  backBtn: { background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  listPane: { width: '320px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};
