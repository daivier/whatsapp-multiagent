import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

const STATUS_COLOR = { online: '#22c55e', busy: '#f97316', away: '#eab308', offline: '#9ca3af' };
const STATUS_LABEL = { online: 'Online', busy: 'Ocupado', away: 'Ausente', offline: 'Offline' };

function fmt(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes}min`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function msgAge(dateStr) {
  if (!dateStr) return '—';
  const d = dateStr.endsWith('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = Math.floor((Date.now() - new Date(d)) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function KpiCard({ label, value, color, sub, icon }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderTop: `3px solid ${color}`, borderRadius: 'var(--r-lg)',
      padding: '1.1rem 1.25rem', boxShadow: 'var(--sh)', flex: '1 1 130px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{icon}</span>
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1, marginBottom: '0.2rem' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--hint)' }}>{sub}</div>}
    </div>
  );
}

function HourChart({ data }) {
  if (!data || data.length === 0) return (
    <div style={{ textAlign: 'center', color: 'var(--hint)', fontSize: '0.8rem', padding: '2rem 0' }}>Sem dados hoje</div>
  );
  const max = Math.max(...data.map(d => d.total), 1);
  const H = 64;
  const hours = Array.from({ length: 24 }, (_, i) => {
    const h = String(i).padStart(2, '0');
    const found = data.find(d => d.hour === h);
    return { hour: h, total: found?.total || 0 };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: `${H + 20}px`, paddingTop: '4px' }}>
      {hours.map(({ hour, total }) => {
        const px = total > 0 ? Math.max(Math.round((total / max) * H), 4) : 2;
        const isNow = parseInt(hour) === new Date().getHours();
        return (
          <div key={hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}
            title={`${hour}h: ${total}`}>
            <div style={{
              width: '100%', height: `${px}px`,
              background: isNow ? 'var(--accent)' : total > 0 ? 'var(--accent-l)' : 'var(--border)',
              borderRadius: '2px 2px 0 0', transition: 'height 0.3s',
              border: isNow ? '1px solid var(--accent)' : 'none',
            }} />
            {(parseInt(hour) % 4 === 0) && (
              <span style={{ fontSize: '0.55rem', color: 'var(--hint)', position: 'absolute', bottom: '-14px' }}>{hour}h</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AttendantCards({ attendants, expanded, onToggle }) {
  if (!attendants || attendants.length === 0)
    return <p style={{ color: 'var(--hint)', fontSize: '0.82rem', textAlign: 'center', padding: '1.5rem 0' }}>Sem atendentes registados.</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
      {attendants.map(att => {
        const color = STATUS_COLOR[att.status] || STATUS_COLOR.offline;
        const isOnline = att.status !== 'offline';
        const isExp = expanded[att.id];
        const convs = att.conversations || [];

        return (
          <div key={att.id} style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderTop: `3px solid ${color}`, borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh)', overflow: 'hidden',
            opacity: isOnline ? 1 : 0.6, transition: 'opacity 0.2s',
          }}>
            {/* Header */}
            <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: color + '18', border: `2px solid ${color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '1rem', color,
              }}>
                {att.name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>
                    {att.name}
                  </span>
                  {att.on_shift
                    ? <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '999px', background: '#22c55e20', color: '#22c55e', fontWeight: 700, border: '1px solid #22c55e40', flexShrink: 0 }}>TURNO</span>
                    : <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '999px', background: 'var(--border)', color: 'var(--hint)', fontWeight: 600, flexShrink: 0 }}>FORA</span>
                  }
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: isOnline ? `0 0 0 3px ${color}30` : 'none' }} />
                  <span style={{ fontSize: '0.75rem', color, fontWeight: 600 }}>{STATUS_LABEL[att.status] || att.status}</span>
                </div>
              </div>
              {/* Counts */}
              <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                <div style={{ textAlign: 'center', background: 'var(--accent-l)', borderRadius: 'var(--r-sm)', padding: '0.25rem 0.5rem', minWidth: '36px' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--accent)', lineHeight: 1 }}>{att.open_count || 0}</div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--muted)', fontWeight: 500 }}>abertas</div>
                </div>
                {(att.waiting_count || 0) > 0 && (
                  <div style={{ textAlign: 'center', background: '#f9731618', borderRadius: 'var(--r-sm)', padding: '0.25rem 0.5rem', minWidth: '36px', border: '1px solid #f9731630' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f97316', lineHeight: 1 }}>{att.waiting_count}</div>
                    <div style={{ fontSize: '0.58rem', color: 'var(--muted)', fontWeight: 500 }}>espera</div>
                  </div>
                )}
              </div>
            </div>

            {/* Toggle conversas */}
            {convs.length > 0 ? (
              <>
                <button onClick={() => onToggle(att.id)}
                  style={{
                    width: '100%', padding: '0.4rem 1rem',
                    background: 'none', border: 'none', borderTop: '1px solid var(--border)',
                    cursor: 'pointer', color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span>{convs.length} conversa{convs.length !== 1 ? 's' : ''} activa{convs.length !== 1 ? 's' : ''}</span>
                  <span style={{ fontSize: '0.68rem', opacity: 0.6 }}>{isExp ? '▲' : '▼'}</span>
                </button>
                {isExp && (
                  <div>
                    {convs.map(conv => (
                      <div key={conv.id} style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: conv.priority === 'urgent' ? '#ef4444' : conv.priority === 'low' ? '#9ca3af' : 'var(--accent)' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.contact_name || conv.phone}
                          </div>
                          {conv.last_message && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                              {conv.last_message}
                            </div>
                          )}
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--hint)' }}>{msgAge(conv.updated_at)}</span>
                          {conv.unread_count > 0 && (
                            <span style={{ background: '#ef4444', color: '#fff', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 700, padding: '1px 5px' }}>
                              {conv.unread_count}
                            </span>
                          )}
                          {conv.status === 'waiting' && (
                            <span style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '999px', background: '#f9731620', color: '#f97316', fontWeight: 700 }}>espera</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ borderTop: '1px solid var(--border)', padding: '0.55rem 1rem', color: 'var(--hint)', fontSize: '0.75rem', textAlign: 'center' }}>
                Sem conversas activas
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage({ socket }) {
  const [dash, setDash] = useState(null);
  const [supervisor, setSupervisor] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [expanded, setExpanded] = useState({});
  const dashLoading = useRef(false);
  const supLoading = useRef(false);

  const loadDash = useCallback(async () => {
    if (dashLoading.current) return;
    dashLoading.current = true;
    try {
      const { data } = await api.get('/conversations/dashboard');
      setDash(data);
      setLastUpdate(new Date());
    } catch (e) { console.error('[dash]', e); }
    finally { dashLoading.current = false; setLoading(false); }
  }, []);

  const loadSupervisor = useCallback(async () => {
    if (supLoading.current) return;
    supLoading.current = true;
    try {
      const { data } = await api.get('/users/supervisor');
      setSupervisor(Array.isArray(data) ? data : []);
    } catch (e) { console.error('[supervisor]', e); }
    finally { supLoading.current = false; }
  }, []);

  useEffect(() => {
    loadDash(); loadSupervisor();
    const t1 = setInterval(loadDash, 30000);
    const t2 = setInterval(loadSupervisor, 15000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadDash, loadSupervisor]);

  useEffect(() => {
    if (!socket) return;
    function onConvUpdated() { loadDash(); loadSupervisor(); }
    function onUserStatus({ userId, status }) {
      setSupervisor(prev => prev.map(a => a.id === userId ? { ...a, status } : a));
      setDash(prev => prev ? { ...prev, attendants: prev.attendants?.map(a => a.id === userId ? { ...a, status } : a) } : prev);
    }
    socket.on('conversation:updated', onConvUpdated);
    socket.on('message:new', onConvUpdated);
    socket.on('user:status', onUserStatus);
    return () => {
      socket.off('conversation:updated', onConvUpdated);
      socket.off('message:new', onConvUpdated);
      socket.off('user:status', onUserStatus);
    };
  }, [socket, loadDash, loadSupervisor]);

  const toggleExpanded = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  if (loading) return <div style={{ padding: '2rem', color: 'var(--muted)' }}>A carregar dashboard...</div>;
  if (!dash) return <div style={{ padding: '2rem', color: 'var(--danger)' }}>Erro ao carregar dados.</div>;

  const { live, tmaToday, firstResponseToday, hourly, atRisk, slaMinutes, totals, byDepartment } = dash;
  const onlineCount = supervisor.filter(a => a.status !== 'offline').length;
  const closedPct = live.total_today > 0 ? Math.round((live.closed_today / live.total_today) * 100) : 0;

  return (
    <div style={{ padding: '1.5rem 2rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
          📊 Dashboard
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 400, color: 'var(--hint)' }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </span>
        </h2>
        <span style={{ fontSize: '0.7rem', color: 'var(--hint)' }}>
          ↻ {lastUpdate?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) || '—'}
        </span>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <KpiCard label="Em espera"    value={live.waiting}       color="#f97316"        icon="⏳" sub={live.waiting > 0 ? 'aguardam atendimento' : 'tudo atendido'} />
        <KpiCard label="Abertas"      value={live.open}          color="var(--accent)"  icon="💬" sub={`${onlineCount} atendente${onlineCount !== 1 ? 's' : ''} online`} />
        <KpiCard label="Fechadas hoje" value={live.closed_today} color="#22c55e"        icon="✅" sub={`${closedPct}% do total de hoje`} />
        <KpiCard label="Total hoje"   value={live.total_today}   color="var(--muted)"   icon="📋" sub="conversas iniciadas" />
        <KpiCard label="TMA médio"    value={fmt(tmaToday)}      color="#8b5cf6"        icon="⏱" sub="tempo médio de atendimento" />
        <KpiCard label="1ª Resposta"  value={fmt(firstResponseToday)} color="#3b82f6"  icon="⚡" sub="tempo até 1ª resposta" />
      </div>

      {/* Alerta SLA */}
      {live.sla_breached > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #ef4444', borderRadius: 'var(--r-md)', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          <span style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.9rem' }}>
            {live.sla_breached} conversa{live.sla_breached !== 1 ? 's' : ''} a ultrapassar o SLA
            <span style={{ fontWeight: 400, marginLeft: '0.4rem' }}>(limite: {slaMinutes} min)</span>
          </span>
        </div>
      )}

      {/* Por departamento — só aparece se houver departamentos criados */}
      {Array.isArray(byDepartment) && byDepartment.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem 1.25rem', boxShadow: 'var(--sh)', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>🏢 Por departamento</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem' }}>
            {byDepartment.map(d => {
              const breached = d.sla_breached > 0;
              return (
                <div key={d.id} style={{
                  background: 'var(--bg)', borderRadius: 'var(--r-md)',
                  padding: '0.7rem 0.85rem',
                  borderLeft: `4px solid ${d.color || '#6b7280'}`,
                  border: breached ? '1px solid #fecaca' : '1px solid var(--border)',
                  boxShadow: breached ? 'inset 0 0 0 1px #fee2e2' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.color || '#6b7280', flexShrink: 0 }} />
                    <strong style={{ fontSize: '0.88rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</strong>
                    <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--hint)', flexShrink: 0 }}>
                      ⏱ {d.sla_effective}m{!d.sla_minutes && '*'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem' }}>
                    <span><strong style={{ color: 'var(--accent)' }}>{d.open_count}</strong> <span style={{ color: 'var(--muted)' }}>abertas</span></span>
                    <span><strong style={{ color: '#f97316' }}>{d.waiting_count}</strong> <span style={{ color: 'var(--muted)' }}>espera</span></span>
                    {breached && (
                      <span style={{ marginLeft: 'auto', background: '#fef2f2', color: '#dc2626', borderRadius: '999px', padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700 }}>
                        ⏰ {d.sla_breached} SLA
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ margin: '0.6rem 0 0', fontSize: '0.68rem', color: 'var(--hint)' }}>
            * SLA herdado do global ({slaMinutes} min). Define um SLA específico no formulário do departamento.
          </p>
        </div>
      )}

      {/* Volume + Risco SLA */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem', boxShadow: 'var(--sh)' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>📈 Volume hoje (por hora)</h3>
          <HourChart data={hourly} />
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem', boxShadow: 'var(--sh)' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>⏰ Conversas mais antigas</h3>
          {atRisk.length === 0 ? (
            <p style={{ color: 'var(--success)', fontSize: '0.82rem', textAlign: 'center', padding: '1rem 0' }}>✓ Sem conversas pendentes</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {atRisk.map(c => {
                const over = c.minutes_open > slaMinutes;
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.6rem', borderRadius: 'var(--r-sm)', background: over ? '#fef2f2' : 'var(--bg)', border: over ? '1px solid #fecaca' : '1px solid transparent' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contact_name || c.phone}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--hint)' }}>{c.attendant_name || 'Sem atendente'} · {c.status === 'waiting' ? '⏳ espera' : '💬 aberta'}</div>
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, flexShrink: 0, color: over ? '#dc2626' : c.minutes_open > slaMinutes * 0.7 ? '#f97316' : 'var(--muted)' }}>
                      {fmt(c.minutes_open)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Atendentes — cards completos com drill-down (ex-Supervisor) */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem 1.25rem', boxShadow: 'var(--sh)', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>👥 Atendentes em tempo real</h3>
          <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--hint)' }}>
            {[['online','#22c55e'],['busy','#f97316'],['away','#eab308'],['offline','#9ca3af']].map(([s, c]) => {
              const cnt = supervisor.filter(a => a.status === s).length;
              if (cnt === 0) return null;
              return <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block' }} />{cnt} {STATUS_LABEL[s]}</span>;
            })}
          </div>
        </div>
        <AttendantCards attendants={supervisor} expanded={expanded} onToggle={toggleExpanded} />
      </div>

      {/* Totais históricos */}
      {totals && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem 1.25rem', boxShadow: 'var(--sh)', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>📦 Totais históricos</h3>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {[['Total', totals.total, 'var(--muted)'], ['Em espera', totals.waiting, '#f97316'], ['Abertas', totals.open, 'var(--accent)'], ['Fechadas', totals.closed, '#22c55e']].map(([label, value, color]) => (
              <div key={label} style={{ textAlign: 'center', minWidth: '60px' }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--hint)', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ fontSize: '0.7rem', color: 'var(--hint)', textAlign: 'right' }}>
        Dashboard: ↻ 30s · Atendentes: ↻ 15s · Socket em tempo real
      </p>
    </div>
  );
}
