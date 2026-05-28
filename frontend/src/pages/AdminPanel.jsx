import { useState, useEffect } from 'react';
import api from '../api';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import PushNotificationsButton from '../components/PushNotificationsButton';
import { useTheme } from '../hooks/useTheme';
import ReportsPage from './ReportsPage';
import DashboardPage from './DashboardPage';

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
  const { dark, toggle: toggleTheme } = useTheme();
  const [tab, setTab] = useState('dashboard');
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
  // reports state managed by ReportsPage component
  const [qrCode, setQrCode] = useState(null);
  const [whatsappReady, setWhatsappReady] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [editingUser, setEditingUser] = useState(null); // { id, name } do atendente a editar
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', role: 'attendant' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '', current_password: '', password: '', password2: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [userStatuses, setUserStatuses] = useState({});
  const [listKey, setListKey] = useState(0);

  const [quickReplies, setQuickReplies] = useState([]);
  const [newQR, setNewQR] = useState({ shortcut: '', body: '', category: '', is_personal: false });

  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState({ name: '', color: '#25D366' });

  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [editingContact, setEditingContact] = useState(null);

  // Novo contacto individual
  const [showNewContact, setShowNewContact] = useState(false);
  const [newContact, setNewContact] = useState({ phone: '', name: '' });
  const [newContactError, setNewContactError] = useState('');

  // Importar CSV
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvRows, setCsvRows] = useState([]); // [{ phone, name }]
  const [csvError, setCsvError] = useState('');
  const [csvImportResult, setCsvImportResult] = useState(null);

  const [scheduled, setScheduled] = useState([]);
  const [transferLogs, setTransferLogs] = useState([]);
  const [keywordRules, setKeywordRules] = useState([]);
  const [newKR, setNewKR] = useState({ keyword: '', response: '', department_id: '', tag_id: '', priority: 100 });

  const [blacklist, setBlacklist] = useState([]);
  const [newBlocked, setNewBlocked] = useState({ phone: '', reason: '' });

  // Linhas WhatsApp
  const [lines, setLines] = useState([]);
  const [lineForm, setLineForm] = useState(null);          // { id?, name, color }
  const [lineToArchive, setLineToArchive] = useState(null); // { id, name, open_count }
  const [lineQrFor, setLineQrFor] = useState(null);        // line id whose QR modal is open
  const [lineQrData, setLineQrData] = useState(null);
  const [lineReassign, setLineReassign] = useState('');

  // Departamentos
  const [departments, setDepartments] = useState([]);
  const [deptForm, setDeptForm] = useState(null);        // { id?, name, color, is_default }
  const [deptMembersFor, setDeptMembersFor] = useState(null); // dept id cujo modal de membros está aberto
  const [deptMembers, setDeptMembers] = useState([]);    // [user_id, ...]
  const [deptToArchive, setDeptToArchive] = useState(null);   // { id, name, open_count }
  const [reassignTarget, setReassignTarget] = useState('');

  // Broadcast state
  const [broadcastContacts, setBroadcastContacts] = useState([]);
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastSelected, setBroadcastSelected] = useState(new Set());
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastProgress, setBroadcastProgress] = useState(null); // { sent, failed, total }
  const [broadcastDone, setBroadcastDone] = useState(null); // { sent, failed, total }
  const [broadcastLineId, setBroadcastLineId] = useState("");

  // Search filters for user lists
  const [deptMemberSearch, setDeptMemberSearch] = useState('');
  const [attendantSearch, setAttendantSearch] = useState('');

  // Per-line bot settings
  const [selectedBotLine, setSelectedBotLine] = useState(null);
  const [botSettings, setBotSettings] = useState({
    enabled: 0, message: '',
    hours_0: 'closed', hours_1: '07:00-18:00', hours_2: '07:00-18:00',
    hours_3: '07:00-18:00', hours_4: '07:00-18:00', hours_5: '07:00-18:00',
    hours_6: '07:00-12:00',
  });
  const [botSaved, setBotSaved] = useState(false);
  const [broadcastLogs, setBroadcastLogs] = useState([]);

  const [settings, setSettings] = useState({
    bot_enabled: '0', bot_message: '', rating_enabled: '0', rating_message: '',
    signature_enabled: '0', signature_message: '', reopen_window_days: '1',
    hours_0: 'closed', hours_1: '08:00-18:00', hours_2: '08:00-18:00',
    hours_3: '08:00-18:00', hours_4: '08:00-18:00', hours_5: '08:00-18:00',
    hours_6: '09:00-13:00',
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    loadAttendants(); checkWhatsapp();
    loadQuickReplies(); loadTags(); loadSettings();
  }, []);

  useEffect(() => {
    if (tab === 'scheduled') loadScheduled();
    if (tab === 'contacts') loadContacts();
    if (tab === 'transfers') loadTransferLogs();
    if (tab === 'automation') { loadKeywordRules(); loadAttendants(); loadDepartments(); loadTags(); }
    if (tab === 'tags') { loadTags(); loadDepartments(); }
    if (tab === 'blacklist') loadBlacklist();
    if (tab === 'broadcast') { loadBroadcastContacts(); loadBroadcastLogs(); }
    if (tab === 'departments') { loadDepartments(); loadAttendants(); }
    if (tab === 'lines') { loadLines(); loadDepartments(); }
    if (tab === 'bot') { loadLines(); }
  }, [tab]);

  useEffect(() => {
    if (!socket) return;
    // Novo payload tem {line_id, qr/ready}; tab antiga "WhatsApp" só mostra estado
    // da linha padrão. Tab "Linhas" tem o seu próprio handler com tudo.
    socket.on('whatsapp:qr', (data) => {
      const qr = typeof data === 'string' ? data : data?.qr;
      if (qr) { setQrCode(qr); setWhatsappReady(false); }
      loadLines();
    });
    socket.on('whatsapp:ready', () => { setWhatsappReady(true); setQrCode(null); loadLines(); });
    socket.on('whatsapp:disconnected', () => { setWhatsappReady(false); loadLines(); });
    socket.on('line:created', () => loadLines());
    socket.on('line:updated', () => loadLines());
    socket.on('line:deleted', () => loadLines());
    socket.on('user:status', ({ userId, status }) => setUserStatuses(prev => ({ ...prev, [userId]: status })));
    socket.on('user:shift', () => loadAttendants());
    socket.on('conversation:reopened', ({ contact_name }) => {
      setTakenNotice(`🔁 Conversa com "${contact_name}" foi reaberta — o cliente voltou!`);
      setTimeout(() => setTakenNotice(null), 7000);
    });
    socket.on('broadcast:progress', (data) => setBroadcastProgress(data));
    socket.on('broadcast:done', (data) => {
      setBroadcastProgress(null);
      setBroadcastDone(data);
      setBroadcastSending(false);
      loadBroadcastLogs();
    });
    return () => {
      socket.off('whatsapp:qr'); socket.off('whatsapp:ready');
      socket.off('whatsapp:disconnected'); socket.off('user:status');
      socket.off('line:created'); socket.off('line:updated'); socket.off('line:deleted');
      socket.off('user:shift'); socket.off('conversation:reopened');
      socket.off('broadcast:progress'); socket.off('broadcast:done');
    };
  }, [socket]);

  async function loadAttendants() {
    const { data } = await api.get('/users');
    // Mostra atendentes + supervisores na gestao; owners ficam fora (geridos via perfil proprio).
    setAttendants(Array.isArray(data) ? data.filter(u => u.role !== 'owner') : []);
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
  async function saveNewContact() {
    setNewContactError('');
    const phone = newContact.phone.trim().replace(/[\s\-().]/g, '');
    if (!phone) return setNewContactError('Número obrigatório');
    try {
      await api.post('/contacts', { phone, name: newContact.name.trim() || phone });
      setShowNewContact(false);
      setNewContact({ phone: '', name: '' });
      loadContacts(contactSearch);
    } catch (e) {
      setNewContactError(e.response?.data?.error || 'Erro ao criar contacto');
    }
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];
    // Detectar separador: ; ou ,
    const sep = lines[0].includes(';') ? ';' : ',';
    const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    // Detectar se primeira linha é cabeçalho
    const first = rows[0];
    const isHeader = first.some(c => /nome|name|telefone|phone|número|numero/i.test(c));
    const data = isHeader ? rows.slice(1) : rows;
    // Tentar identificar colunas phone e name
    let phoneIdx = 0, nameIdx = 1;
    if (isHeader) {
      first.forEach((c, i) => {
        if (/telefone|phone|número|numero/i.test(c)) phoneIdx = i;
        if (/nome|name/i.test(c)) nameIdx = i;
      });
    }
    return data
      .map(r => ({ phone: (r[phoneIdx] || '').replace(/[\s\-().+]/g, ''), name: r[nameIdx] || '' }))
      .filter(r => r.phone && /\d{6,}/.test(r.phone));
  }

  function handleCsvFile(e) {
    setCsvError('');
    setCsvImportResult(null);
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseCsv(ev.target.result);
      if (rows.length === 0) setCsvError('Nenhum número válido encontrado no ficheiro.');
      else setCsvRows(rows);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  }

  async function doCsvImport() {
    if (csvRows.length === 0) return;
    const { data } = await api.post('/whatsapp/contacts/import', { contacts: csvRows });
    setCsvImportResult(data);
    setCsvRows([]);
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
  async function saveProfile() {
    setProfileError(''); setProfileSuccess('');
    if (!profileForm.name.trim()) { setProfileError('O nome não pode estar vazio'); return; }
    if (profileForm.password && profileForm.password !== profileForm.password2) { setProfileError('As senhas não coincidem'); return; }
    if (profileForm.password && profileForm.password.length < 6) { setProfileError('A senha deve ter pelo menos 6 caracteres'); return; }
    if ((profileForm.password || profileForm.email !== user.email) && !profileForm.current_password) { setProfileError('Senha atual obrigatória para alterar email ou senha'); return; }
    setProfileSaving(true);
    try {
      const payload = { name: profileForm.name.trim() };
      if (profileForm.email.trim() !== user.email) payload.email = profileForm.email.trim();
      if (profileForm.password) { payload.password = profileForm.password; payload.current_password = profileForm.current_password; }
      else if (profileForm.current_password) payload.current_password = profileForm.current_password;
      await api.patch('/users/me', payload);
      setProfileSuccess('Perfil atualizado com sucesso!');
      setProfileForm(f => ({ ...f, current_password: '', password: '', password2: '' }));
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Erro ao atualizar perfil');
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveEditUser() {
    if (!editForm.name.trim()) { setEditError('O nome não pode estar vazio'); return; }
    setEditSaving(true); setEditError('');
    try {
      const payload = { name: editForm.name.trim(), email: editForm.email.trim() };
      if (editForm.password) payload.password = editForm.password;
      if (editForm.role && editForm.role !== editingUser.role) payload.role = editForm.role;
      await api.patch(`/users/${editingUser.id}`, payload);
      setEditingUser(null);
      loadAttendants();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Erro ao guardar');
    }
    setEditSaving(false);
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
    try {
      await api.post('/quick-replies', newQR);
      setNewQR({ shortcut: '', body: '', category: '', is_personal: false });
      loadQuickReplies();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao guardar atalho');
    }
  }
  async function deleteQuickReply(id) {
    await api.delete(`/quick-replies/${id}`); loadQuickReplies();
  }
  async function addTag(e) {
    e.preventDefault();
    if (!newTag.name) return;
    await api.post('/tags', newTag);
    setNewTag({ name: '', color: '#25D366', department_id: '' }); loadTags();
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
    if (!newKR.keyword?.trim()) return;
    if (!newKR.response?.trim() && !newKR.department_id && !newKR.tag_id) {
      alert('Indique pelo menos uma acção: resposta, departamento ou etiqueta');
      return;
    }
    try {
      await api.post('/keyword-rules', {
        keyword: newKR.keyword.trim(),
        response: newKR.response?.trim() || '',
        department_id: newKR.department_id ? parseInt(newKR.department_id, 10) : null,
        tag_id: newKR.tag_id ? parseInt(newKR.tag_id, 10) : null,
        priority: parseInt(newKR.priority, 10) || 100,
      });
      setNewKR({ keyword: '', response: '', department_id: '', tag_id: '', priority: 100 });
      loadKeywordRules();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao adicionar regra');
    }
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

  // --- Linhas WhatsApp ---
  async function loadBotSettings(lineId) {
    if (!lineId) return;
    try {
      const { data } = await api.get(`/lines/${lineId}/bot`);
      setBotSettings({
        enabled: data.enabled || 0,
        message: data.message || '',
        hours_0: data.hours_0 || 'closed',
        hours_1: data.hours_1 || '07:00-18:00',
        hours_2: data.hours_2 || '07:00-18:00',
        hours_3: data.hours_3 || '07:00-18:00',
        hours_4: data.hours_4 || '07:00-18:00',
        hours_5: data.hours_5 || '07:00-18:00',
        hours_6: data.hours_6 || '07:00-12:00',
      });
    } catch (e) { console.error('loadBotSettings', e); }
  }

  async function saveBotSettings() {
    if (!selectedBotLine) return;
    try {
      await api.post(`/lines/${selectedBotLine}/bot`, botSettings);
      setBotSaved(true);
      setTimeout(() => setBotSaved(false), 2000);
    } catch (e) { console.error('saveBotSettings', e); }
  }

  async function loadLines() {
    try { const { data } = await api.get('/lines'); setLines(Array.isArray(data) ? data : []); }
    catch (_) {}
  }
  async function saveLine() {
    if (!lineForm?.name?.trim()) return;
    try {
      const payload = {
        name: lineForm.name.trim(),
        color: lineForm.color,
        is_default: !!lineForm.is_default,
        department_id: lineForm.department_id ? parseInt(lineForm.department_id, 10) : null,
      };
      if (lineForm.id) await api.put(`/lines/${lineForm.id}`, payload);
      else await api.post('/lines', payload);
      setLineForm(null);
      loadLines();
    } catch (err) { alert(err.response?.data?.error || 'Erro a guardar linha'); }
  }
  async function archiveLine() {
    const url = lineReassign ? `/lines/${lineToArchive.id}?reassign_to=${lineReassign}` : `/lines/${lineToArchive.id}`;
    try {
      await api.delete(url);
      setLineToArchive(null); setLineReassign('');
      loadLines();
    } catch (err) { alert(err.response?.data?.error || 'Erro a arquivar'); }
  }
  async function reconnectLine(id) {
    try { await api.post(`/lines/${id}/connect`); loadLines(); }
    catch (err) { alert(err.response?.data?.error || 'Erro a reconectar'); }
  }
  async function disconnectLine(id) {
    if (!confirm('Desligar esta linha? O WhatsApp vai desconectar e precisa de re-scan para voltar.')) return;
    try { await api.post(`/lines/${id}/disconnect`); loadLines(); }
    catch (err) { alert(err.response?.data?.error || 'Erro a desconectar'); }
  }
  async function openLineQr(id) {
    setLineQrFor(id); setLineQrData(null);
    // Tentar várias vezes — QR pode demorar alguns segundos a aparecer
    let attempts = 0;
    const tryFetch = async () => {
      try { const { data } = await api.get(`/lines/${id}/qr`); setLineQrData(data.qr); }
      catch (err) {
        if (err.response?.status === 409) { setLineQrData('READY'); return; }  // já conectada
        if (attempts++ < 10) setTimeout(tryFetch, 1500);
      }
    };
    tryFetch();
  }

  // --- Departamentos ---
  async function loadDepartments() {
    const { data } = await api.get('/departments');
    setDepartments(Array.isArray(data) ? data : []);
  }
  async function saveDept() {
    if (!deptForm?.name?.trim()) return;
    try {
      const payload = {
        name: deptForm.name.trim(),
        color: deptForm.color,
        is_default: !!deptForm.is_default,
        // sla_minutes vazio = null (usar default global). Valor numérico = override.
        sla_minutes: deptForm.sla_minutes === '' || deptForm.sla_minutes == null ? null : parseInt(deptForm.sla_minutes, 10),
      };
      if (deptForm.id) await api.put(`/departments/${deptForm.id}`, payload);
      else await api.post('/departments', payload);
      setDeptForm(null);
      loadDepartments();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao guardar departamento');
    }
  }
  async function openMembers(deptId) {
    try {
      setDeptMemberSearch('');
      const { data } = await api.get(`/departments/${deptId}/members`);
      setDeptMembers(Array.isArray(data) ? data.map(m => m.id) : []);
      setDeptMembersFor(deptId);
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao carregar membros');
    }
  }
  async function saveMembers() {
    try {
      await api.put(`/departments/${deptMembersFor}/members`, { user_ids: deptMembers });
      setDeptMembersFor(null);
      loadDepartments();
      loadAttendants();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao guardar membros');
    }
  }
  async function archiveDept() {
    const url = reassignTarget
      ? `/departments/${deptToArchive.id}?reassign_to=${reassignTarget}`
      : `/departments/${deptToArchive.id}`;
    try {
      await api.delete(url);
      setDeptToArchive(null);
      setReassignTarget('');
      loadDepartments();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao arquivar');
    }
  }

  async function loadBroadcastLogs() {
    try { const { data } = await api.get('/broadcast/logs'); setBroadcastLogs(Array.isArray(data) ? data : []); } catch (_) {}
  }
  async function loadBroadcastContacts(q = '') {
    const { data } = await api.get('/contacts', { params: q ? { q } : {} });
    setBroadcastContacts(Array.isArray(data) ? data.filter(c => c.phone && !c.phone.includes('@')) : []);
  }
  async function sendBroadcast() {
    if (broadcastSelected.size === 0 || !broadcastMessage.trim()) return;
    if (!confirm(`Enviar mensagem para ${broadcastSelected.size} contacto(s)?`)) return;
    setBroadcastSending(true);
    setBroadcastDone(null);
    setBroadcastProgress({ sent: 0, failed: 0, total: broadcastSelected.size });
    try {
      await api.post('/broadcast', {
        contact_ids: Array.from(broadcastSelected),
        message: broadcastMessage.trim(),
        ...(broadcastLineId ? { line_id: parseInt(broadcastLineId, 10) } : {}),
      });
    } catch (err) {
      alert('Erro ao iniciar envio: ' + (err.response?.data?.error || err.message));
      setBroadcastSending(false);
      setBroadcastProgress(null);
    }
  }

  async function loadBlacklist() {
    const { data } = await api.get('/blacklist');
    setBlacklist(Array.isArray(data) ? data : []);
  }
  async function addToBlacklist(e) {
    e.preventDefault();
    if (!newBlocked.phone.trim()) return;
    try {
      await api.post('/blacklist', newBlocked);
      setNewBlocked({ phone: '', reason: '' });
      loadBlacklist();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao adicionar à blacklist');
    }
  }
  async function removeFromBlacklist(id, phone) {
    if (!confirm(`Remover ${phone} da blacklist?`)) return;
    await api.delete(`/blacklist/${id}`);
    loadBlacklist();
  }

  const activeAttendants = attendants.filter(a => a.active);
  const TABS = [
    ['dashboard','📊 Dashboard'],['conversations','Conversas'],['attendants','Atendentes'],['departments','🏢 Departamentos'],['lines','📱 Linhas WhatsApp'],['contacts','Contactos'],
    ['reports','Relatórios'],['scheduled','Agendamentos'],
    ['transfers','Transferências'],['quickreplies','Respostas Rápidas'],
    ['tags','Etiquetas'],['automation','🤖 Automação'],['bot','Bot'],
    ['signature','🔔 Assinatura'],['rating','⭐ Avaliação'],
    ['blacklist','🚫 Blacklist'],['broadcast','📣 Envio em Massa'],['whatsapp','WhatsApp'],
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
        <div style={{ margin: '0 1rem 0.5rem', display: 'flex', justifyContent: 'center' }}>
          <PushNotificationsButton />
        </div>
        <button onClick={toggleTheme} title={dark ? 'Modo claro' : 'Modo escuro'} style={{ ...S.logoutBtn, marginBottom: '0.4rem', textAlign: 'center' }}>{dark ? '☀️ Modo claro' : '🌙 Modo escuro'}</button>
        <button style={{ ...S.logoutBtn, background: 'var(--accent-l)', color: 'var(--accent)', marginBottom: '0.4rem' }} onClick={() => { setProfileForm({ name: user.name || '', email: user.email || '', current_password: '', password: '', password2: '' }); setProfileError(''); setProfileSuccess(''); setShowProfile(true); }}>👤 Perfil / Senha</button>
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
            <input
              style={{ ...S.input, width: '100%', maxWidth: '300px', boxSizing: 'border-box', marginBottom: '0.75rem' }}
              placeholder="Filtrar por nome..."
              value={attendantSearch}
              onChange={e => setAttendantSearch(e.target.value)}
            />
            <table style={S.table}>
              <thead><tr><th>Nome</th><th>Função</th><th>Email</th><th>Departamentos</th><th>Estado</th><th>Ativo</th><th></th></tr></thead>
              <tbody>
                {attendants.filter(a => !attendantSearch || a.name.toLowerCase().includes(attendantSearch.toLowerCase())).map(a => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td>
                      {a.role === 'supervisor' ? (
                        <span style={{ background: '#ddd6fe', color: '#5b21b6', padding: '1px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600 }}>🛡️ Supervisor</span>
                      ) : (
                        <span style={{ color: 'var(--hint)', fontSize: '0.78rem' }}>Atendente</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{a.email}</td>
                    <td>
                      {(a.departments || []).length === 0 ? (
                        <span style={{ color: 'var(--hint)', fontSize: '0.78rem' }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {a.departments.map(d => (
                            <span key={d.id} style={{ background: d.color + '18', border: `1px solid ${d.color}55`, color: d.color, borderRadius: '999px', padding: '0.05rem 0.45rem', fontSize: '0.7rem', fontWeight: 600 }}>{d.name}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ color: a.status === 'online' ? 'var(--success)' : a.status === 'busy' ? 'var(--warn)' : 'var(--hint)', fontWeight: 500, fontSize: '0.85rem' }}>{a.status}</span>
                    </td>
                    <td style={{ color: a.active ? 'var(--success)' : 'var(--hint)', fontWeight: 500 }}>{a.active ? 'Sim' : 'Não'}</td>
                    <td style={{ display: 'flex', gap: '0.4rem' }}>
                      <button style={{ ...S.outlineBtn, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => { setEditingUser(a); setEditForm({ name: a.name, email: a.email, password: '', role: a.role || 'attendant' }); setEditError(''); }}>Editar</button>
                      <button style={S.outlineBtn} onClick={() => toggleAttendant(a.id, a.active)}>{a.active ? 'Desativar' : 'Ativar'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MODAL EDITAR ATENDENTE */}
        {editingUser && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setEditingUser(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', width: '100%', maxWidth: '380px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '1rem' }}>✏️ Editar utilizador</strong>
                <button onClick={() => setEditingUser(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.3rem' }}>Nome</label>
                <input style={S.input} value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.3rem' }}>Email</label>
                <input style={S.input} type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.3rem' }}>Nova senha <span style={{ fontWeight: 400, color: 'var(--hint)' }}>(deixar em branco para não alterar)</span></label>
                <input style={S.input} type="password" placeholder="Mínimo 6 caracteres" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.3rem' }}>Função</label>
                <select style={S.input} value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="attendant">👤 Atendente</option>
                  <option value="supervisor">🛡️ Supervisor</option>
                  <option value="owner">👑 Owner</option>
                </select>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: 'var(--hint)' }}>
                  Supervisor: vê painel de monitorização e relatórios mas não gere configurações. Owner: acesso total.
                </p>
              </div>
              {editError && <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.83rem', background: 'var(--danger-l)', padding: '0.4rem 0.6rem', borderRadius: 'var(--r-sm)' }}>{editError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <button onClick={() => setEditingUser(null)} style={{ padding: '0.4rem 1rem', border: '1px solid var(--border-m)', background: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancelar</button>
                <button onClick={saveEditUser} disabled={editSaving} style={{ padding: '0.4rem 1.2rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', opacity: editSaving ? 0.7 : 1 }}>
                  {editSaving ? 'A guardar...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DEPARTAMENTOS */}
        {tab === 'departments' && (
          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2 style={{ ...S.sectionTitle, margin: 0 }}>Departamentos</h2>
              <button style={S.addBtn} onClick={() => setDeptForm({ name: '', color: '#3b82f6', is_default: false, sla_minutes: '' })}>
                + Novo departamento
              </button>
            </div>

            {departments.length === 0 && (
              <div style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-m)', color: 'var(--muted)', textAlign: 'center' }}>
                <p style={{ margin: 0, marginBottom: '0.5rem' }}>Ainda não há departamentos.</p>
                <p style={{ margin: 0, fontSize: '0.82rem' }}>Cria o primeiro para começar a rotear conversas por equipa (Vendas, Suporte, etc).</p>
              </div>
            )}

            <div style={S.cards}>
              {departments.map(d => (
                <div key={d.id} style={{ ...S.card, minWidth: 240, maxWidth: 320, borderLeft: `5px solid ${d.color}`, position: 'relative', padding: '1.25rem' }}>
                  {d.is_default ? (
                    <span style={{ position: 'absolute', top: 10, right: 10, background: 'var(--accent-l)', color: 'var(--accent)', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.68rem', fontWeight: 700 }}>Padrão</span>
                  ) : null}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{d.name}</strong>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.4rem' }}>
                    👥 {d.member_count} atendente(s){'   '}·{'   '}💬 {d.active_conversations} aberta(s)
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.9rem' }}>
                    ⏱ SLA: {d.sla_minutes ? <strong style={{ color: 'var(--text)' }}>{d.sla_minutes} min</strong> : <span style={{ fontStyle: 'italic' }}>usa global</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button style={S.outlineBtn} onClick={() => setDeptForm({ id: d.id, name: d.name, color: d.color, is_default: !!d.is_default, sla_minutes: d.sla_minutes ?? '' })}>Editar</button>
                    <button style={S.outlineBtn} onClick={() => openMembers(d.id)}>Membros</button>
                    <button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setDeptToArchive({ id: d.id, name: d.name, open_count: d.active_conversations })}>Arquivar</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal: criar / editar */}
            {deptForm && (
              <div style={S.modalOverlay} onClick={() => setDeptForm(null)}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0 }}>{deptForm.id ? 'Editar' : 'Novo'} departamento</h3>
                  <label style={S.fieldLabel}>Nome</label>
                  <input style={{ ...S.input, width: '100%', marginBottom: '1rem', boxSizing: 'border-box' }}
                    placeholder="Ex: Vendas, Suporte, Financeiro" autoFocus
                    value={deptForm.name}
                    onChange={e => setDeptForm(p => ({ ...p, name: e.target.value }))} />
                  <label style={S.fieldLabel}>Cor</label>
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setDeptForm(p => ({ ...p, color: c }))}
                        style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: deptForm.color === c ? '3px solid var(--text)' : '2px solid var(--border-m)', cursor: 'pointer', padding: 0 }} />
                    ))}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!deptForm.is_default}
                      onChange={e => setDeptForm(p => ({ ...p, is_default: e.target.checked }))}
                      style={{ marginTop: 2 }} />
                    <span>
                      <strong>Marcar como padrão</strong>
                      <br />
                      <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Recebe conversas que não casam com nenhuma regra de keyword. Só pode haver um padrão.</span>
                    </span>
                  </label>
                  <label style={S.fieldLabel}>SLA (minutos) — opcional</label>
                  <input type="number" min="1" max="10080" style={{ ...S.input, width: '100%', marginBottom: '0.4rem', boxSizing: 'border-box' }}
                    placeholder="Deixa vazio para usar default global"
                    value={deptForm.sla_minutes ?? ''}
                    onChange={e => setDeptForm(p => ({ ...p, sla_minutes: e.target.value }))} />
                  <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: 0, marginBottom: '1.25rem' }}>
                    Tempo limite para responder ao cliente neste dept antes de disparar alerta. Vazio = usa o valor global definido em Settings.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button style={S.outlineBtn} onClick={() => setDeptForm(null)}>Cancelar</button>
                    <button style={S.addBtn} onClick={saveDept}>Guardar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal: membros */}
            {deptMembersFor && (
              <div style={S.modalOverlay} onClick={() => setDeptMembersFor(null)}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0 }}>Membros — {departments.find(d => d.id === deptMembersFor)?.name}</h3>
                  <p style={{ color: 'var(--muted)', fontSize: '0.83rem', marginTop: 0, marginBottom: '0.75rem' }}>
                    Atendentes marcados vão receber conversas roteadas para este departamento.
                  </p>
                  <input
                    style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
                    placeholder="Filtrar por nome..."
                    value={deptMemberSearch}
                    onChange={e => setDeptMemberSearch(e.target.value)}
                  />
                  <div style={{ maxHeight: '38vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '0.5rem', marginBottom: '1rem' }}>
                    {activeAttendants.filter(a => !deptMemberSearch || a.name.toLowerCase().includes(deptMemberSearch.toLowerCase())).length === 0 && (
                      <p style={{ margin: 0, color: 'var(--hint)', fontSize: '0.85rem' }}>Nenhum resultado</p>
                    )}
                    {activeAttendants.filter(a => !deptMemberSearch || a.name.toLowerCase().includes(deptMemberSearch.toLowerCase())).map(a => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.5rem', cursor: 'pointer', fontSize: '0.9rem', borderRadius: 'var(--r-sm)' }}>
                        <input type="checkbox" checked={deptMembers.includes(a.id)}
                          onChange={e => setDeptMembers(prev => e.target.checked ? [...prev, a.id] : prev.filter(x => x !== a.id))} />
                        <span style={{ flex: 1 }}>{a.name}</span>
                        <span style={{ fontSize: '0.72rem', color: a.status === 'online' ? 'var(--success)' : 'var(--hint)' }}>{a.status}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button style={S.outlineBtn} onClick={() => setDeptMembersFor(null)}>Cancelar</button>
                    <button style={S.addBtn} onClick={saveMembers}>Guardar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal: arquivar */}
            {deptToArchive && (
              <div style={S.modalOverlay} onClick={() => { setDeptToArchive(null); setReassignTarget(''); }}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0 }}>Arquivar departamento</h3>
                  <p style={{ fontSize: '0.9rem' }}>Arquivar <strong>{deptToArchive.name}</strong>? Esta acção pode ser revertida diretamente na BD se necessário.</p>
                  {deptToArchive.open_count > 0 && (
                    <>
                      <p style={{ fontSize: '0.85rem', color: 'var(--warn)', background: 'var(--warn-l)', padding: '0.6rem 0.8rem', borderRadius: 'var(--r-sm)', marginBottom: '0.75rem' }}>
                        ⚠️ Existem {deptToArchive.open_count} conversa(s) abertas neste departamento. Escolha um departamento para receber:
                      </p>
                      <select style={{ ...S.select, width: '100%', marginBottom: '1rem', boxSizing: 'border-box' }} value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}>
                        <option value="">— Escolher departamento —</option>
                        {departments.filter(d => d.id !== deptToArchive.id).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button style={S.outlineBtn} onClick={() => { setDeptToArchive(null); setReassignTarget(''); }}>Cancelar</button>
                    <button style={{ ...S.addBtn, background: 'var(--danger)' }}
                      disabled={deptToArchive.open_count > 0 && !reassignTarget}
                      onClick={archiveDept}>
                      Arquivar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LINHAS WHATSAPP */}
        {tab === 'lines' && (
          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ ...S.sectionTitle, margin: 0 }}>📱 Linhas WhatsApp</h2>
              <button style={S.addBtn} onClick={() => setLineForm({ name: '', color: '#25D366' })}>+ Nova linha</button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Cada linha = uma instância WhatsApp independente. Útil para separar Vendas / Suporte / Financeiro em números diferentes.
            </p>

            <div style={S.cards}>
              {lines.map(l => {
                const isReady = l.wa_ready;
                const hasQr = l.has_qr;
                const statusColor = isReady ? '#22c55e' : hasQr ? '#f97316' : '#9ca3af';
                const statusLabel = isReady ? 'Conectada' : hasQr ? 'QR pendente' : 'Desligada';
                return (
                  <div key={l.id} style={{ ...S.card, minWidth: 260, maxWidth: 340, borderLeft: `5px solid ${l.color}`, position: 'relative', padding: '1.25rem' }}>
                    {l.is_default ? (
                      <span style={{ position: 'absolute', top: 10, right: 10, background: 'var(--accent-l)', color: 'var(--accent)', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.68rem', fontWeight: 700 }}>Padrão</span>
                    ) : null}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                      <span style={{ width: 12, height: 12, borderRadius: '50%', background: l.color }} />
                      <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{l.name}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', marginBottom: '0.4rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                      <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.4rem' }}>
                      💬 {l.active_conversations} activa(s) · {l.total_conversations} total
                    </div>
                    {l.department_name && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.7rem' }}>
                        <span style={{ background: l.department_color || '#6366f1', color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '999px', fontWeight: 600 }}>
                          🏢 {l.department_name}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button style={S.outlineBtn} onClick={() => setLineForm({ id: l.id, name: l.name, color: l.color, is_default: !!l.is_default, department_id: l.department_id || '' })}>Editar</button>
                      {!isReady && <button style={{ ...S.outlineBtn, color: '#22c55e', borderColor: '#22c55e' }} onClick={() => openLineQr(l.id)}>📱 QR</button>}
                      {isReady && <button style={S.outlineBtn} onClick={() => disconnectLine(l.id)}>Desligar</button>}
                      {!isReady && !hasQr && <button style={S.outlineBtn} onClick={() => reconnectLine(l.id)}>Reconectar</button>}
                      <button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setLineToArchive({ id: l.id, name: l.name, open_count: l.active_conversations, is_default: l.is_default })}>Arquivar</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal: criar/editar linha */}
            {lineForm && (
              <div style={S.modalOverlay} onClick={() => setLineForm(null)}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0 }}>{lineForm.id ? 'Editar' : 'Nova'} linha</h3>
                  <label style={S.fieldLabel}>Nome</label>
                  <input style={{ ...S.input, width: '100%', marginBottom: '1rem', boxSizing: 'border-box' }}
                    placeholder="Ex: Vendas, Suporte, Financeiro" autoFocus
                    value={lineForm.name} onChange={e => setLineForm(p => ({ ...p, name: e.target.value }))} />
                  <label style={S.fieldLabel}>Cor</label>
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {['#25D366','#2563eb','#f97316','#dc2626','#a855f7','#0ea5e9','#84cc16','#ec4899'].map(c => (
                      <button key={c} type="button" onClick={() => setLineForm(p => ({ ...p, color: c }))}
                        style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: lineForm.color === c ? '3px solid var(--text)' : '2px solid var(--border-m)', cursor: 'pointer', padding: 0 }} />
                    ))}
                  </div>
                  <label style={S.fieldLabel}>Departamento (roteamento automático)</label>
                  <select style={{ ...S.input, width: '100%', marginBottom: '1rem', boxSizing: 'border-box' }}
                    value={lineForm.department_id || ''} onChange={e => setLineForm(p => ({ ...p, department_id: e.target.value }))}>
                    <option value="">— Nenhum (usa palavras-chave ou padrão) —</option>
                    {departments.filter(d => d.active).map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {lineForm.department_id && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '-0.75rem', marginBottom: '1rem' }}>
                      ✅ Todas as conversas desta linha vão directo para <strong>{departments.find(d => String(d.id) === String(lineForm.department_id))?.name}</strong>, ignorando regras de palavras-chave.
                    </p>
                  )}
                  {lineForm.id && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!lineForm.is_default} onChange={e => setLineForm(p => ({ ...p, is_default: e.target.checked }))} style={{ marginTop: 2 }} />
                      <span>
                        <strong>Linha padrão</strong>
                        <br /><span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Usada para outbound/broadcast quando nenhuma linha é explicitamente escolhida.</span>
                      </span>
                    </label>
                  )}
                  {!lineForm.id && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 0, marginBottom: '1rem' }}>
                      Ao guardar, a linha vai gerar um QR Code que tens que escanear com um número WhatsApp <strong>diferente</strong> dos das outras linhas (cada linha = um número independente).
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button style={S.outlineBtn} onClick={() => setLineForm(null)}>Cancelar</button>
                    <button style={S.addBtn} onClick={saveLine}>Guardar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal: QR de uma linha */}
            {lineQrFor && (
              <div style={S.modalOverlay} onClick={() => { setLineQrFor(null); setLineQrData(null); }}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0 }}>QR — {lines.find(l => l.id === lineQrFor)?.name}</h3>
                  {!lineQrData && <p style={{ color: 'var(--muted)' }}>A aguardar QR Code...</p>}
                  {lineQrData === 'READY' && <p style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Linha já conectada — sem QR.</p>}
                  {lineQrData && lineQrData !== 'READY' && (
                    <>
                      <img src={lineQrData} alt="QR" style={{ width: '100%', maxWidth: 300, display: 'block', margin: '0 auto' }} />
                      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'center', marginTop: '0.75rem' }}>
                        WhatsApp → Definições → Aparelhos conectados → Conectar aparelho
                      </p>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button style={S.outlineBtn} onClick={() => { setLineQrFor(null); setLineQrData(null); }}>Fechar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal: arquivar */}
            {lineToArchive && (
              <div style={S.modalOverlay} onClick={() => { setLineToArchive(null); setLineReassign(''); }}>
                <div style={S.modal} onClick={e => e.stopPropagation()}>
                  <h3 style={{ marginTop: 0 }}>Arquivar linha</h3>
                  <p>Arquivar <strong>{lineToArchive.name}</strong>?</p>
                  {lineToArchive.is_default && (
                    <p style={{ background: 'var(--danger-l)', color: 'var(--danger)', padding: '0.6rem', borderRadius: 'var(--r-sm)', fontSize: '0.85rem' }}>
                      ⚠️ Esta é a linha padrão. Marca outra como padrão antes de arquivar.
                    </p>
                  )}
                  {lineToArchive.open_count > 0 && (
                    <>
                      <p style={{ background: 'var(--warn-l)', color: 'var(--warn)', padding: '0.6rem', borderRadius: 'var(--r-sm)', fontSize: '0.85rem' }}>
                        ⚠️ Existem {lineToArchive.open_count} conversa(s) abertas. Escolhe uma linha de destino:
                      </p>
                      <select style={{ ...S.input, width: '100%', marginBottom: '1rem', boxSizing: 'border-box' }} value={lineReassign} onChange={e => setLineReassign(e.target.value)}>
                        <option value="">— Escolher linha —</option>
                        {lines.filter(l => l.id !== lineToArchive.id).map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button style={S.outlineBtn} onClick={() => { setLineToArchive(null); setLineReassign(''); }}>Cancelar</button>
                    <button style={{ ...S.addBtn, background: 'var(--danger)' }}
                      disabled={lineToArchive.is_default || (lineToArchive.open_count > 0 && !lineReassign)}
                      onClick={archiveLine}>Arquivar</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CONTACTOS */}
        {tab === 'contacts' && (
          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>Contactos</h2>
              <button style={{ ...S.addBtn, fontSize: '0.82rem' }} onClick={() => { setShowNewContact(true); setNewContactError(''); setNewContact({ phone: '', name: '' }); }}>
                ➕ Novo contacto
              </button>
              <button style={{ ...S.outlineBtn, fontSize: '0.82rem' }} onClick={() => { setShowCsvModal(true); setCsvRows([]); setCsvError(''); setCsvImportResult(null); }}>
                📥 Importar CSV
              </button>
              <button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: '0.82rem' }} onClick={cleanupInvalidContacts}>
                🧹 Limpar inválidos
              </button>
            </div>

            {/* Modal novo contacto */}
            {showNewContact && (
              <div style={S.modalOverlay}>
                <div style={{ ...S.modal, maxWidth: '400px' }}>
                  <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', color: 'var(--text)' }}>➕ Novo Contacto</h3>
                  <label style={S.fieldLabel}>Número de telefone *</label>
                  <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '0.75rem' }}
                    placeholder="Ex: 5596912345678"
                    value={newContact.phone}
                    onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && saveNewContact()}
                    autoFocus
                  />
                  <label style={S.fieldLabel}>Nome</label>
                  <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '1rem' }}
                    placeholder="Nome do contacto (opcional)"
                    value={newContact.name}
                    onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && saveNewContact()}
                  />
                  {newContactError && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>{newContactError}</p>}
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button style={S.outlineBtn} onClick={() => setShowNewContact(false)}>Cancelar</button>
                    <button style={S.addBtn} onClick={saveNewContact}>Guardar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal importar CSV */}
            {showCsvModal && (
              <div style={S.modalOverlay}>
                <div style={{ ...S.modal, width: '100%', maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text)' }}>📥 Importar Contactos por CSV</h3>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--muted)' }} onClick={() => setShowCsvModal(false)}>✕</button>
                  </div>

                  {csvImportResult ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
                      <p style={{ fontWeight: 700, color: 'var(--text)', margin: '0 0 0.25rem' }}>{csvImportResult.imported} contacto(s) importado(s)</p>
                      <p style={{ color: 'var(--hint)', fontSize: '0.85rem', margin: 0 }}>{csvImportResult.skipped} já existiam</p>
                      <button style={{ ...S.addBtn, marginTop: '1.25rem' }} onClick={() => setShowCsvModal(false)}>Fechar</button>
                    </div>
                  ) : csvRows.length > 0 ? (
                    <>
                      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{csvRows.length} contacto(s) detectado(s) — confirma a importação:</p>
                      <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', marginBottom: '1rem' }}>
                        <table style={{ ...S.table, margin: 0 }}>
                          <thead><tr><th>Nome</th><th>Número</th></tr></thead>
                          <tbody>
                            {csvRows.slice(0, 50).map((r, i) => (
                              <tr key={i}>
                                <td>{r.name || '—'}</td>
                                <td style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{r.phone}</td>
                              </tr>
                            ))}
                            {csvRows.length > 50 && <tr><td colSpan={2} style={{ color: 'var(--hint)', textAlign: 'center', fontSize: '0.8rem' }}>...e mais {csvRows.length - 50}</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button style={S.outlineBtn} onClick={() => setCsvRows([])}>← Voltar</button>
                        <button style={S.addBtn} onClick={doCsvImport}>📥 Importar {csvRows.length} contacto(s)</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
                        Seleciona um ficheiro <strong>.csv</strong> com colunas <code>nome</code> e <code>telefone</code> (separador <code>,</code> ou <code>;</code>).
                        O cabeçalho é opcional.<br />
                        Exemplo: <code>João Silva;5596912345678</code>
                      </p>
                      {csvError && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>{csvError}</p>}
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: '2px dashed var(--border-m)', borderRadius: 'var(--r-sm)', padding: '2rem', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.9rem' }}>
                        📂 Clica para escolher o ficheiro CSV
                        <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCsvFile} />
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}

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


        {/* DASHBOARD */}
        {tab === 'dashboard' && <DashboardPage socket={socket} />}


        {/* RELATÓRIOS */}
        {tab === 'reports' && <ReportsPage />}

        {/* RESPOSTAS RÁPIDAS */}
        {tab === 'quickreplies' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>Respostas Rápidas</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Os atendentes digitam <strong>/atalho</strong> no chat para usar. A categoria agrupa as sugestões.</p>

            {/* Painel de variáveis disponíveis — clique para copiar para a área de transferência */}
            <details style={{ marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.6rem 0.85rem', background: 'var(--bg)' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                💡 Variáveis disponíveis no texto da resposta
              </summary>
              <p style={{ margin: '0.5rem 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
                Inclui qualquer destas no texto. São substituídas pelos valores reais quando o atendente carrega no atalho.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.4rem 1rem' }}>
                {[
                  ['{{nome}}',                     'Nome completo do contacto'],
                  ['{{primeiro_nome}}',            'Primeira palavra do nome'],
                  ['{{telefone}}',                 'Número de telefone'],
                  ['{{atendente}}',                'Nome do atendente'],
                  ['{{primeiro_nome_atendente}}',  '1º nome do atendente'],
                  ['{{saudacao}}',                 'Bom dia / Boa tarde / Boa noite'],
                  ['{{empresa}}',                  'Nome do tenant'],
                ].map(([v, d]) => (
                  <div key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
                    <code
                      title="Clique para copiar"
                      onClick={() => navigator.clipboard?.writeText(v)}
                      style={{ background: 'var(--accent-l)', color: 'var(--accent)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', userSelect: 'all' }}>
                      {v}
                    </code>
                    <span style={{ color: 'var(--muted)' }}>{d}</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--hint)' }}>
                Exemplo: <code style={{ background: 'var(--card)', padding: '1px 4px', borderRadius: '3px' }}>{`{{saudacao}}, {{primeiro_nome}}! Aqui é a {{empresa}}.`}</code>
              </p>
            </details>

            <form onSubmit={addQuickReply} style={{ ...S.form, flexWrap: 'wrap' }}>
              <input style={{ ...S.input, width: '110px' }} placeholder="/atalho" value={newQR.shortcut}
                onChange={e => setNewQR(p => ({ ...p, shortcut: e.target.value }))} required />
              <input style={{ ...S.input, flex: 1, minWidth: '180px' }} placeholder="Texto da resposta" value={newQR.body}
                onChange={e => setNewQR(p => ({ ...p, body: e.target.value }))} required />
              <input style={{ ...S.input, width: '120px' }} placeholder="Categoria (opcional)" value={newQR.category}
                onChange={e => setNewQR(p => ({ ...p, category: e.target.value }))} />
              <label title="Marca para criar apenas para ti; desmarcado = global (toda a equipa usa)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--muted)', cursor: 'pointer', padding: '0 0.5rem' }}>
                <input type="checkbox" checked={newQR.is_personal} onChange={e => setNewQR(p => ({ ...p, is_personal: e.target.checked }))} />
                Pessoal
              </label>
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={S.table}>
              <thead><tr><th>Atalho</th><th>Mensagem</th><th>Visibilidade</th><th>Categoria</th><th></th></tr></thead>
              <tbody>
                {quickReplies.map(qr => (
                  <tr key={qr.id}>
                    <td><strong style={{ color: 'var(--accent)' }}>/{qr.shortcut}</strong></td>
                    <td style={{ maxWidth: '300px', wordBreak: 'break-word', color: 'var(--muted)' }}>{qr.body}</td>
                    <td>
                      {qr.owner_user_id === null ? (
                        <span style={{ background: 'var(--success-l)', color: 'var(--success)', padding: '1px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600 }}>🌐 Global</span>
                      ) : (
                        <span style={{ background: '#fef3c7', color: '#b45309', padding: '1px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600 }} title={`Pessoal de ${qr.owner_name || '?'}`}>
                          👤 {qr.owner_name || 'Pessoal'}
                        </span>
                      )}
                    </td>
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
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Etiquetas globais aparecem em todos os departamentos. Etiquetas de departamento aparecem apenas nas conversas desse departamento.
            </p>
            <form onSubmit={addTag} style={{ ...S.form, flexWrap: 'wrap', marginBottom: '1rem' }}>
              <input style={{ ...S.input, flex: '1 1 140px' }} placeholder="Nome da etiqueta" value={newTag.name}
                onChange={e => setNewTag(p => ({ ...p, name: e.target.value }))} required />
              {user.role === 'owner' && (
                <select style={{ ...S.select, flex: '1 1 160px' }} value={newTag.department_id || ''}
                  onChange={e => setNewTag(p => ({ ...p, department_id: e.target.value }))}>
                  <option value="">🌐 Global (todos os dept.)</option>
                  {departments.filter(d => d.active).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {COLORS.map(col => (
                  <div key={col} onClick={() => setNewTag(p => ({ ...p, color: col }))}
                    style={{ width: 22, height: 22, background: col, borderRadius: '50%', cursor: 'pointer', border: newTag.color === col ? '3px solid var(--text)' : '3px solid transparent', transition: 'border .1s' }} />
                ))}
              </div>
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>

            {/* Group by dept */}
            {(() => {
              const global = tags.filter(t => !t.department_id);
              const byDept = {};
              tags.filter(t => t.department_id).forEach(t => {
                if (!byDept[t.department_id]) byDept[t.department_id] = [];
                byDept[t.department_id].push(t);
              });
              const renderTag = t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: t.color + '18', border: `1px solid ${t.color}55`, borderRadius: '999px', padding: '0.3rem 0.75rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <span style={{ color: t.color, fontWeight: 600, fontSize: '0.83rem' }}>{t.name}</span>
                  <button onClick={() => deleteTag(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.color, fontSize: '0.75rem', padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              );
              return (
                <>
                  {global.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>🌐 Global</p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{global.map(renderTag)}</div>
                    </div>
                  )}
                  {Object.entries(byDept).map(([deptId, deptTags]) => {
                    const dept = departments.find(d => String(d.id) === String(deptId));
                    return (
                      <div key={deptId} style={{ marginBottom: '1rem' }}>
                        <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: dept?.color || 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          🏢 {dept?.name || `Dept #${deptId}`}
                        </p>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{deptTags.map(renderTag)}</div>
                      </div>
                    );
                  })}
                  {tags.length === 0 && <p style={{ color: 'var(--hint)', fontSize: '0.85rem' }}>Sem etiquetas. Cria a primeira acima.</p>}
                </>
              );
            })()}
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
            <h3 style={S.subTitle}>🤖 Regras por palavra-chave</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Quando uma mensagem nova contém a palavra-chave, a regra pode (1) responder automaticamente, (2) rotear a conversa para um departamento, ou ambos.
              Em caso de empate, ganha a regra com <strong>prioridade menor</strong>.
            </p>
            <form onSubmit={addKeywordRule} style={{ ...S.form, flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <label style={S.fieldLabel}>Palavra-chave</label>
                <input style={{ ...S.input, width: '140px' }} placeholder="defeito" value={newKR.keyword}
                  onChange={e => setNewKR(p => ({ ...p, keyword: e.target.value }))} required />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1, minWidth: '180px' }}>
                <label style={S.fieldLabel}>Resposta automática (opcional)</label>
                <input style={{ ...S.input }} placeholder="Deixe em branco para apenas rotear" value={newKR.response}
                  onChange={e => setNewKR(p => ({ ...p, response: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <label style={S.fieldLabel}>Rotear para</label>
                <select style={{ ...S.input, width: '160px' }} value={newKR.department_id}
                  onChange={e => setNewKR(p => ({ ...p, department_id: e.target.value }))}>
                  <option value="">— Nenhum —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <label style={S.fieldLabel}>Aplicar etiqueta</label>
                <select style={{ ...S.input, width: '160px' }} value={newKR.tag_id}
                  onChange={e => setNewKR(p => ({ ...p, tag_id: e.target.value }))}>
                  <option value="">— Nenhuma —</option>
                  {tags.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <label style={S.fieldLabel} title="Menor número = mais prioritária. Default: 100">Prioridade</label>
                <input type="number" style={{ ...S.input, width: '80px' }} value={newKR.priority}
                  onChange={e => setNewKR(p => ({ ...p, priority: e.target.value }))} />
              </div>
              <button style={S.addBtn} type="submit">Adicionar</button>
            </form>
            <table style={S.table}>
              <thead><tr><th>Prio.</th><th>Palavra-chave</th><th>Resposta</th><th>Departamento</th><th>Etiqueta</th><th>Ativa</th><th></th></tr></thead>
              <tbody>
                {keywordRules.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'monospace' }}>{r.priority ?? 100}</td>
                    <td><strong style={{ color: 'var(--accent)' }}>{r.keyword}</strong></td>
                    <td style={{ maxWidth: '280px', wordBreak: 'break-word', color: r.response ? 'var(--muted)' : 'var(--hint)', fontSize: '0.85rem', fontStyle: r.response ? 'normal' : 'italic' }}>
                      {r.response || '— (sem resposta)'}
                    </td>
                    <td>
                      {r.department_name ? (
                        <span style={{ background: (r.department_color || '#6b7280') + '18', border: `1px solid ${(r.department_color || '#6b7280')}55`, color: r.department_color || '#6b7280', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.department_color || '#6b7280' }} />
                          {r.department_name}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--hint)', fontSize: '0.78rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      {r.tag_name ? (
                        <span style={{ background: (r.tag_color || '#6b7280') + '18', border: `1px solid ${(r.tag_color || '#6b7280')}55`, color: r.tag_color || '#6b7280', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.72rem', fontWeight: 600 }}>
                          🏷️ {r.tag_name}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--hint)', fontSize: '0.78rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      <button onClick={() => toggleKeywordRule(r.id, r.active)}
                        style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, background: r.active ? 'var(--success)' : 'var(--border)', color: r.active ? '#fff' : 'var(--muted)' }}>
                        {r.active ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    <td><button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => deleteKeywordRule(r.id)}>Eliminar</button></td>
                  </tr>
                ))}
                {keywordRules.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--hint)', textAlign: 'center', padding: '1rem' }}>Sem regras criadas</td></tr>}
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

            {/* --- Reabertura inteligente --- */}
            <h3 style={{ ...S.subTitle, marginTop: '2rem' }}>🔁 Reabertura Inteligente</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Quando um cliente responde a uma conversa fechada, dentro da janela definida, a conversa é reaberta automaticamente.
              Se o atendente anterior estiver disponível, a conversa volta directamente para ele; caso contrário vai para a fila de espera.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>Janela de reabertura:</label>
              <select style={{ ...S.select, fontSize: '0.85rem' }}
                value={settings.reopen_window_days || '1'}
                onChange={e => setSettings(s => ({ ...s, reopen_window_days: e.target.value }))}>
                <option value="0">Nunca reabrir (sempre nova conversa)</option>
                <option value="1">1 dia (24 horas)</option>
                <option value="3">3 dias</option>
                <option value="7">7 dias</option>
                <option value="30">30 dias</option>
                <option value="9999">Sempre reabrir</option>
              </select>
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
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Envia resposta automática fora do horário de atendimento. Configurado por linha.
            </p>
            {/* Line selector */}
            <div style={{ marginBottom: '1.5rem', maxWidth: '360px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Linha</label>
              <select style={{ ...S.select, width: '100%', boxSizing: 'border-box' }}
                value={selectedBotLine || ''}
                onChange={e => {
                  const id = e.target.value ? parseInt(e.target.value, 10) : null;
                  setSelectedBotLine(id);
                  if (id) loadBotSettings(id);
                }}>
                <option value="">— Selecionar linha —</option>
                {lines.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            {selectedBotLine && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '560px' }}>
                <label style={S.settingRow}>
                  <span style={{ fontWeight: 500 }}>Ativar bot nesta linha</span>
                  <input type="checkbox" checked={!!botSettings.enabled}
                    onChange={e => setBotSettings(s => ({ ...s, enabled: e.target.checked ? 1 : 0 }))} />
                </label>
                <div>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>Horário de atendimento por dia</p>
                  <p style={{ margin: '-0.5rem 0 0.75rem', fontSize: '0.78rem', color: 'var(--hint)' }}>
                    O bot dispara <strong>fora</strong> deste horário. Dias marcados como "Fechado" = bot activo o dia todo.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {[['Dom',0],['Seg',1],['Ter',2],['Qua',3],['Qui',4],['Sex',5],['Sáb',6]].map(([label, i]) => {
                      const key = `hours_${i}`;
                      const val = botSettings[key] || 'closed';
                      const isOpen = val !== 'closed';
                      const [start, end] = isOpen ? val.split('-') : ['07:00', '18:00'];
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.88rem' }}>
                          <span style={{ width: '36px', fontWeight: 600, color: 'var(--text)' }}>{label}</span>
                          <input type="checkbox" checked={isOpen} onChange={e => {
                            setBotSettings(s => ({ ...s, [key]: e.target.checked ? `${start}-${end}` : 'closed' }));
                          }} />
                          {isOpen ? (
                            <>
                              <input type="time" style={{ ...S.input, padding: '0.25rem 0.5rem' }} value={start}
                                onChange={e => setBotSettings(s => ({ ...s, [key]: `${e.target.value}-${end}` }))} />
                              <span style={{ color: 'var(--hint)' }}>até</span>
                              <input type="time" style={{ ...S.input, padding: '0.25rem 0.5rem' }} value={end}
                                onChange={e => setBotSettings(s => ({ ...s, [key]: `${start}-${e.target.value}` }))} />
                            </>
                          ) : (
                            <span style={{ color: 'var(--hint)', fontSize: '0.8rem' }}>Fechado (bot activo)</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Mensagem automática</label>
                  <textarea style={{ ...S.input, width: '100%', resize: 'vertical', minHeight: '90px', boxSizing: 'border-box' }}
                    value={botSettings.message}
                    onChange={e => setBotSettings(s => ({ ...s, message: e.target.value }))}
                    placeholder="Ex: Olá! Estamos fora do horário de atendimento. Voltaremos em breve." />
                </div>
                <button style={{ ...S.addBtn, alignSelf: 'flex-start' }} onClick={saveBotSettings}>
                  {botSaved ? '✓ Guardado' : 'Guardar'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ASSINATURA */}
        {tab === 'signature' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>🔔 Assinatura Automática</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Quando uma nova conversa é atribuída a um atendente, é enviada automaticamente uma mensagem de saudação com o nome do atendente.
              Use <strong style={{ color: 'var(--accent)' }}>{'{{nome}}'}</strong> para inserir o nome do atendente.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '560px' }}>
              <label style={S.settingRow}>
                <span style={{ fontWeight: 500 }}>Ativar assinatura automática</span>
                <input type="checkbox" checked={settings.signature_enabled === '1'}
                  onChange={e => setSettings(s => ({ ...s, signature_enabled: e.target.checked ? '1' : '0' }))} />
              </label>
              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Mensagem de saudação
                </label>
                <textarea
                  style={{ ...S.input, width: '100%', resize: 'vertical', minHeight: '90px', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  value={settings.signature_message || ''}
                  onChange={e => setSettings(s => ({ ...s, signature_message: e.target.value }))}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--hint)', margin: '0.35rem 0 0' }}>
                  Exemplo: <em>Olá! 😊 Meu nome é <strong>{'{{nome}}'}</strong> e estou aqui para ajudá-lo.</em>
                </p>
              </div>
              <button style={{ ...S.addBtn, alignSelf: 'flex-start' }} onClick={saveSettings}>
                {settingsSaved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* AVALIAÇÃO */}
        {tab === 'rating' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>⭐ Avaliação de Atendimento</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Quando uma conversa é fechada, é enviada automaticamente uma mensagem ao cliente pedindo avaliação de 1 a 5.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '560px' }}>
              <label style={S.settingRow}>
                <span style={{ fontWeight: 500 }}>Ativar avaliação automática</span>
                <input type="checkbox" checked={settings.rating_enabled === '1'}
                  onChange={e => setSettings(s => ({ ...s, rating_enabled: e.target.checked ? '1' : '0' }))} />
              </label>
              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Mensagem de avaliação
                </label>
                <textarea
                  style={{ ...S.input, width: '100%', resize: 'vertical', minHeight: '130px', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  value={settings.rating_message || ''}
                  onChange={e => setSettings(s => ({ ...s, rating_message: e.target.value }))}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--hint)', margin: '0.35rem 0 0' }}>
                  O cliente deve responder com o número 1 a 5. A resposta é registada automaticamente.
                </p>
              </div>
              <button style={{ ...S.addBtn, alignSelf: 'flex-start' }} onClick={saveSettings}>
                {settingsSaved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* BLACKLIST */}
        {tab === 'blacklist' && (
          <div style={S.section}>
            <h2 style={S.sectionTitle}>🚫 Blacklist de Contactos</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Números nesta lista são silenciosamente ignorados — as mensagens não criam conversas nem são processadas.
            </p>
            <form onSubmit={addToBlacklist} style={{ ...S.form, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <input style={{ ...S.input, width: '180px' }} placeholder="Número (ex: 5511999999999)" value={newBlocked.phone}
                onChange={e => setNewBlocked(p => ({ ...p, phone: e.target.value }))} required />
              <input style={{ ...S.input, flex: 1, minWidth: '180px' }} placeholder="Motivo (opcional)" value={newBlocked.reason}
                onChange={e => setNewBlocked(p => ({ ...p, reason: e.target.value }))} />
              <button style={S.addBtn} type="submit">Bloquear</button>
            </form>
            {blacklist.length === 0 ? (
              <p style={{ color: 'var(--hint)', fontSize: '0.88rem' }}>Nenhum número bloqueado.</p>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 600, fontSize: '0.8rem' }}>Número</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 600, fontSize: '0.8rem' }}>Motivo</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 600, fontSize: '0.8rem' }}>Bloqueado por</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 600, fontSize: '0.8rem' }}>Data</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {blacklist.map(b => (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: 'var(--danger)', fontSize: '0.88rem' }}>🚫 {b.phone}</td>
                      <td style={{ padding: '0.6rem 0.5rem', color: 'var(--muted)', fontSize: '0.85rem', maxWidth: '220px', wordBreak: 'break-word' }}>{b.reason || '—'}</td>
                      <td style={{ padding: '0.6rem 0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>{b.created_by_name || '—'}</td>
                      <td style={{ padding: '0.6rem 0.5rem', color: 'var(--hint)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {new Date(b.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem' }}>
                        <button style={{ ...S.outlineBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                          onClick={() => removeFromBlacklist(b.id, b.phone)}>
                          Desbloquear
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ENVIO EM MASSA */}
        {tab === 'broadcast' && (() => {
          const filtered = broadcastContacts.filter(c => {
            const q = broadcastSearch.toLowerCase();
            return !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
          });
          const allFilteredSelected = filtered.length > 0 && filtered.every(c => broadcastSelected.has(c.id));
          const pct = broadcastProgress ? Math.round(((broadcastProgress.sent + broadcastProgress.failed) / broadcastProgress.total) * 100) : 0;
          return (
            <div style={S.section}>
              <h2 style={S.sectionTitle}>📣 Envio em Massa</h2>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Selecciona os contactos e escreve a mensagem. O envio é feito com intervalo de 1,5s entre cada mensagem para evitar bloqueios.
              </p>

              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* Painel esquerdo: lista de contactos */}
                <div style={{ flex: '1 1 300px', minWidth: '260px', maxWidth: '420px' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                    <input style={{ ...S.input, flex: 1 }} placeholder="Pesquisar contacto..."
                      value={broadcastSearch}
                      onChange={e => { setBroadcastSearch(e.target.value); loadBroadcastContacts(e.target.value); }} />
                    <button style={S.outlineBtn} onClick={() => {
                      if (allFilteredSelected) {
                        setBroadcastSelected(prev => { const next = new Set(prev); filtered.forEach(c => next.delete(c.id)); return next; });
                      } else {
                        setBroadcastSelected(prev => { const next = new Set(prev); filtered.forEach(c => next.add(c.id)); return next; });
                      }
                    }}>
                      {allFilteredSelected ? 'Desmarcar todos' : 'Selec. todos'}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--hint)', marginBottom: '0.5rem' }}>
                    {broadcastSelected.size} seleccionado(s) · {filtered.length} visível(is)
                  </div>
                  <div style={{ maxHeight: '380px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg)' }}>
                    {filtered.length === 0 && (
                      <div style={{ padding: '1rem', color: 'var(--hint)', textAlign: 'center', fontSize: '0.85rem' }}>Sem contactos</div>
                    )}
                    {filtered.map(c => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: broadcastSelected.has(c.id) ? 'var(--accent-l)' : 'transparent', transition: 'background 0.1s' }}>
                        <input type="checkbox" checked={broadcastSelected.has(c.id)}
                          onChange={e => setBroadcastSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(c.id) : next.delete(c.id); return next; })} />
                        <div style={{ minWidth: 28, height: 28, borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                          {(c.name || c.phone || '?')[0].toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || c.phone}</div>
                          {c.name && <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{c.phone}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Painel direito: mensagem + envio */}
                <div style={{ flex: '1 1 320px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ marginBottom: "0.75rem" }}>
                    <label style={{ ...S.fieldLabel, marginBottom: "0.4rem" }}>Linha de envio</label>
                    <select style={{ ...S.input, width: "100%" }} value={broadcastLineId} onChange={e => setBroadcastLineId(e.target.value)} disabled={broadcastSending}>
                      <option value="">Linha padrão</option>
                      {lines.filter(l => l.active).map(ln => (
                        <option key={ln.id} value={ln.id}>{ln.name || ln.phone_number} {ln.is_default ? "(padrão)" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...S.fieldLabel, marginBottom: '0.4rem' }}>Mensagem a enviar</label>
                    <textarea
                      style={{ ...S.input, width: '100%', boxSizing: 'border-box', minHeight: '140px', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem' }}
                      placeholder="Escreve a mensagem aqui..."
                      value={broadcastMessage}
                      disabled={broadcastSending}
                      onChange={e => setBroadcastMessage(e.target.value)}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--hint)', marginTop: '0.3rem' }}>
                      {broadcastMessage.length} caracteres
                    </div>
                  </div>

                  <button
                    style={{ ...S.addBtn, opacity: (broadcastSelected.size === 0 || !broadcastMessage.trim() || broadcastSending) ? 0.5 : 1, cursor: (broadcastSelected.size === 0 || !broadcastMessage.trim() || broadcastSending) ? 'not-allowed' : 'pointer', fontSize: '0.95rem', padding: '0.65rem 1.5rem', alignSelf: 'flex-start' }}
                    disabled={broadcastSelected.size === 0 || !broadcastMessage.trim() || broadcastSending}
                    onClick={sendBroadcast}>
                    {broadcastSending ? '⏳ A enviar...' : `📤 Enviar para ${broadcastSelected.size} contacto(s)`}
                  </button>

                  {/* Barra de progresso */}
                  {broadcastSending && broadcastProgress && (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                        <span>✅ {broadcastProgress.sent} enviadas · ❌ {broadcastProgress.failed} falhas</span>
                        <span style={{ fontWeight: 600 }}>{pct}%</span>
                      </div>
                      <div style={{ background: 'var(--border)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, background: 'var(--accent)', height: '8px', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--hint)', marginTop: '0.4rem' }}>
                        {broadcastProgress.sent + broadcastProgress.failed} / {broadcastProgress.total} processadas
                      </div>
                    </div>
                  )}

                  {/* Resultado final */}
                  {broadcastDone && (
                    <div style={{ background: broadcastDone.failed === 0 ? '#f0fdf4' : '#fff7ed', border: `1px solid ${broadcastDone.failed === 0 ? 'var(--success)' : 'var(--warn)'}`, borderRadius: 'var(--r-md)', padding: '1rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.35rem', color: broadcastDone.failed === 0 ? 'var(--success)' : 'var(--warn)' }}>
                        {broadcastDone.failed === 0 ? '✅ Envio concluído!' : '⚠️ Envio concluído com falhas'}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                        Enviadas: <strong style={{ color: 'var(--success)' }}>{broadcastDone.sent}</strong> &nbsp;·&nbsp;
                        Falhas: <strong style={{ color: 'var(--danger)' }}>{broadcastDone.failed}</strong> &nbsp;·&nbsp;
                        Total: <strong>{broadcastDone.total}</strong>
                      </div>
                      <button style={{ ...S.outlineBtn, marginTop: '0.75rem', fontSize: '0.8rem' }} onClick={() => { setBroadcastDone(null); setBroadcastSelected(new Set()); setBroadcastMessage(''); }}>
                        Nova campanha
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Historico de disparos */}
              <div style={{ marginTop: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text)' }}>Historico de Disparos</h3>
                {broadcastLogs.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Nenhum disparo registado ainda.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600 }}>Data</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600 }}>Usuario</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600 }}>Linha</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600, maxWidth: 220 }}>Mensagem</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'center' }}>Total</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'center' }}>Enviados</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'center' }}>Falhas</th>
                          <th style={{ padding: '0.4rem 0.6rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'center' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {broadcastLogs.map(log => (
                          <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.45rem 0.6rem', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{new Date(log.created_at).toLocaleString('pt-BR')}</td>
                            <td style={{ padding: '0.45rem 0.6rem' }}>{log.user_name || '—'}</td>
                            <td style={{ padding: '0.45rem 0.6rem' }}>{log.line_name || log.line_id || '—'}</td>
                            <td style={{ padding: '0.45rem 0.6rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.message}>{log.message}</td>
                            <td style={{ padding: '0.45rem 0.6rem', textAlign: 'center' }}>{log.total}</td>
                            <td style={{ padding: '0.45rem 0.6rem', textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}>{log.sent}</td>
                            <td style={{ padding: '0.45rem 0.6rem', textAlign: 'center', color: log.failed > 0 ? 'var(--danger)' : 'var(--muted)', fontWeight: log.failed > 0 ? 600 : 400 }}>{log.failed}</td>
                            <td style={{ padding: '0.45rem 0.6rem', textAlign: 'center' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '99px', background: log.status === 'done' ? '#dcfce7' : '#fef9c3', color: log.status === 'done' ? '#16a34a' : '#92400e' }}>
                                {log.status === 'done' ? 'Concluido' : 'A enviar'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

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

      {/* MODAL PERFIL / ALTERAR SENHA */}
      {showProfile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowProfile(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', width: '100%', maxWidth: '380px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '1rem' }}>👤 Meu Perfil</strong>
              <button onClick={() => setShowProfile(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.1rem' }}>✕</button>
            </div>

            <label style={S.fieldLabel}>Nome</label>
            <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }}
              value={profileForm.name}
              onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} />

            <label style={S.fieldLabel}>Email</label>
            <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} type="email"
              value={profileForm.email}
              onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))} />

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.25rem 0' }} />
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>Para alterar email ou senha preenche a senha atual:</p>

            <label style={S.fieldLabel}>Senha atual</label>
            <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} type="password"
              placeholder="Obrigatório para mudar email/senha"
              value={profileForm.current_password}
              onChange={e => setProfileForm(f => ({ ...f, current_password: e.target.value }))} />

            <label style={S.fieldLabel}>Nova senha <span style={{ color: 'var(--hint)', fontWeight: 400 }}>(deixa em branco para não alterar)</span></label>
            <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} type="password"
              placeholder="Mínimo 6 caracteres"
              value={profileForm.password}
              onChange={e => setProfileForm(f => ({ ...f, password: e.target.value }))} />

            <label style={S.fieldLabel}>Confirmar nova senha</label>
            <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} type="password"
              placeholder="Repete a nova senha"
              value={profileForm.password2}
              onChange={e => setProfileForm(f => ({ ...f, password2: e.target.value }))} />

            {profileError && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: 0 }}>{profileError}</p>}
            {profileSuccess && <p style={{ color: 'var(--success, #22c55e)', fontSize: '0.82rem', margin: 0 }}>{profileSuccess}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button style={S.outlineBtn} onClick={() => setShowProfile(false)}>Cancelar</button>
              <button style={S.addBtn} onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? 'A guardar…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
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
