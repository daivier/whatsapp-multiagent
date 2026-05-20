import { useState, useEffect } from 'react';
import api from '../api';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

function SimpleBar({ label, value, max, color }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '2px', color: 'var(--muted)' }}>
        <span>{label}</span><span style={{ fontWeight: 600, color: 'var(--text)' }}>{value}</span>
      </div>
      <div style={{ background: 'var(--accent-l)', borderRadius: '4px', height: '7px' }}>
        <div style={{ width: `${pct}%`, background: color || 'var(--accent)', height: '7px', borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function AdminPanel({ socket }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('conversations');
  const [selectedConv, setSelectedConv] = useState(null);
  const [takenNotice, setTakenNotice] = useState(null);
  useNotifications(socket, selectedConv, user);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onTaken = ({ conversation_id, contact_name, taken_by_name }) => {
      if (selectedConv?.id === conversation_id) setSelectedConv(null);
      setTakenNotice(`A conversa com "${contact_name}" foi assumida por ${taken_by_name}.`);
      setTimeout(() => setTakenNotice(null), 6000);
    };
    socket.on('conversation:taken', onTaken);
    return () => socket.off('conversation:taken', onTaken);
  }, [socket, selectedConv]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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

  const [quickReplies, setQuickReplies] = useState([]);
  const [newQR, setNewQR] = useState({ shortcut: '', body: '', category: '' });

  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState({ name: '', color: '#25D366' });

  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [editingContact, setEditingContact] = useState(null);

  const [scheduled, setScheduled] = useState([]);
  const [transferLogs, setTransferLogs] = useState([]);
  const [keywordRules, setKeywordRules] = useState([]);
  const [newKR, setNewKR] = useState({ keyword: '', response: '' });

  const [settings, setSettings] = useState({
    bot_enabled: '0', bot_message: '',
    hours_0: 'closed', hours_1: '08:00-18:00', hours_2: '08:00-18:00',
    hours_3: '08:00-18:00', hours_4: '08:00-18:00', hours_5: '08:00-18:00',
    hours_6: '09:00-13:00',
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    loadAttendants(); loadMetrics(); checkWhatsapp();
    loadQuickReplies(); loadTags(); loadSettings();
  }, []);

  useEffect(() => {
    if (tab === 'reports') loadReports();
    if (tab === 'scheduled') loadScheduled();
    if (tab === 'contacts') loadContacts();
    if (tab === 'transfers') loadTransferLogs();
    if (tab === 'automation') { loadKeywordRules(); loadAttendants(); }
  }, [tab]);

  useEffect(() => {
    if (!socket) return;
    socket.on('whatsapp:qr', (qr) => { setQrCode(qr); setWhatsappReady(false); });
    socket.on('whatsapp:ready', () => { setWhatsappReady(true); setQrCode(null); });
    socket.on('whatsapp:disconnected', () => setWhatsappReady(false));
    socket.on('user:status', ({ userId, status }) => setUserStatuses(prev => ({ ...prev, [userId]: status })));
    socket.on('user:shift', () => loadAttendants());
    return () => {
      socket.off('whatsapp:qr'); socket.off('whatsapp:ready');
      socket.off('whatsapp:disconnected'); socket.off('user:status');
      socket.off('user:shift');
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
  async function loadContacts(q = '') {
    const { data } = await api.get('/contacts', { params: q ? { q } : {} });
    setContacts(Array.isArray(data) ? data : []);
  }
  async function saveContact() {
    if (!editingContact) return;
    await api.patch(`/contacts/${editingContact.id}`, {
      name: editingContact.name, notes: editingContact.notes, email: editingContact.email,
    });
    setEditingContact(null);
    loadContacts(contactSearch);
  }
  async function deleteContact(id, name) {
    if (!confirm(`Eliminar contacto "${name}"? Todas as conversas e mensagens deste contacto serão apagadas.`)) return;
    await api.delete(`/contacts/${id}`);
    setEditingContact(null);
    loadContacts(contactSearch);
  }
  async function cleanupInvalidContacts() {
    if (!confirm('Remover todos os contactos inválidos (grupos, broadcasts, newsletters) sem conversas?')) return;
    const { data } = await api.delete('/contacts/cleanup/invalid');
    alert(`${data.deleted} contacto(s) removido(s).`);
    loadContacts(contactSearch);
  }
  async function loadTransferLogs() {
    const { data } = await api.get('/conversations/transfer-logs');
    setTransferLogs(Array.isArray(data) ? data : []);
  }
  async function loadScheduled() {
    const { data } = await api.get('/scheduled-messages');
    setScheduled(Array.isArray(data) ? data : []);
  }
  async function cancelScheduled(id) {
    await api.delete(`/scheduled-messages/${id}`);
    loadScheduled();
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
    setNewQR({ shortcut: '', body: '', category: '' }); loadQuickReplies();
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
  async function loadKeywordRules() {
    const { data } = await api.get('/keyword-rules');
    setKeywordRules(Array.isArray(data) ? data : []);
  }
  async function addKeywordRule(e) {
    e.preventDefault();
    if (!newKR.keyword || !newKR.response) return;
    await api.post('/keyword-rules', newKR);
    setNewKR({ keyword: '', response: '' }); loadKeywordRules();
  }
  async function toggleKeywordRule(id, active) {
    await api.patch(`/keyword-rules/${id}`, { active: !active });
    loadKeywordRules();
  }
  async function deleteKeywordRule(id) {
    await api.delete(`/keyword-rules/${id}`); loadKeywordRules();
  }
  async function toggleAttendantShift(id, on_shift) {
    await api.patch(`/users/${id}/shift`, { on_shift: !on_shift });
    loadAttendants();
  }

  const activeAttendants = attendants.filter(a => a.active);
  const TABS = [
    ['conversations','Conversas'],['attendants','Atendentes'],['contacts','Contactos'],
    ['metrics','Métricas'],['reports','Relatórios'],['scheduled','Agendamentos'],
    ['transfers','Transferências'],['quickreplies','Respostas Rápidas'],
    ['tags','Etiquetas'],['automation','🤖 Automação'],['bot','Bot'],['whatsapp','WhatsApp'],
  ];

  function selectTab(key) {
    setTab(key);
    setShowSidebar(false);
    if (key !== 'conversations') setSelectedConv(null);
  }

  const showList = tab === 'conversations' && (!isMobile || !selectedConv);
  const showChat = tab === 'conversations' && (!isMobile || !!selectedConv);

  return (
    <div style={S.shell}>
      {takenNotice && (
        <div style={{ position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#f97316', color: '#fff', padding: '0.65rem 1.25rem', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span>⚠️ {takenNotice}</span>
          <button onClick={() => setTakenNotice(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {isMobile && showSidebar && (
        <div onClick={() => setShowSidebar(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 150 }} />
      )}

      <aside style={{ ...S.sidebar, ...(isMobile ? { position: 'fixed', left: showSidebar ? 0 : '-220px', top: 0, bottom: 0, zIndex: 200, transition: 'left 0.25s ease' } : {}) }}>
        <div style={S.sidebarTop}>
          <div style={S.logoArea}>
            <span style={{ fontSize: '1.4rem' }}>💬</span>
            <div style={{ minWidth: 0 }}>
              <p style={S.logoName}>{import.meta.env.VITE_TENANT_NAME || 'WhatsApp'}</p>
              <span style={S.ownerBadge}>{user.name}</span>
            </div>
          </div>
          <nav style={S.nav}>
            {TABS.map(([key, label]) => (
              <button key={key} style={{ ...S.navBtn, ...(tab === key ? S.navActive : {}) }} onClick={() => selectTab(key)}>{label}</button>
            ))}
          </nav>
        </div>
        <button style={S.logoutBtn} onClick={logout}>Sair</button>
      </aside>

      <main style={{ ...S.main, ...(isMobile ? { marginLeft: 0 } : {}) }}>

        {isMobile && (
          <div style={S.mobileHeader}>
            {tab === 'conversations' && selectedConv ? (
              <button onClick={() => setSelectedConv(null)} style={S.mobileBtn}>←</button>
            ) : (
              <button onClick={() => setShowSidebar(v => !v)} style={S.mobileBtn}>☰</button>
            )}
            <span style={S.mobileTitle}>
              {tab === 'conversations' && selectedConv ? (selectedConv.contact_name || selectedConv.phone) : TABS.find(([k]) => k === tab)?.[1] || ''}
            </span>
          </div>
        )}

        {/* CONVERSAS */}
        {tab === 'conversations' && (
          <div style={{ ...S.chatLayout, flex: 1, overflow: 'hidden' }}>
            {showList && (
              <div style={{ ...(isMobile ? { flex: 1, overflowY: 'auto' } : S.listPane) }}>
                <ConversationList key={listKey} socket={socket} selected={selectedConv} onSelect={setSelectedConv} />
              </div>
            )}
            <div style={{ ...S.chatPane, ...(!showChat ? { display: 'none' } : {}) }}>
              {selectedConv && (
                <div style={S.transferBar}>
                  {activeAttendants.length === 0 ? (
                    <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Sem atendentes activos</span>
                  ) : (
                    <>
                      <select value={transferTo} onChange={e => setTransferTo(e.target.value)} style={S.select}>
                        <option value="">Transferir para...</option>
                        {activeAttendants.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({userStatuses[a.id] || a.status || 'offline'})</option>
                        ))}
                      </select>
                      <button style={S.transferBtn} onClick={transferConversation} disabled={!transferTo}>Transferir</button>
                    </>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    Atendente: <strong style={{ color: 'var(--text)' }}>{selectedConv.attendant_name || 'Sem atendente'}</strong>
                  </span>
                </div>
              )}
              <ChatWindow conversation={selectedConv} socket={socket} onClose={() => setSelectedConv(null)} onDelete={deleteConversation} onConversationChange={setSelectedConv} />
            </div>
          </div>
        )}

        {/* ATENDENTES */}
        {tab === 'attendants' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Atendentes</h2>
            <form onSubmit={createAttendant} style={S.form}>
              <input style={S.input} placeholder="Nome" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} required />
              <input style={S.input} type="email" placeholder="Email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} required />
              <input style={S.input} type="password" placeholder="Password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} required />
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={S.table}>
              <thead><tr><th>Nome</th><th>Email</th><th>Estado</th><th>Ativo</th><th></th></tr></thead>
              <tbody>
                {attendants.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td style={{ color: 'var(--muted)' }}>{a.email}</td>
                    <td>
                      <span style={{ color: a.status === 'online' ? 'var(--success)' : a.status === 'busy' ? 'var(--warn)' : 'var(--hint)', fontWeight: 500, fontSize: '0.85rem' }}>{a.status}</span>
                    </td>
                    <td style={{ color: a.active ? 'var(--success)' : 'var(--hint)', fontWeight: 500 }}>{a.active ? 'Sim' : 'Não'}</td>
                    <td><button style={S.outlineBtn} onClick={() => toggleAttendant(a.id, a.active)}>{a.active ? 'Desativar' : 'Ativar'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* CONTACTOS */}
        {tab === 'contacts' && (
          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>Contactos</h2>
              <button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: '0.8rem' }} onClick={cleanupInvalidContacts}>
                🧹 Limpar inválidos
              </button>
            </div>

            {editingContact && (
              <div style={S.modalOverlay}>
                <div style={S.modal}>
                  <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', color: 'var(--text)' }}>Editar Contacto</h3>
                  <label style={S.fieldLabel}>Nome</label>
                  <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '0.75rem' }}
                    value={editingContact.name || ''} onChange={e => setEditingContact(p => ({ ...p, name: e.target.value }))} />
                  <label style={S.fieldLabel}>Email</label>
                  <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '0.75rem' }}
                    type="email" placeholder="email@exemplo.com"
                    value={editingContact.email || ''} onChange={e => setEditingContact(p => ({ ...p, email: e.target.value }))} />
                  <label style={S.fieldLabel}>Notas internas</label>
                  <textarea style={{ ...S.input, width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '80px', marginBottom: '1.25rem' }}
                    placeholder="Ex: Cliente VIP, prefere contacto à tarde..."
                    value={editingContact.notes || ''} onChange={e => setEditingContact(p => ({ ...p, notes: e.target.value }))} />
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => deleteContact(editingContact.id, editingContact.name || editingContact.phone)}>
                      Eliminar
                    </button>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button style={S.outlineBtn} onClick={() => setEditingContact(null)}>Cancelar</button>
                      <button style={S.addBtn} onClick={saveContact}>Guardar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <input style={{ ...S.input, width: '100%', maxWidth: '360px', marginBottom: '0.75rem', boxSizing: 'border-box' }}
              placeholder="Pesquisar por nome, número ou nota..."
              value={contactSearch}
              onChange={e => { setContactSearch(e.target.value); loadContacts(e.target.value); }} />
            <p style={{ color: 'var(--hint)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{contacts.length} contacto(s)</p>

            <table style={S.table}>
              <thead><tr><th>Nome</th><th>Número</th><th>Email</th><th>Notas</th><th>Conversas</th><th>Último contacto</th><th></th></tr></thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', marginRight: '0.5rem', verticalAlign: 'middle' }}>
                        {(c.name || c.phone || '?')[0].toUpperCase()}
                      </div>
                      {c.name || '—'}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{c.phone}</td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{c.email || '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--hint)', maxWidth: '200px', wordBreak: 'break-word' }}>{c.notes || '—'}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.85rem' }}>{c.conversation_count || 0}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--hint)', whiteSpace: 'nowrap' }}>
                      {c.last_contact ? new Date(c.last_contact).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td><button style={S.outlineBtn} onClick={() => setEditingContact({ ...c })}>Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MÉTRICAS */}
        {tab === 'metrics' && metrics && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Métricas</h2>
            <div style={S.cards}>
              {[['Total', metrics.total, 'var(--accent)'], ['Aguarda', metrics.waiting, 'var(--warn)'], ['Abertas', metrics.open, 'var(--success)'], ['Fechadas', metrics.closed, 'var(--hint)']].map(([label, value, color]) => (
                <div key={label} style={{ ...S.card, borderTop: `3px solid ${color}` }}>
                  <p style={{ ...S.cardValue, color }}>{value}</p>
                  <p style={S.cardLabel}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RELATÓRIOS */}
        {tab === 'reports' && (
          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>Relatórios</h2>
              <button
                style={{ ...S.addBtn, fontSize: '0.82rem', padding: '0.35rem 0.9rem' }}
                onClick={async () => {
                  try {
                    const { data } = await api.get('/conversations/export', { responseType: 'blob' });
                    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `conversas_${new Date().toISOString().slice(0,10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) { alert('Erro ao exportar'); }
                }}>
                📤 Exportar CSV
              </button>
            </div>
            {!reports ? <p style={{ color: 'var(--hint)' }}>A carregar...</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div>
                  <h3 style={S.subTitle}>Tempo médio de resposta</h3>
                  <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)', margin: 0 }}>
                    {reports.avgResponse?.avg_minutes ?? '—'} min
                  </p>
                </div>
                <div>
                  <h3 style={S.subTitle}>Por atendente</h3>
                  {reports.byAttendant.map(a => (
                    <SimpleBar key={a.name} label={a.name} value={a.total}
                      max={Math.max(...reports.byAttendant.map(x => x.total), 1)} color="var(--accent)" />
                  ))}
                </div>
                <div>
                  <h3 style={S.subTitle}>Por hora (últimos 7 dias)</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const hr = String(h).padStart(2, '0');
                      const found = reports.byHour.find(x => x.hour === hr);
                      const max = Math.max(...reports.byHour.map(x => x.total), 1);
                      const pct = found ? (found.total / max) * 100 : 0;
                      return (
                        <div key={h} title={`${hr}h: ${found?.total || 0}`}
                          style={{ flex: 1, background: pct > 0 ? 'var(--accent)' : 'var(--accent-l)', height: `${Math.max(pct, 2)}%`, borderRadius: '2px 2px 0 0', minHeight: '2px' }} />
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--hint)', marginTop: '4px' }}>
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
                <div>
                  <h3 style={S.subTitle}>Por dia (últimos 30 dias)</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '80px', overflowX: 'auto' }}>
                    {reports.byDay.map(d => {
                      const max = Math.max(...reports.byDay.map(x => x.total), 1);
                      const pct = (d.total / max) * 100;
                      return (
                        <div key={d.day} title={`${d.day}: ${d.total}`}
                          style={{ minWidth: '8px', flex: 1, background: 'var(--accent)', opacity: 0.7 + pct / 300, height: `${Math.max(pct, 2)}%`, borderRadius: '2px 2px 0 0' }} />
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
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Respostas Rápidas</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Os atendentes digitam <strong>/atalho</strong> no chat para usar. A categoria agrupa as sugestões.</p>
            <form onSubmit={addQuickReply} style={{ ...S.form, flexWrap: 'wrap' }}>
              <input style={{ ...S.input, width: '110px' }} placeholder="/atalho" value={newQR.shortcut}
                onChange={e => setNewQR(p => ({ ...p, shortcut: e.target.value }))} required />
              <input style={{ ...S.input, flex: 1, minWidth: '180px' }} placeholder="Texto da resposta" value={newQR.body}
                onChange={e => setNewQR(p => ({ ...p, body: e.target.value }))} required />
              <input style={{ ...S.input, width: '120px' }} placeholder="Categoria (opcional)" value={newQR.category}
                onChange={e => setNewQR(p => ({ ...p, category: e.target.value }))} />
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={S.table}>
              <thead><tr><th>Atalho</th><th>Mensagem</th><th>Categoria</th><th></th></tr></thead>
              <tbody>
                {quickReplies.map(qr => (
                  <tr key={qr.id}>
                    <td><strong style={{ color: 'var(--accent)' }}>/{qr.shortcut}</strong></td>
                    <td style={{ maxWidth: '350px', wordBreak: 'break-word', color: 'var(--muted)' }}>{qr.body}</td>
                    <td>
                      {qr.category
                        ? <span style={{ background: 'var(--accent-l)', color: 'var(--accent)', padding: '1px 8px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>{qr.category}</span>
                        : <span style={{ color: 'var(--hint)', fontSize: '0.78rem' }}>—</span>}
                    </td>
                    <td><button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => deleteQuickReply(qr.id)}>Eliminar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ETIQUETAS */}
        {tab === 'tags' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Etiquetas</h2>
            <form onSubmit={addTag} style={S.form}>
              <input style={S.input} placeholder="Nome da etiqueta" value={newTag.name}
                onChange={e => setNewTag(p => ({ ...p, name: e.target.value }))} required />
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setNewTag(p => ({ ...p, color: c }))}
                    style={{ width: 22, height: 22, background: c, borderRadius: '50%', cursor: 'pointer', border: newTag.color === c ? '3px solid var(--text)' : '3px solid transparent', transition: 'border .1s' }} />
                ))}
              </div>
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {tags.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: t.color + '18', border: `1px solid ${t.color}55`, borderRadius: '999px', padding: '0.3rem 0.75rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <span style={{ color: t.color, fontWeight: 600, fontSize: '0.83rem' }}>{t.name}</span>
                  <button onClick={() => deleteTag(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.color, fontSize: '0.75rem', padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AGENDAMENTOS */}
        {tab === 'scheduled' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Mensagens Agendadas</h2>
            {scheduled.length === 0 ? (
              <p style={{ color: 'var(--hint)' }}>Sem mensagens agendadas pendentes.</p>
            ) : (
              <table style={S.table}>
                <thead><tr><th>Contacto</th><th>Mensagem</th><th>Data / Hora</th><th>Agendado por</th><th></th></tr></thead>
                <tbody>
                  {scheduled.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.contact_name || s.phone || s.wa_id}</td>
                      <td style={{ maxWidth: '260px', wordBreak: 'break-word', fontSize: '0.85rem', color: 'var(--muted)' }}>{s.body}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                        {new Date(s.scheduled_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{s.created_by_name || '—'}</td>
                      <td><button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => cancelScheduled(s.id)}>Cancelar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TRANSFERÊNCIAS */}
        {tab === 'transfers' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Log de Transferências</h2>
            {transferLogs.length === 0 ? (
              <p style={{ color: 'var(--hint)' }}>Sem transferências registadas.</p>
            ) : (
              <table style={S.table}>
                <thead><tr><th>Data</th><th>Contacto</th><th>De</th><th>Para</th><th>Por</th></tr></thead>
                <tbody>
                  {transferLogs.map(t => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem', color: 'var(--muted)' }}>
                        {new Date(t.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ fontWeight: 600 }}>{t.contact_name || t.phone}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.from_name || '—'}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>{t.to_name}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--hint)' }}>{t.by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* AUTOMAÇÃO */}
        {tab === 'automation' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Automação</h2>

            {/* --- Bot por palavra-chave --- */}
            <h3 style={S.subTitle}>🤖 Bot por palavra-chave</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Quando uma mensagem contém a palavra-chave, o bot responde automaticamente.
            </p>
            <form onSubmit={addKeywordRule} style={{ ...S.form, flexWrap: 'wrap', marginBottom: '1rem' }}>
              <input style={{ ...S.input, width: '140px' }} placeholder="Palavra-chave" value={newKR.keyword}
                onChange={e => setNewKR(p => ({ ...p, keyword: e.target.value }))} required />
              <input style={{ ...S.input, flex: 1, minWidth: '200px' }} placeholder="Resposta automática" value={newKR.response}
                onChange={e => setNewKR(p => ({ ...p, response: e.target.value }))} required />
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={S.table}>
              <thead><tr><th>Palavra-chave</th><th>Resposta</th><th>Ativa</th><th></th></tr></thead>
              <tbody>
                {keywordRules.map(r => (
                  <tr key={r.id}>
                    <td><strong style={{ color: 'var(--accent)' }}>{r.keyword}</strong></td>
                    <td style={{ maxWidth: '350px', wordBreak: 'break-word', color: 'var(--muted)', fontSize: '0.85rem' }}>{r.response}</td>
                    <td>
                      <button onClick={() => toggleKeywordRule(r.id, r.active)}
                        style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, background: r.active ? 'var(--success)' : 'var(--border)', color: r.active ? '#fff' : 'var(--muted)' }}>
                        {r.active ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    <td><button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => deleteKeywordRule(r.id)}>Eliminar</button></td>
                  </tr>
                ))}
                {keywordRules.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--hint)', textAlign: 'center', padding: '1rem' }}>Sem regras criadas</td></tr>}
              </tbody>
            </table>

            {/* --- Turnos --- */}
            <h3 style={{ ...S.subTitle, marginTop: '2rem' }}>📋 Turnos dos atendentes</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Novas conversas são atribuídas prioritariamente a atendentes em turno. Os atendentes podem activar/desactivar o próprio turno no painel deles.
            </p>
            <table style={S.table}>
              <thead><tr><th>Atendente</th><th>Estado</th><th>Turno</th><th></th></tr></thead>
              <tbody>
                {attendants.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td><span style={{ color: a.status === 'online' ? 'var(--success)' : a.status === 'busy' ? 'var(--warn)' : 'var(--hint)', fontSize: '0.85rem', fontWeight: 500 }}>{a.status}</span></td>
                    <td>
                      <span style={{ padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 600, background: a.on_shift ? 'var(--success)' : 'var(--border)', color: a.on_shift ? '#fff' : 'var(--muted)' }}>
                        {a.on_shift ? '🟢 Em turno' : '⚪ Fora'}
                      </span>
                    </td>
                    <td>
                      <button style={S.outlineBtn} onClick={() => toggleAttendantShift(a.id, a.on_shift)}>
                        {a.on_shift ? 'Retirar do turno' : 'Colocar em turno'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* --- SLA --- */}
            <h3 style={{ ...S.subTitle, marginTop: '2rem' }}>🔔 Alerta de SLA</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Notificação sonora + browser quando uma conversa ultrapassa X minutos sem resposta do atendente.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>Minutos sem resposta:</label>
              <input type="number" min="1" max="1440" style={{ ...S.input, width: '90px' }}
                value={settings.sla_minutes || '30'}
                onChange={e => setSettings(s => ({ ...s, sla_minutes: e.target.value }))} />
              <button style={S.addBtn} onClick={saveSettings}>
                {settingsSaved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* BOT */}
        {tab === 'bot' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Bot de Triagem</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Envia resposta automática fora do horário de atendimento.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '560px' }}>
              <label style={S.settingRow}>
                <span style={{ fontWeight: 500 }}>Ativar bot</span>
                <input type="checkbox" checked={settings.bot_enabled === '1'}
                  onChange={e => setSettings(s => ({ ...s, bot_enabled: e.target.checked ? '1' : '0' }))} />
              </label>
              <div>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>Horário por dia</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[['Dom',0],['Seg',1],['Ter',2],['Qua',3],['Qui',4],['Sex',5],['Sáb',6]].map(([label, i]) => {
                    const key = `hours_${i}`;
                    const val = settings[key] || 'closed';
                    const isOpen = val !== 'closed';
                    const [start, end] = isOpen ? val.split('-') : ['08:00', '18:00'];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.88rem' }}>
                        <span style={{ width: '36px', fontWeight: 600, color: 'var(--text)' }}>{label}</span>
                        <input type="checkbox" checked={isOpen} onChange={e => {
                          setSettings(s => ({ ...s, [key]: e.target.checked ? `${start}-${end}` : 'closed' }));
                        }} />
                        {isOpen ? (
                          <>
                            <input type="time" style={{ ...S.input, padding: '0.25rem 0.5rem' }} value={start}
                              onChange={e => setSettings(s => ({ ...s, [key]: `${e.target.value}-${end}` }))} />
                            <span style={{ color: 'var(--hint)' }}>até</span>
                            <input type="time" style={{ ...S.input, padding: '0.25rem 0.5rem' }} value={end}
                              onChange={e => setSettings(s => ({ ...s, [key]: `${start}-${e.target.value}` }))} />
                          </>
                        ) : (
                          <span style={{ color: 'var(--hint)', fontSize: '0.8rem' }}>Fechado</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Mensagem automática</label>
                <textarea style={{ ...S.input, width: '100%', resize: 'vertical', minHeight: '80px', boxSizing: 'border-box' }}
                  value={settings.bot_message}
                  onChange={e => setSettings(s => ({ ...s, bot_message: e.target.value }))} />
              </div>
              <button style={{ ...S.addBtn, alignSelf: 'flex-start' }} onClick={saveSettings}>
                {settingsSaved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* WHATSAPP */}
        {tab === 'whatsapp' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>WhatsApp</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh)' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: whatsappReady ? 'var(--success)' : 'var(--danger)' }} />
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{whatsappReady ? 'Conectado' : 'Desconectado'}</span>
              </div>
              {whatsappReady && (
                <button style={{ padding: '0.4rem 1rem', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}
                  disabled={disconnecting}
                  onClick={async () => {
                    if (!confirm('Tens a certeza? O WhatsApp vai desligar e precisas de escanear o QR novamente.')) return;
                    setDisconnecting(true);
                    try { await api.post('/whatsapp/disconnect'); } catch (_) {}
                    setDisconnecting(false); setWhatsappReady(false); setQrCode(null);
                  }}>
                  {disconnecting ? 'A desligar...' : 'Desligar'}
                </button>
              )}
            </div>
            {!whatsappReady && qrCode && (
              <div>
                <p style={{ marginBottom: '1rem', color: 'var(--muted)', fontSize: '0.9rem' }}>Escaneia o QR Code com o WhatsApp do número da loja:</p>
                <img src={qrCode} alt="QR Code" style={{ width: 240, height: 240, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)' }} />
              </div>
            )}
            {!whatsappReady && !qrCode && <p style={{ color: 'var(--hint)' }}>A aguardar QR Code...</p>}
          </div>
        )}
      </main>
    </div>
  );
}

const S = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' },
  sidebar: { width: '200px', background: 'var(--card)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '1rem 0', overflowY: 'auto', boxShadow: 'var(--sh)' },
  sidebarTop: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  logoArea: { display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0 1rem' },
  logoName: { margin: 0, color: 'var(--text)', fontSize: '0.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ownerBadge: { background: 'var(--accent-l)', color: 'var(--accent)', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600 },
  nav: { display: 'flex', flexDirection: 'column', gap: '1px' },
  navBtn: { padding: '0.6rem 1rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', textAlign: 'left', fontSize: '0.84rem', fontWeight: 500, transition: 'all .1s' },
  navActive: { background: 'var(--accent-l)', color: 'var(--accent)', fontWeight: 700, boxShadow: 'inset 3px 0 0 var(--accent)' },
  logoutBtn: { margin: '0 1rem', padding: '0.45rem', background: 'none', border: '1px solid var(--border-m)', color: 'var(--muted)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem' },
  main: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  mobileHeader: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--sh)' },
  mobileBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: '1.3rem', cursor: 'pointer', padding: 0 },
  mobileTitle: { color: 'var(--text)', fontWeight: 600, fontSize: '0.95rem' },
  chatLayout: { display: 'flex', height: '100%' },
  listPane: { width: '320px', flexShrink: 0, overflowY: 'auto' },
  chatPane: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  transferBar: { padding: '0.5rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', boxShadow: 'var(--sh)' },
  section: { padding: '1.75rem 2rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
  sectionTitle: { marginTop: 0, marginBottom: '1.5rem', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' },
  subTitle: { marginTop: 0, marginBottom: '0.75rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--muted)' },
  form: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '0.5rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.9rem', background: 'var(--bg)', color: 'var(--text)', outline: 'none' },
  addBtn: { padding: '0.5rem 1.1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' },
  outlineBtn: { padding: '0.25rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: 'none', color: 'var(--muted)', fontSize: '0.82rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  cards: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  card: { background: 'var(--card)', padding: '1.5rem', borderRadius: 'var(--r-lg)', minWidth: '140px', boxShadow: 'var(--sh-md)', border: '1px solid var(--border)' },
  cardValue: { fontSize: '2rem', fontWeight: 700, margin: 0 },
  cardLabel: { color: 'var(--muted)', margin: '0.25rem 0 0', fontSize: '0.88rem' },
  select: { padding: '0.4rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.85rem', background: 'var(--bg)', color: 'var(--text)' },
  transferBtn: { padding: '0.4rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 },
  settingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' },
  fieldLabel: { display: 'block', fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.2rem', fontWeight: 600 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--card)', borderRadius: 'var(--r-lg)', padding: '1.75rem', width: '100%', maxWidth: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid var(--border)' },
};
