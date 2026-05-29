import { useEffect, useState, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AttendantPanel from './pages/AttendantPanel';
import AdminPanel from './pages/AdminPanel';
import SupervisorLayout from './pages/SupervisorLayout';
import { io } from 'socket.io-client';
import api from './api';

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

function App() {
  const { user, token, loading, logout } = useAuth();
  const [socket, setSocket] = useState(null);
  const unreadRef = useRef(0);
  const originalTitle = useRef(document.title);
  const mutedIds = useRef(new Set());

  // Timer proactivo: desligar socket e fazer logout quando o JWT expirar
  useEffect(() => {
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp) return;
      const msUntilExpiry = payload.exp * 1000 - Date.now();
      if (msUntilExpiry <= 0) { logout(); return; }
      const timer = setTimeout(() => logout(), msUntilExpiry);
      return () => clearTimeout(timer);
    } catch (_) {}
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    const s = io(import.meta.env.VITE_API_URL ?? window.location.origin, {
      auth: { token },
    });
    setSocket(s);

    // Carrega IDs mutados — para não tocar nem contar unread em conversas
    // silenciadas. Sync via socket conversation:mute_change.
    api.get('/conversations/mutes').then(r => {
      if (Array.isArray(r.data)) mutedIds.current = new Set(r.data);
    }).catch(() => {});

    s.on('message:new', ({ message, conversation }) => {
      if (message?.from_me) return;
      if (!document.hidden) return;
      if (user.role === 'attendant' && conversation?.assigned_to !== user.id) return;
      if (mutedIds.current.has(conversation?.id)) return;
      unreadRef.current += 1;
      document.title = `(${unreadRef.current}) ${originalTitle.current}`;
      playNotificationSound();
    });

    s.on('conversation:mute_change', ({ conversation_id, muted }) => {
      if (muted) mutedIds.current.add(conversation_id);
      else mutedIds.current.delete(conversation_id);
    });

    // Badge no separador para mensagens internas também (quando user está fora da janela)
    s.on('internal:message', ({ message, thread_id }) => {
      if (message?.from_user_id === user.id) return;
      if (!document.hidden) return;
      if (window.__activeThreadId === thread_id) return;
      unreadRef.current += 1;
      document.title = `(${unreadRef.current}) ${originalTitle.current}`;
      playNotificationSound();
    });

    const resetTitle = () => {
      if (!document.hidden) { unreadRef.current = 0; document.title = originalTitle.current; }
    };
    document.addEventListener('visibilitychange', resetTitle);

    return () => { s.disconnect(); document.removeEventListener('visibilitychange', resetTitle); };
  }, [token, user]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888' }}>
        A carregar...
      </div>
    );
  }

  if (!user) return <Login />;
  if (user.role === 'owner') return <AdminPanel socket={socket} />;
  if (user.role === 'supervisor') return <SupervisorLayout socket={socket} />;
  return <AttendantPanel socket={socket} />;
}

export default function Root() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
