import { useState, useEffect, useCallback } from 'react';
import api from '../api';

/* ─── helpers ─────────────────────────────────────────── */
function fmtMinutes(m) {
  if (m == null || m === '') return '—';
  const n = parseFloat(m);
  if (isNaN(n)) return '—';
  if (n < 1) return '< 1 min';
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const min = Math.round(n % 60);
  return min > 0 ? `${h}h ${min}min` : `${h}h`;
}

function fmtDay(str) {
  if (!str) return '';
  const [, m, d] = str.split('-');
  return `${d}/${m}`;
}

/* ─── sub-components ──────────────────────────────────── */
function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={S.statCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.2rem' }}>{icon}</span>
        <span style={S.statLabel}>{label}</span>
      </div>
      <p style={{ ...S.statValue, color: color || 'var(--text)' }}>{value}</p>
      {sub && <p style={S.statSub}>{sub}</p>}
    </div>
  );
}

function HourChart({ byHour }) {
  const max = Math.max(...byHour.map(x => x.total), 1);
  const bars = Array.from({ length: 24 }, (_, h) => {
    const hr = String(h).padStart(2, '0');
    const item = byHour.find(x => x.hour === hr);
    const count = item?.total || 0;
    const pct = (count / max) * 100;
    return { h, hr, count, pct };
  });

  return (
    <div style={S.chartCard}>
      <h3 style={S.chartTitle}>⏰ Volume por Hora</h3>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '90px', marginTop: '0.75rem' }}>
        {bars.map(({ h, hr, count, pct }) => (
          <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              title={`${hr}h: ${count} conversa${count !== 1 ? 's' : ''}`}
              style={{
                width: '100%',
                height: `${Math.max(pct, 2)}%`,
                minHeight: pct > 0 ? '4px' : '2px',
                background: pct > 0 ? 'var(--accent)' : 'var(--accent-l)',
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.3s ease',
                cursor: count > 0 ? 'default' : undefined,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--hint)', marginTop: '4px' }}>
        <span>0h</span><span>4h</span><span>8h</span><span>12h</span><span>16h</span><span>20h</span><span>23h</span>
      </div>
      {byHour.length === 0 && (
        <p style={S.empty}>Sem dados para o período</p>
      )}
    </div>
  );
}

function DayChart({ byDay }) {
  if (!byDay.length) return (
    <div style={S.chartCard}>
      <h3 style={S.chartTitle}>📅 Evolução Diária</h3>
      <p style={S.empty}>Sem dados para o período</p>
    </div>
  );

  const max = Math.max(...byDay.map(x => x.total), 1);

  return (
    <div style={S.chartCard}>
      <h3 style={S.chartTitle}>📅 Evolução Diária</h3>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '80px', marginTop: '0.75rem', overflowX: 'auto' }}>
        {byDay.map(d => {
          const pct = (d.total / max) * 100;
          return (
            <div
              key={d.day}
              title={`${d.day}: ${d.total} conversa${d.total !== 1 ? 's' : ''}`}
              style={{
                minWidth: '10px',
                flex: 1,
                height: `${Math.max(pct, 2)}%`,
                minHeight: '2px',
                background: 'var(--accent)',
                borderRadius: '2px 2px 0 0',
                opacity: 0.65 + (pct / max) * 0.35,
                cursor: 'default',
                transition: 'height 0.3s ease',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--hint)', marginTop: '4px' }}>
        <span>{fmtDay(byDay[0]?.day)}</span>
        {byDay.length > 4 && <span>{fmtDay(byDay[Math.floor(byDay.length / 2)]?.day)}</span>}
        <span>{fmtDay(byDay[byDay.length - 1]?.day)}</span>
      </div>
    </div>
  );
}

function AttendantChart({ byAttendant }) {
  const max = Math.max(...byAttendant.map(x => x.total), 1);

  return (
    <div style={S.chartCard}>
      <h3 style={S.chartTitle}>👥 Por Atendente</h3>
      {byAttendant.length === 0 ? (
        <p style={S.empty}>Sem atendentes</p>
      ) : (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {byAttendant.map(a => {
            const pct = max ? Math.round((a.total / max) * 100) : 0;
            return (
              <div key={a.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{a.name}</span>
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--muted)', flexShrink: 0 }}>
                    <span title="Total de conversas"><strong style={{ color: 'var(--text)' }}>{a.total}</strong> conv</span>
                    <span title="Fechadas" style={{ color: 'var(--success)' }}>✓ {a.closed}</span>
                    <span title="Tempo médio de atendimento" style={{ color: 'var(--accent)' }}>
                      ⏱ {fmtMinutes(a.avg_tma_minutes)}
                    </span>
                  </div>
                </div>
                <div style={{ background: 'var(--accent-l)', borderRadius: '4px', height: '8px' }}>
                  <div style={{
                    width: `${pct}%`, background: 'var(--accent)', height: '8px',
                    borderRadius: '4px', transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── main component ──────────────────────────────────── */
const PERIODS = [
  { key: 'today', label: 'Hoje' },
  { key: 'week',  label: '7 dias' },
  { key: 'month', label: '30 dias' },
  { key: 'all',   label: 'Tudo' },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/conversations/reports', { params: { period } });
      setData(d);
    } catch (_) {}
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  function exportCSV() {
    api.get('/conversations/export', { responseType: 'blob' })
      .then(({ data: blob }) => {
        const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversas_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('Erro ao exportar'));
  }

  const s = data?.summary;

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.topBar}>
        <h2 style={S.title}>📊 Relatórios</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={S.periodTabs}>
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                style={{ ...S.periodBtn, ...(period === p.key ? S.periodBtnActive : {}) }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={exportCSV} style={S.exportBtn}>📤 Exportar CSV</button>
        </div>
      </div>

      {loading ? (
        <p style={S.empty}>A carregar...</p>
      ) : !data ? (
        <p style={S.empty}>Erro ao carregar dados</p>
      ) : (
        <div style={S.body}>

          {/* Summary cards */}
          <div style={S.statsRow}>
            <StatCard
              icon="💬" label="Conversas" color="var(--accent)"
              value={s?.total_conversations ?? 0}
              sub={`${s?.open_conversations ?? 0} abertas`}
            />
            <StatCard
              icon="✅" label="Fechadas" color="var(--success)"
              value={s?.closed_conversations ?? 0}
              sub={s?.total_conversations
                ? `${Math.round(((s.closed_conversations || 0) / s.total_conversations) * 100)}% do total`
                : undefined}
            />
            <StatCard
              icon="⏱" label="TMA Médio" color="var(--accent)"
              value={fmtMinutes(s?.avg_tma_minutes)}
              sub="tempo médio de atendimento"
            />
            <StatCard
              icon="⚡" label="1ª Resposta" color="var(--warn)"
              value={fmtMinutes(data.avgResponse?.avg_minutes)}
              sub="tempo até 1ª resposta"
            />
          </div>

          {/* Middle row: attendants + hour chart */}
          <div style={S.midRow}>
            <div style={{ flex: '1 1 340px', minWidth: 0 }}>
              <AttendantChart byAttendant={data.byAttendant} />
            </div>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <HourChart byHour={data.byHour} />
            </div>
          </div>

          {/* Day chart */}
          {period !== 'today' && (
            <DayChart byDay={data.byDay} />
          )}

        </div>
      )}
    </div>
  );
}

/* ─── styles ──────────────────────────────────────────── */
const S = {
  page: { flex: 1, overflowY: 'auto', padding: '1.5rem', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' },
  title: { margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' },

  periodTabs: { display: 'flex', background: 'var(--border)', borderRadius: 'var(--r-sm)', padding: '2px', gap: '2px' },
  periodBtn: { padding: '0.28rem 0.75rem', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500, color: 'var(--muted)', background: 'transparent', transition: 'all 0.15s' },
  periodBtnActive: { background: 'var(--card)', color: 'var(--accent)', fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  exportBtn: { padding: '0.3rem 0.85rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500 },

  body: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },

  statsRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  statCard: {
    flex: '1 1 150px', background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '1rem 1.1rem', boxShadow: 'var(--sh)',
  },
  statLabel: { fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  statValue: { margin: '0.1rem 0 0.15rem', fontSize: '1.85rem', fontWeight: 800, lineHeight: 1 },
  statSub: { margin: 0, fontSize: '0.72rem', color: 'var(--hint)' },

  midRow: { display: 'flex', gap: '1.25rem', flexWrap: 'wrap' },

  chartCard: {
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '1rem 1.1rem', boxShadow: 'var(--sh)',
  },
  chartTitle: { margin: 0, fontSize: '0.82rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' },

  empty: { textAlign: 'center', color: 'var(--hint)', padding: '2rem', fontSize: '0.88rem', margin: 0 },
};
