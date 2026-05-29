import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import SupervisorPanel from './SupervisorPanel';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import DashboardPage from './DashboardPage';
import ReportsPage from './ReportsPage';
import InternalChatPage from './InternalChatPage';
import PushNotificationsButton from '../components/PushNotificationsButton';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useTheme } from '../hooks/useTheme';
import api from '../api';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Disponível', color: 'var(--success)' },
  { value: 'busy',   label: 'Ocupado',    color: 'var(--warn)' },
  { value: 'away',   label: 'Ausente',    color: 'var(--hint)' },
];

export default function SupervisorLayout({ socket }) {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const { t } = useTranslation();
  const [view, setView] = useState('monitor'); // 'monitor' | 'conversations' | 'reports' | 'chat'
  const [selectedConv, setSelectedConv] = useState(null);
  const [internalUnread, setInternalUnread] = useState(0);
  const [convsUnread, setConvsUnread] = useState(0);
  const [status, setStatus] = useState(() => (user.status && user.status !== 'offline') ? user.status : 'online');
  const [onShift, setOnShift] = useState(!!user.on_shift);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [takenNotice, setTakenNotice] = useState(null);
  useNotifications(socket, selectedConv, user);

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
  }, [socket, user]);

  // Internal unread badge — independente da tab Chat Interno estar aberta.
  useEffect(() => {
    if (!socket || !user?.id) return;
    const recalc = () => api.get('/internal-chat/threads').then(r => {
      const total = (Array.isArray(r.data) ? r.data : []).reduce((s, t) => s + (t.unread_count || 0), 0);
      setInternalUnread(total);
    }).catch(() => {});
    recalc();
    const onMsg = ({ message, thread_id }) => {
      if (message?.from_user_id === user.id) return;
      if (window.__activeThreadId === thread_id && !document.hidden) return;
      setInternalUnread(n => n + 1);
    };
    const onRead = ({ user_id }) => { if (user_id === user.id) recalc(); };
    socket.on('internal:message', onMsg);
    socket.on('internal:read', onRead);
    return () => { socket.off('internal:message', onMsg); socket.off('internal:read', onRead); };
  }, [socket, user?.id]);

  // Conversas com mensagens não lidas — badge no botão "Conversas".
  useEffect(() => {
    if (!socket || !user?.id) return;
    let timer = null;
    const recalc = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api.get('/conversations?status=open').then(r => {
          const list = Array.isArray(r.data) ? r.data : [];
          const total = list.reduce((s, c) => s + (c.is_muted ? 0 : (c.unread_count || 0)), 0);
          setConvsUnread(total);
        }).catch(() => {});
      }, 500);
    };
    recalc();
    const onNew = ({ message }) => { if (!message?.from_me) recalc(); };
    const onUpdated = () => recalc();
    socket.on('message:new', onNew);
    socket.on('conversation:updated', onUpdated);
    return () => {
      clearTimeout(timer);
      socket.off('message:new', onNew);
      socket.off('conversation:updated', onUpdated);
    };
  }, [socket, user?.id]);

  async function changeStatus(s) {
    setStatus(s);
    try { await api.patch('/auth/status', { status: s }); } catch (_) {}
  }

  async function toggleShift() {
    const next = !onShift;
    setOnShift(next);
    try { await api.patch('/users/me/shift', { on_shift: next }); }
    catch (_) { setOnShift(!next); }
  }

  const showConvList = view === 'conversations' && (!isMobile || !selectedConv);
  const showChatWin  = view === 'conversations' && (!isMobile || !!selectedConv);

  const navItems = [
    { key: 'monitor',       icon: '👁️',  label: t('nav.monitoring') },
    { key: 'conversations', icon: '💬',  label: t('nav.conversations') },
    { key: 'reports',       icon: '📊',  label: t('nav.reports') },
    { key: 'chat',          icon: '👥',  label: t('nav.internalChat') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0.4rem' : '0.75rem', padding: '0.4rem 0.75rem', minHeight: 52, background: 'var(--card)', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: isMobile ? '0.82rem' : '0.95rem', color: 'var(--accent)', marginRight: isMobile ? 0 : '0.5rem' }}>💬 {isMobile ? 'WA Multi' : 'WhatsApp Multi-Atendente'}</span>

        {/* Nav tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', flex: 1, flexWrap: 'wrap' }}>
          {navItems.map(item => (
            <button key={item.key}
              onClick={() => { setView(item.key); if (item.key !== 'conversations') setSelectedConv(null); }}
              style={{
                padding: '0.3rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                background: view === item.key ? 'var(--accent)' : 'transparent',
                color: view === item.key ? '#fff' : 'var(--muted)',
                position: 'relative',
              }}>
              {item.icon} {!isMobile && item.label}
              {(() => {
                const badge = item.key === 'chat' ? internalUnread : item.key === 'conversations' ? convsUnread : 0;
                if (badge <= 0) return null;
                return <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, padding: '1px 4px', lineHeight: 1.4 }}>{badge > 99 ? '99+' : badge}</span>;
              })()}
            </button>
          ))}
        </div>

        {/* Status selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_OPTIONS.find(s => s.value === status)?.color || 'var(--muted)' }} />
          <select value={status} onChange={e => changeStatus(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer' }}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <button onClick={toggleShift} title={onShift ? 'Sair do turno' : 'Entrar em turno'}
          style={{ padding: '0.25rem 0.55rem', borderRadius: '6px', border: '1px solid', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, background: onShift ? 'var(--success)' : 'none', color: onShift ? '#fff' : 'var(--muted)', borderColor: onShift ? 'var(--success)' : 'var(--border)', flexShrink: 0 }}>
          {onShift ? '🟢' : '⚪'}{!isMobile && ' Turno'}
        </button>
        {!isMobile && <span style={{ fontSize: '0.78rem', color: 'var(--muted)', flexShrink: 0 }}>{user.name}</span>}
        <span style={{ fontSize: '0.65rem', background: '#7c3aed20', color: '#7c3aed', border: '1px solid #7c3aed40', borderRadius: '999px', padding: '1px 6px', fontWeight: 700, flexShrink: 0 }}>{isMobile ? 'SUP' : 'SUPERVISOR'}</span>
        <button onClick={toggleTheme} title={dark ? 'Modo claro' : 'Modo escuro'} style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'none', cursor: 'pointer', fontSize: '1rem', flexShrink: 0 }}>{dark ? '☀️' : '🌙'}</button>
        <PushNotificationsButton compact={isMobile} />
        <LanguageSwitcher compact={isMobile} />
        <button onClick={logout} title="Sair" style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.8rem', flexShrink: 0 }}>{isMobile ? '🚪' : 'Sair'}</button>
      </div>

      {takenNotice && (
        <div style={{ background: 'var(--accent-l)', borderBottom: '1px solid var(--accent)', padding: '0.5rem 1rem', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 500, flexShrink: 0 }}>
          {takenNotice}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Monitorização */}
        {view === 'monitor' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <SupervisorPanel socket={socket} />
          </div>
        )}

        {/* Conversas — supervisor vê todas */}
        {view === 'conversations' && (
          <>
            {showConvList && (
              <div style={{ width: isMobile ? '100%' : 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
                <ConversationList
                  socket={socket}
                  selected={selectedConv}
                  onSelect={setSelectedConv}
                />
              </div>
            )}
            {showChatWin && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                {selectedConv ? (
                  <ChatWindow
                    conversation={selectedConv}
                    socket={socket}
                    onClose={isMobile ? () => setSelectedConv(null) : undefined}
                    onConversationUpdate={updated => setSelectedConv(updated)}
                    supervisorMode={true}
                  />
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', flexDirection: 'column', gap: '0.5rem' }}>
                    <span style={{ fontSize: '2rem' }}>💬</span>
                    <span>Seleciona uma conversa para começar</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Relatórios — ReportsPage (histórico, períodos, CSV) restrita ao
            departamento do supervisor pelo backend. A Monitorização cobre o
            ao-vivo. */}
        {view === 'reports' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ReportsPage socket={socket} />
          </div>
        )}

        {/* Chat Interno */}
        {view === 'chat' && (
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            <InternalChatPage socket={socket} onUnreadChange={setInternalUnread} />
          </div>
        )}
      </div>
    </div>
  );
}
