import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

const STATUS_COLOR = {
  online:  '#22c55e',
  busy:    '#f97316',
  away:    '#eab308',
  offline: '#9ca3af',
};
const STATUS_LABEL = {
  online:  'Online',
  busy:    'Ocupado',
  away:    'Ausente',
  offline: 'Offline',
};

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Math.floor((Date.now() - new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ fontSize: '0.82rem', color: 'var(--hint)', fontVariantNumeric: 'tabular-nums' }}>
      {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

export default function SupervisorPanel({ socket }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data: res } = await api.get('/users/supervisor');
      setData(res);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('[supervisor] Erro ao carregar:', e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Initial load + 15s auto-refresh
  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Socket real-time updates
  useEffect(() => {
    if (!socket) return;

    function onStatus({ userId, status }) {
      setData(prev => prev.map(a => a.id === userId ? { ...a, status } : a));
    }
    function onConvUpdated() { load(); }

    socket.on('user:status', onStatus);
    socket.on('conversation:updated', onConvUpdated);

    return () => {
      socket.off('user:status', onStatus);
      socket.off('conversation:updated', onConvUpdated);
    };
  }, [socket, load]);

  const toggleExpanded = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const online      = data.filter(a => a.status !== 'offline').length;
  const totalOpen   = data.reduce((s, a) => s + (a.open_count   || 0), 0);
  const totalWait   = data.reduce((s, a) => s + (a.waiting_count || 0), 0);

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> A carregar...
      </div>
    );
  }

  return (
    <div style={{ padding: '1.75rem 2rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>👁️ Painel Supervisor</h2>
          <Clock />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[
            ['Online', online,    STATUS_COLOR.online],
            ['Abertas', totalOpen, 'var(--accent)'],
            ['Espera',  totalWait, '#f97316'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.45rem 0.9rem', boxShadow: 'var(--sh)', textAlign: 'center', minWidth: '60px' }}>
              <div style={{ fontSize: '1.35rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 500, marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
        {data.map(att => {
          const color    = STATUS_COLOR[att.status] || STATUS_COLOR.offline;
          const isOnline = att.status !== 'offline';
          const isExp    = expanded[att.id];
          const convs    = att.conversations || [];

          return (
            <div key={att.id} style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderTop: `3px solid ${color}`,
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--sh)',
              overflow: 'hidden',
              opacity: isOnline ? 1 : 0.6,
              transition: 'opacity 0.2s',
            }}>

              {/* Card header */}
              <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {/* Avatar */}
                <div style={{
                  width: 42, height: 42, borderRadius: '50%',
                  background: color + '18',
                  border: `2px solid ${color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '1.05rem', color, flexShrink: 0,
                }}>
                  {att.name[0].toUpperCase()}
                </div>

                {/* Name + status */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                      {att.name}
                    </span>
                    {att.on_shift ? (
                      <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: '999px', background: '#22c55e20', color: '#22c55e', fontWeight: 700, flexShrink: 0, border: '1px solid #22c55e40' }}>
                        EM TURNO
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: '999px', background: 'var(--border)', color: 'var(--hint)', fontWeight: 600, flexShrink: 0 }}>
                        FORA
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block',
                      boxShadow: isOnline ? `0 0 0 3px ${color}30` : 'none' }} />
                    <span style={{ fontSize: '0.78rem', color, fontWeight: 600 }}>
                      {STATUS_LABEL[att.status] || att.status}
                    </span>
                  </div>
                </div>

                {/* Counts */}
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <div style={{ textAlign: 'center', background: 'var(--accent-l)', borderRadius: 'var(--r-sm)', padding: '0.3rem 0.6rem', minWidth: '38px' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)', lineHeight: 1 }}>{att.open_count || 0}</div>
                    <div style={{ fontSize: '0.58rem', color: 'var(--muted)', fontWeight: 500, marginTop: '1px' }}>abertas</div>
                  </div>
                  {(att.waiting_count || 0) > 0 && (
                    <div style={{ textAlign: 'center', background: '#f9731618', borderRadius: 'var(--r-sm)', padding: '0.3rem 0.6rem', minWidth: '38px', border: '1px solid #f9731630' }}>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f97316', lineHeight: 1 }}>{att.waiting_count}</div>
                      <div style={{ fontSize: '0.58rem', color: 'var(--muted)', fontWeight: 500, marginTop: '1px' }}>espera</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Conversation list */}
              {convs.length > 0 ? (
                <>
                  <button
                    onClick={() => toggleExpanded(att.id)}
                    style={{
                      width: '100%', padding: '0.45rem 1rem',
                      background: 'none', border: 'none', borderTop: '1px solid var(--border)',
                      cursor: 'pointer', color: 'var(--muted)', fontSize: '0.78rem', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <span>{convs.length} conversa{convs.length !== 1 ? 's' : ''} activa{convs.length !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{isExp ? '▲' : '▼'}</span>
                  </button>

                  {isExp && (
                    <div>
                      {convs.map(conv => (
                        <div key={conv.id} style={{
                          padding: '0.55rem 1rem', borderTop: '1px solid var(--border)',
                          display: 'flex', alignItems: 'center', gap: '0.65rem',
                        }}>
                          {/* Priority dot */}
                          <div style={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            background: conv.priority === 'urgent' ? '#ef4444' : conv.priority === 'low' ? '#9ca3af' : 'var(--accent)',
                          }} />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {conv.contact_name || conv.phone}
                            </div>
                            {conv.last_message && (
                              <div style={{ fontSize: '0.74rem', color: 'var(--hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                                {conv.last_message}
                              </div>
                            )}
                          </div>

                          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                            <span style={{ fontSize: '0.68rem', color: 'var(--hint)', fontVariantNumeric: 'tabular-nums' }}>
                              {timeAgo(conv.updated_at)}
                            </span>
                            {conv.unread_count > 0 && (
                              <span style={{
                                background: '#ef4444', color: '#fff',
                                borderRadius: '999px', fontSize: '0.62rem',
                                fontWeight: 700, padding: '1px 5px', lineHeight: 1.4,
                              }}>
                                {conv.unread_count}
                              </span>
                            )}
                            {conv.status === 'waiting' && (
                              <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: '999px', background: '#f9731620', color: '#f97316', fontWeight: 700 }}>
                                espera
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ borderTop: '1px solid var(--border)', padding: '0.65rem 1rem', color: 'var(--hint)', fontSize: '0.77rem', textAlign: 'center' }}>
                  Sem conversas activas
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--hint)', padding: '4rem', fontSize: '0.9rem' }}>
          Sem atendentes registados.
        </div>
      )}

      <p style={{ fontSize: '0.7rem', color: 'var(--hint)', marginTop: '1.25rem', textAlign: 'right' }}>
        ↻ Actualizado automaticamente a cada 15 segundos
        {lastRefresh && ` · última: ${lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
      </p>
    </div>
  );
}
