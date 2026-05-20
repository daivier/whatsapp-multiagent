import { useEffect, useState, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AttendantPanel from './pages/AttendantPanel';
import AdminPanel from './pages/AdminPanel';
import { io } from 'socket.io-client';

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
  const { user, token, loading } = useAuth();
  const [socket, setSocket] = useState(null);
  const unreadRef = useRef(0);
  const originalTitle = useRef(document.title);

  useEffect(() => {
    if (!token || !user) return;
    const s = io(import.meta.env.VITE_API_URL ?? window.location.origin, {
      auth: { token },
    });
    setSocket(s);

    s.on('message:new', ({ message, conversation }) => {
      if (message?.from_me) return;
      if (!document.hidden) return;
      if (user.role === 'attendant' && conversation?.assigned_to !== user.id) return;
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
  return <AttendantPanel socket={socket} />;
}

export default function Root() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
