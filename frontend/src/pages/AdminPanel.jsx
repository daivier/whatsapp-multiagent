import { useState, useEffect } from 'react';
import api from '../api';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import { useAuth } from '../context/AuthContext';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

function SimpleBar({ label, value, max, color }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '2px' }}>
        <span>{label}</span><span>{value}</span>
      </div>
      <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '8px' }}>
        <div style={{ width: `${pct}%`, background: color || '#25D366', height: '8px', borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function AdminPanel({ socket }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('conversations');
  const [selectedConv, setSelectedConv] = useState(null);
  const [attendants, setAttendants] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [reports, setReports] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [whatsappReady, setWhatsappReady] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [transferTo, setTransferTo] = useState('');
  const [userStatuses, setUserStatuses] = useState({});
  const [listKey, setListKey] = useState(0);

  // Quick Replies
  const [quickReplies, setQuickReplies] = useState([]);
  const [newQR, setNewQR] = useState({ shortcut: '', body: '' });

  // Tags
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState({ name: '', color: '#25D366' });

  // Settings / Bot
  const [settings, setSettings] = useState({
    bot_enabled: '0', bot_message: '', business_hours_start: '08:00',
    business_hours_end: '18:00', business_days: '1,2,3,4,5',
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    loadAttendants(); loadMetrics(); checkWhatsapp();
    loadQuickReplies(); loadTags(); loadSettings();
  }, []);

  useEffect(() => {
    if (tab === 'reports') loadReports();
  }, [tab]);

  useEffect(() => {
    if (!socket) return;
    socket.on('whatsapp:qr', (qr) => { setQrCode(qr); setWhatsappReady(false); });
    socket.on('whatsapp:ready', () => { setWhatsappReady(true); setQrCode(null); });
    socket.on('whatsapp:disconnected', () => setWhatsappReady(false));
    socket.on('user:status', ({ userId, status }) => setUserStatuses(prev => ({ ...prev, [userId]: status })));
    return () => {
      socket.off('whatsapp:qr'); socket.off('whatsapp:ready');
      socket.off('whatsapp:disconnected'); socket.off('user:status');
    };
  }, [socket]);

  async function loadAttendants() {
    const { data } = await api.get('/users');
    setAttendants(Array.isArray(data) ? data.filter(u => u.role === 'attendant') : []);
  }
  async function loadMetrics() {
    const { data } = await api.get('/conversations/metrics');
    setMetrics(data);
  }
  async function loadReports() {
    const { data } = await api.get('/conversations/reports');
    setReports(data);
  }
  async function checkWhatsapp() {
    const { data } = await api.get('/whatsapp/status');
    setWhatsappReady(data.isReady);
    if (data.qrCode) setQrCode(data.qrCode);
  }
  async function loadQuickReplies() {
    const { data } = await api.get('/quick-replies');
    setQuickReplies(Array.isArray(data) ? data : []);
  }
  async function loadTags() {
    const { data } = await api.get('/tags');
    setTags(Array.isArray(data) ? data : []);
  }
  async function loadSettings() {
    const { data } = await api.get('/settings');
    setSettings(s => ({ ...s, ...data }));
  }

  async function createAttendant(e) {
    e.preventDefault();
    await api.post('/users', newUser);
    setNewUser({ name: '', email: '', password: '' });
    loadAttendants();
  }
  async function toggleAttendant(id, active) {
    await api.patch(`/users/${id}`, { active: !active });
    loadAttendants();
  }
  async function transferConversation() {
    if (!selectedConv || !transferTo) return;
    try {
      const { data } = await api.post(`/conversations/${selectedConv.id}/transfer`, { attendant_id: parseInt(transferTo) });
      setSelectedConv(data); setTransferTo('');
      alert(`Transferido para ${activeAttendants.find(a => a.id == transferTo)?.name}`);
    } catch (err) {
      alert('Erro ao transferir: ' + (err.response?.data?.error || err.message));
    }
  }
  async function deleteConversation() {
    if (!selectedConv) return;
    if (!confirm(`Eliminar conversa com "${selectedConv.contact_name || selectedConv.phone}"?`)) return;
    await api.delete(`/conversations/${selectedConv.id}`);
    setSelectedConv(null); setListKey(k => k + 1);
  }

  async function addQuickReply(e) {
    e.preventDefault();
    if (!newQR.shortcut || !newQR.body) return;
    await api.post('/quick-replies', newQR);
    setNewQR({ shortcut: '', body: '' }); loadQuickReplies();
  }
  async function deleteQuickReply(id) {
    await api.delete(`/quick-replies/${id}`); loadQuickReplies();
  }
  async function addTag(e) {
    e.preventDefault();
    if (!newTag.name) return;
    await api.post('/tags', newTag);
    setNewTag({ name: '', color: '#25D366' }); loadTags();
  }
  async function deleteTag(id) {
    await api.delete(`/tags/${id}`); loadTags();
  }
  async function saveSettings() {
    await api.patch('/settings', settings);
    setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 2000);
  }

  const activeAttendants = attendants.filter(a => a.active);
  const TABS = [
    ['conversations','Conversas'],['attendants','Atendentes'],['metrics','Métricas'],
    ['reports','Relatórios'],['quickreplies','Respostas Rápidas'],['tags','Etiquetas'],
    ['bot','Bot'],['whatsapp','WhatsApp'],
  ];

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <div style={styles.logoArea}>
            <span style={{ fontSize: '1.5rem' }}>💬</span>
            <div>
              <p style={styles.userName}>{import.meta.env.VITE_TENANT_NAME || 'WhatsApp Multi-Atendente'}</p>
              <span style={styles.ownerBadge}>{user.name}</span>
            </div>
          </div>
          <nav style={styles.nav}>
            {TABS.map(([key, label]) => (
              <button key={key} style={{ ...styles.navBtn, ...(tab === key ? styles.navActive : {}) }} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>
        </div>
        <button style={styles.logoutBtn} onClick={logout}>Sair</button>
      </aside>

      <main style={styles.main}>

        {/* CONVERSAS */}
        {tab === 'conversations' && (
          <div style={styles.chatLayout}>
            <div style={styles.listPane}>
              <ConversationList key={listKey} socket={socket} selected={selectedConv} onSelect={setSelectedConv} />
            </div>
            <div style={styles.chatPane}>
              {selectedConv && (
                <div style={{ padding: '0.5rem 1rem', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {activeAttendants.length === 0 ? (
                    <span style={{ color: '#e53e3e', fontSize: '0.85rem' }}>Sem atendentes activos</span>
                  ) : (
                    <>
                      <select value={transferTo} onChange={e => setTransferTo(e.target.value)} style={styles.select}>
                        <option value="">Transferir para...</option>
                        {activeAttendants.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({userStatuses[a.id] || a.status || 'offline'})</option>
                        ))}
                      </select>
                      <button style={styles.transferBtn} onClick={transferConversation} disabled={!transferTo}>Transferir</button>
                    </>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#888' }}>
                    Atendente: <strong>{selectedConv.attendant_name || 'Sem atendente'}</strong>
                  </span>
                </div>
              )}
              <ChatWindow conversation={selectedConv} socket={socket} onClose={() => setSelectedConv(null)} onDelete={deleteConversation} />
            </div>
          </div>
        )}

        {/* ATENDENTES */}
        {tab === 'attendants' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Atendentes</h2>
            <form onSubmit={createAttendant} style={styles.form}>
              <input style={styles.input} placeholder="Nome" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} required />
              <input style={styles.input} type="email" placeholder="Email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} required />
              <input style={styles.input} type="password" placeholder="Password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} required />
              <button style={styles.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={styles.table}>
              <thead><tr><th>Nome</th><th>Email</th><th>Estado</th><th>Ativo</th><th></th></tr></thead>
              <tbody>
                {attendants.map(a => (
                  <tr key={a.id}>
                    <td>{a.name}</td><td>{a.email}</td>
                    <td><span style={{ color: a.status === 'online' ? '#10b981' : a.status === 'busy' ? '#f59e0b' : '#6b7280' }}>{a.status}</span></td>
                    <td>{a.active ? 'Sim' : 'Não'}</td>
                    <td><button style={styles.toggleBtn} onClick={() => toggleAttendant(a.id, a.active)}>{a.active ? 'Desativar' : 'Ativar'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MÉTRICAS */}
        {tab === 'metrics' && metrics && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Métricas</h2>
            <div style={styles.cards}>
              {[['Total', metrics.total, '#3b82f6'], ['Aguarda', metrics.waiting, '#f59e0b'], ['Abertas', metrics.open, '#10b981'], ['Fechadas', metrics.closed, '#6b7280']].map(([label, value, color]) => (
                <div key={label} style={{ ...styles.card, borderTop: `4px solid ${color}` }}>
                  <p style={styles.cardValue}>{value}</p>
                  <p style={styles.cardLabel}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RELATÓRIOS */}
        {tab === 'reports' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Relatórios</h2>
            {!reports ? <p style={{ color: '#999' }}>A carregar...</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div>
                  <h3 style={styles.subTitle}>Tempo médio de resposta</h3>
                  <p style={{ fontSize: '2rem', fontWeight: 700, color: '#25D366' }}>
                    {reports.avgResponse?.avg_minutes ?? '—'} min
                  </p>
                </div>
                <div>
                  <h3 style={styles.subTitle}>Por atendente</h3>
                  {reports.byAttendant.map(a => (
                    <SimpleBar key={a.name} label={a.name} value={a.total}
                      max={Math.max(...reports.byAttendant.map(x => x.total), 1)} color="#3b82f6" />
                  ))}
                </div>
                <div>
                  <h3 style={styles.subTitle}>Por hora (últimos 7 dias)</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const hr = String(h).padStart(2, '0');
                      const found = reports.byHour.find(x => x.hour === hr);
                      const max = Math.max(...reports.byHour.map(x => x.total), 1);
                      const pct = found ? (found.total / max) * 100 : 0;
                      return (
                        <div key={h} title={`${hr}h: ${found?.total || 0}`}
                          style={{ flex: 1, background: pct > 0 ? '#25D366' : '#e5e7eb', height: `${Math.max(pct, 2)}%`, borderRadius: '2px 2px 0 0', minHeight: '2px' }} />
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#999', marginTop: '2px' }}>
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
                <div>
                  <h3 style={styles.subTitle}>Por dia (últimos 30 dias)</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '80px', flexWrap: 'nowrap', overflowX: 'auto' }}>
                    {reports.byDay.map(d => {
                      const max = Math.max(...reports.byDay.map(x => x.total), 1);
                      const pct = (d.total / max) * 100;
                      return (
                        <div key={d.day} title={`${d.day}: ${d.total}`}
                          style={{ minWidth: '8px', flex: 1, background: '#3b82f6', height: `${Math.max(pct, 2)}%`, borderRadius: '2px 2px 0 0' }} />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RESPOSTAS RÁPIDAS */}
        {tab === 'quickreplies' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Respostas Rápidas</h2>
            <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>Os atendentes digitam <strong>/atalho</strong> no chat para usar.</p>
            <form onSubmit={addQuickReply} style={styles.form}>
              <input style={{ ...styles.input, width: '120px' }} placeholder="/atalho" value={newQR.shortcut}
                onChange={e => setNewQR(p => ({ ...p, shortcut: e.target.value }))} required />
              <input style={{ ...styles.input, flex: 1 }} placeholder="Texto da resposta" value={newQR.body}
                onChange={e => setNewQR(p => ({ ...p, body: e.target.value }))} required />
              <button style={styles.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={styles.table}>
              <thead><tr><th>Atalho</th><th>Mensagem</th><th></th></tr></thead>
              <tbody>
                {quickReplies.map(qr => (
                  <tr key={qr.id}>
                    <td><strong style={{ color: '#25D366' }}>/{qr.shortcut}</strong></td>
                    <td style={{ maxWidth: '400px', wordBreak: 'break-word' }}>{qr.body}</td>
                    <td><button style={{ ...styles.toggleBtn, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => deleteQuickReply(qr.id)}>Eliminar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ETIQUETAS */}
        {tab === 'tags' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Etiquetas</h2>
            <form onSubmit={addTag} style={styles.form}>
              <input style={styles.input} placeholder="Nome da etiqueta" value={newTag.name}
                onChange={e => setNewTag(p => ({ ...p, name: e.target.value }))} required />
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setNewTag(p => ({ ...p, color: c }))}
                    style={{ width: 24, height: 24, background: c, borderRadius: '50%', cursor: 'pointer', border: newTag.color === c ? '3px solid #000' : '3px solid transparent' }} />
                ))}
              </div>
              <button style={styles.addBtn} type="submit">Adicionar</button>
            </form>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {tags.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: t.color + '22', border: `1px solid ${t.color}`, borderRadius: '999px', padding: '0.25rem 0.75rem' }}>
                  <span style={{ color: t.color, fontWeight: 600, fontSize: '0.85rem' }}>{t.name}</span>
                  <button onClick={() => deleteTag(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.color, fontSize: '0.8rem', padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BOT */}
        {tab === 'bot' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Bot de Triagem</h2>
            <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Envia resposta automática fora do horário ou quando todos estão offline.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px' }}>
              <label style={styles.settingRow}>
                <span>Ativar bot</span>
                <input type="checkbox" checked={settings.bot_enabled === '1'}
                  onChange={e => setSettings(s => ({ ...s, bot_enabled: e.target.checked ? '1' : '0' }))} />
              </label>
              <label style={styles.settingRow}>
                <span>Dias de trabalho</span>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {[['Dom','0'],['Seg','1'],['Ter','2'],['Qua','3'],['Qui','4'],['Sex','5'],['Sáb','6']].map(([label, val]) => {
                    const active = settings.business_days.split(',').includes(val);
                    return (
                      <button key={val} onClick={() => {
                        const days = settings.business_days.split(',').filter(Boolean);
                        const next = active ? days.filter(d => d !== val) : [...days, val];
                        setSettings(s => ({ ...s, business_days: next.sort().join(',') }));
                      }} style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #ddd', background: active ? '#25D366' : 'none', color: active ? '#fff' : '#555', cursor: 'pointer', fontSize: '0.75rem' }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </label>
              <div style={styles.settingRow}>
                <span>Horário</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="time" style={styles.input} value={settings.business_hours_start}
                    onChange={e => setSettings(s => ({ ...s, business_hours_start: e.target.value }))} />
                  <span>até</span>
                  <input type="time" style={styles.input} value={settings.business_hours_end}
                    onChange={e => setSettings(s => ({ ...s, business_hours_end: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Mensagem automática</label>
                <textarea style={{ ...styles.input, width: '100%', resize: 'vertical', minHeight: '80px', boxSizing: 'border-box' }}
                  value={settings.bot_message}
                  onChange={e => setSettings(s => ({ ...s, bot_message: e.target.value }))} />
              </div>
              <button style={{ ...styles.addBtn, alignSelf: 'flex-start' }} onClick={saveSettings}>
                {settingsSaved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* WHATSAPP */}
        {tab === 'whatsapp' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>WhatsApp</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: whatsappReady ? '#10b981' : '#ef4444' }} />
              <span>{whatsappReady ? 'Conectado' : 'Desconectado'}</span>
              {whatsappReady && (
                <button style={{ padding: '0.35rem 1rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                  disabled={disconnecting}
                  onClick={async () => {
                    if (!confirm('Tens a certeza? O WhatsApp vai desligar e precisas de escanear o QR novamente.')) return;
                    setDisconnecting(true);
                    try { await api.post('/whatsapp/disconnect'); } catch (_) {}
                    setDisconnecting(false); setWhatsappReady(false); setQrCode(null);
                  }}>
                  {disconnecting ? 'A desligar...' : 'Desligar WhatsApp'}
                </button>
              )}
            </div>
            {!whatsappReady && qrCode && (
              <div>
                <p style={{ marginBottom: '1rem', color: '#555' }}>Escaneia o QR Code com o WhatsApp do número da loja:</p>
                <img src={qrCode} alt="QR Code" style={{ width: 240, height: 240, border: '1px solid #ddd', borderRadius: '8px' }} />
              </div>
            )}
            {!whatsappReady && !qrCode && <p style={{ color: '#999' }}>A aguardar QR Code...</p>}
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: '200px', background: '#1a1a2e', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '1rem 0', overflowY: 'auto' },
  sidebarTop: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  logoArea: { display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0 1rem' },
  userName: { margin: 0, color: '#fff', fontSize: '0.8rem', fontWeight: 600 },
  ownerBadge: { background: '#25D366', color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem' },
  nav: { display: 'flex', flexDirection: 'column' },
  navBtn: { padding: '0.65rem 1rem', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem' },
  navActive: { background: '#25D36622', color: '#25D366', fontWeight: 600 },
  logoutBtn: { margin: '0 1rem', padding: '0.5rem', background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: '6px', cursor: 'pointer' },
  main: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  chatLayout: { display: 'flex', height: '100%' },
  listPane: { width: '320px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  section: { padding: '1.5rem 2rem', overflowY: 'auto', height: '100%' },
  sectionTitle: { marginTop: 0, marginBottom: '1.5rem', fontSize: '1.2rem' },
  subTitle: { marginTop: 0, marginBottom: '0.75rem', fontSize: '1rem', color: '#555' },
  form: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.9rem' },
  addBtn: { padding: '0.5rem 1rem', background: '#25D366', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  toggleBtn: { padding: '0.25rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', background: 'none' },
  cards: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  card: { background: '#fff', padding: '1.5rem', borderRadius: '10px', minWidth: '140px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' },
  cardValue: { fontSize: '2rem', fontWeight: 700, margin: 0 },
  cardLabel: { color: '#888', margin: '0.25rem 0 0', fontSize: '0.9rem' },
  select: { padding: '0.4rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' },
  transferBtn: { padding: '0.4rem 1rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' },
  settingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' },
};
