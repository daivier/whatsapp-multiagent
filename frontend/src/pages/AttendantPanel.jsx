import { useState, useEffect } from 'react';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import ScheduledMessagesPage from './ScheduledMessagesPage';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import PushNotificationsButton from '../components/PushNotificationsButton';
import api from '../api';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Disponível', color: 'var(--success)' },
  { value: 'busy',   label: 'Ocupado',    color: 'var(--warn)' },
  { value: 'away',   label: 'Ausente',    color: 'var(--hint)' },
];

export default function AttendantPanel({ socket }) {
  const { user, logout } = useAuth();
  const [selectedConv, setSelectedConv] = useState(null);
  const [takenNotice, setTakenNotice] = useState(null);
  useNotifications(socket, selectedConv, user);

  useEffect(() => {
    if (!socket) return;
    const onTaken = ({ conversation_id, contact_name, taken_by_name }) => {
      if (selectedConv?.id === conversation_id) setSelectedConv(null);
      setTakenNotice(`A conversa com "${contact_name}" foi assumida por ${taken_by_name}.`);
      setTimeout(() => setTakenNotice(null), 6000);
    };
    const onReopened = ({ contact_name }) => {
      setTakenNotice(`🔁 Conversa com "${contact_name}" foi reaberta — o cliente voltou!`);
      setTimeout(() => setTakenNotice(null), 7000);
    };
    const onAssigned = ({ conversation }) => {
      const name = conversation?.contact_name || conversation?.phone || 'cliente';
      setTakenNotice(`📋 Foi-te atribuída a conversa com "${name}"`);
      setTimeout(() => setTakenNotice(null), 7000);
    };
    socket.on('conversation:taken', onTaken);
    socket.on('conversation:reopened', onReopened);
    socket.on('conversation:assigned', onAssigned);
    return () => {
      socket.off('conversation:taken', onTaken);
      socket.off('conversation:reopened', onReopened);
      socket.off('conversation:assigned', onAssigned);
    };
  }, [socket, selectedConv]);
  const [status, setStatus] = useState(() => {
    const s = user.status;
    return (s && s !== 'offline') ? s : 'online';
  });
  const [onShift, setOnShift] = useState(!!(user.on_shift));
  const [view, setView] = useState('conversations'); // 'conversations' | 'scheduled'
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);

  // Re-sincroniza o turno ao montar (garante que está actualizado após re-login)
  useEffect(() => {
    api.get('/auth/me').then(r => setOnShift(!!(r.data?.user?.on_shift))).catch(() => {});
  }, []);

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
    function onUserShift({ userId, on_shift }) {
      if (userId === user.id) setOnShift(!!on_shift);
    }
    socket.on('user:status', onUserStatus);
    socket.on('user:shift', onUserShift);
    return () => {
      socket.off('user:status', onUserStatus);
      socket.off('user:shift', onUserShift);
    };
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
      {takenNotice && (
        <div style={{ position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#f97316', color: '#fff', padding: '0.65rem 1.25rem', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span>⚠️ {takenNotice}</span>
          <button onClick={() => setTakenNotice(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}
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
          <PushNotificationsButton compact={isMobile} />
          <button style={S.logoutBtn} onClick={logout}>Sair</button>
        </div>
      </header>

      {/* Navegação entre vistas */}
      <div style={S.navBar}>
        <button style={{ ...S.navBtn, ...(view === 'conversations' ? S.navBtnActive : {}) }} onClick={() => setView('conversations')}>
          💬 Conversas
        </button>
        <button style={{ ...S.navBtn, ...(view === 'scheduled' ? S.navBtnActive : {}) }} onClick={() => setView('scheduled')}>
          📅 Agendamentos
        </button>
      </div>

      <div style={S.body}>
        {view === 'scheduled' ? (
          <ScheduledMessagesPage socket={socket} />
        ) : (
          <>
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
          </>
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
  navBar: { display: 'flex', gap: '0.25rem', padding: '0.4rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  navBtn: { padding: '0.3rem 0.9rem', borderRadius: 'var(--r-sm)', border: '1px solid transparent', background: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500, color: 'var(--muted)', transition: 'all .15s' },
  navBtnActive: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  listPane: { width: '300px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};
