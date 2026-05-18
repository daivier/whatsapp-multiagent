import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AttendantPanel from './pages/AttendantPanel';
import AdminPanel from './pages/AdminPanel';
import { io } from 'socket.io-client';

function App() {
  const { user, token, loading } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token || !user) return;
    const s = io(import.meta.env.VITE_API_URL || 'http://localhost:3001', {
      auth: { token },
    });
    setSocket(s);
    return () => s.disconnect();
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
