import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null); // { plan, label, limits:{maxLinhas,maxAtendentes}, features:[] }

  useEffect(() => {
    if (!token) { setLoading(false); setPlan(null); return; }
    api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setUser(r.data.user))
      .catch(() => { localStorage.removeItem('token'); setToken(null); })
      .finally(() => setLoading(false));
    // Plano do tenant — para esconder funcionalidades e mostrar upsell.
    api.get('/plan', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlan(r.data))
      .catch(() => setPlan(null));
  }, [token]);

  // Enquanto o plano não carrega, assume-se permitido (o servidor é que bloqueia
  // de verdade — isto é só cosmético e evita "piscar" os menus).
  const hasFeature = (name) => !plan || (plan.features || []).includes(name);

  // Reagir ao evento global de logout forçado (token expirado detectado pelo api interceptor)
  useEffect(() => {
    function onForceLogout() { logout(); }
    window.addEventListener('auth:force-logout', onForceLogout);
    return () => window.removeEventListener('auth:force-logout', onForceLogout);
  }, []);

  function login(newToken, newUser) {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, plan, hasFeature }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
