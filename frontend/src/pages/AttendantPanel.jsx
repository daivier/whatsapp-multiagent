import { useState, useEffect } from 'react';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import api from '../api';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Disponível', color: 'var(--success)' },
  { value: 'busy',   label: 'Ocupado',    color: 'var(--warn)' },
  { value: 'away',   label: 'Ausente',    color: 'var(--hint)' },
];

export default function AttendantPanel({ socket }) {
  const { user, logout } = useAuth();
  const [selectedConv, setSelectedConv] = useState(null);
  useNotifications(socket, selectedConv);
  const [status, setStatus] = useState(() => {
    const s = user.status;
    return (s && s !== 'offline') ? s : 'online';
  });
  const [onShift, setOnShift] = useState(user.on_shift === 1 || user.on_shift === true);
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

  async function toggleShift() {
    const next = !onShift;
    setOnShift(next);
    try { await api.patch('/users/me/shift', { on_shift: next }); }
    catch (_) { setOnShift(!next); }
  }

  const currentStatus = STATUS_OPTIONS.find(s => s.value === status);
  const showList = !isMobile || !selectedConv;
  const showChat = !isMobile || !!selectedConv;

  return (
    <div style={S.shell}>
      <header style={S.header}>
        <div style={S.headerLeft}>
          {isMobile && selectedConv ? (
            <button onClick={() => setSelectedConv(null)} style={S.backBtn}>←</button>
          ) : null}
          <div style={S.logo}>
            <span style={S.logoIcon}>💬</span>
            <span style={S.logoText}>{import.meta.env.VITE_TENANT_NAME || 'WhatsApp Multi-Atendente'}</span>
          </div>
          {isMobile && selectedConv && (
            <span style={S.convTitle}>{selectedConv.contact_name || selectedConv.phone}</span>
          )}
        </div>
        <div style={S.headerRight}>
          {!isMobile && <span style={S.userName}>{user.name}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: currentStatus?.color, flexShrink: 0 }} />
            <select value={status} onChange={e => changeStatus(e.target.value)} style={S.statusSelect}>
              {STATUS_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{isMobile ? s.label.slice(0,3) : s.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={toggleShift}
            title={onShift ? 'Sair do turno' : 'Entrar em turno'}
            style={{ padding: '0.3rem 0.7rem', borderRadius: 'var(--r-sm)', border: '1px solid', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, background: onShift ? 'var(--success)' : 'none', color: onShift ? '#fff' : 'var(--muted)', borderColor: onShift ? 'var(--success)' : 'var(--border-m)', transition: 'all .15s' }}>
            {onShift ? '🟢 Turno' : '⚪ Turno'}
          </button>
          <button style={S.logoutBtn} onClick={logout}>Sair</button>
        </div>
      </header>

      <div style={S.body}>
        {showList && (
          <div style={isMobile ? { flex: 1 } : S.listPane}>
            <ConversationList socket={socket} selected={selectedConv} onSelect={setSelectedConv} />
          </div>
        )}
        {showChat && (
          <div style={isMobile ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : S.chatPane}>
            <ChatWindow conversation={selectedConv} socket={socket} onClose={() => setSelectedConv(null)} onConversationChange={setSelectedConv} />
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.25rem', height: '54px', background: 'var(--card)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--sh)' },
  headerLeft: { display: 'flex', gap: '0.75rem', alignItems: 'center', minWidth: 0 },
  headerRight: { display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0 },
  logo: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  logoIcon: { fontSize: '1.25rem' },
  logoText: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' },
  convTitle: { fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: '1.2rem', cursor: 'pointer', padding: '0 0.25rem' },
  userName: { fontSize: '0.85rem', color: 'var(--muted)', fontWeight: 500 },
  statusSelect: { padding: '0.3rem 0.5rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-m)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500 },
  logoutBtn: { padding: '0.3rem 0.75rem', background: 'none', border: '1px solid var(--border-m)', color: 'var(--muted)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  listPane: { width: '300px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};
