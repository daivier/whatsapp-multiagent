import { useEffect, useState, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import NewConversationModal from './NewConversationModal';

const STATUS_LABEL = { waiting: 'Aguarda', open: 'Aberta', closed: 'Fechada' };
const STATUS_COLOR = { waiting: 'var(--warn)', open: 'var(--success)', closed: 'var(--hint)' };
const STATUS_BG    = { waiting: 'var(--warn-l)', open: 'var(--success-l)', closed: '#f3f4f6' };

// SQLite guarda UTC sem 'Z' — forçar interpretação correta
function utc(str) {
  if (!str) return new Date(str);
  if (/[Z+]/.test(str.slice(-6))) return new Date(str);
  if (str.includes('T')) return new Date(str + 'Z');
  return new Date(str.replace(' ', 'T') + 'Z');
}

function formatWait(dateStr) {
  if (!dateStr) return null;
  const diff = Math.floor((Date.now() - utc(dateStr).getTime()) / 1000);
  if (diff < 60) return { label: `${diff}s`, level: 'ok' };
  if (diff < 3600) { const m = Math.floor(diff / 60); return { label: `${m}min`, level: m < 10 ? 'ok' : m < 30 ? 'warn' : 'danger' }; }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return { label: `${h}h`, level: 'danger' }; }
  return { label: `${Math.floor(diff / 86400)}d`, level: 'danger' };
}

const WAIT_COLORS = { ok: 'var(--success)', warn: 'var(--warn)', danger: 'var(--danger)' };
const WAIT_BGS    = { ok: 'var(--success-l)', warn: 'var(--warn-l)', danger: 'var(--danger-l)' };

const PRIORITY_LABEL = { urgent: '🔴 Urgente', normal: '🟡 Normal', low: '🔵 Baixa' };

export default function ConversationList({ socket, selected, onSelect }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('open');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const searchTimer = useRef(null);

  // Filtros avançados
  const [showFilters, setShowFilters] = useState(false);
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAttendant, setFilterAttendant] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [tags, setTags] = useState([]);
  const [attendants, setAttendants] = useState([]);

  // Atribuição manual
  const [assignPickerId, setAssignPickerId] = useState(null); // id da conversa com picker aberto
  const [assigning, setAssigning] = useState(false);

  // Bulk selection mode
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set()); // ids selecionados em modo bulk
  const [bulkAction, setBulkAction] = useState(null);  // 'transfer' | 'tag' | 'department' | 'delete' | null
  const [bulkActionValue, setBulkActionValue] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [departments2, setDepartments2] = useState([]); // depts para o picker de bulk (só owner)

  // Departamentos a que o user pertence (só relevante para atendentes com >1 dept)
  const [myDepartments, setMyDepartments] = useState([]);
  const [filterDept, setFilterDept] = useState(''); // '' = todos

  // Linhas WhatsApp activas — chip strip aparece se houver >1
  const [lines, setLines] = useState([]);
  const [filterLine, setFilterLine] = useState('');

  useEffect(() => {
    api.get('/tags').then(({ data }) => setTags(Array.isArray(data) ? data : [])).catch(() => {});
    if (user.role === 'owner') {
      api.get('/users').then(({ data }) => setAttendants(Array.isArray(data) ? data.filter(u => u.role === 'attendant' && u.active) : [])).catch(() => {});
    }
    api.get('/departments').then(({ data }) => {
      const mine = Array.isArray(data) ? data.filter(d => d.is_mine) : [];
      setMyDepartments(mine);
    }).catch(() => {});
    api.get('/lines').then(({ data }) => setLines(Array.isArray(data) ? data : [])).catch(() => {});
    if (user.role === 'owner') {
      api.get('/departments').then(({ data }) => setDepartments2(Array.isArray(data) ? data : [])).catch(() => {});
    }
  }, []);

  useEffect(() => { load(); }, [filter, filterPriority, filterAttendant, filterTag, filterDept, filterLine]);

  useEffect(() => {
    if (!socket) return;

    function onNewMessage({ conversation }) {
      if (user.role === 'attendant' && conversation?.assigned_to !== user.id) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation?.id);
        if (idx >= 0) {
          const next = [...prev];
          const wasSelected = selected?.id === conversation?.id;
          next[idx] = { ...conversation, unread_count: wasSelected ? 0 : (next[idx].unread_count || 0) + 1 };
          return next;
        }
        return [{ ...conversation, unread_count: 1 }, ...prev];
      });
    }

    function onConversationUpdated(conversation) {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation.id);
        if (idx < 0) return prev;
        // Atendente: se a conversa foi reatribuída a outro, remover da lista
        if (user.role === 'attendant' && conversation.assigned_to !== user.id) {
          return prev.filter(c => c.id !== conversation.id);
        }
        const next = [...prev];
        next[idx] = { ...next[idx], ...conversation };
        return next;
      });
    }

    function onConversationDeleted({ id }) {
      setConversations(prev => prev.filter(c => c.id !== id));
    }

    function onConversationUnassigned({ id }) {
      setConversations(prev => prev.filter(c => c.id !== id));
    }

    function onConversationTaken({ conversation_id }) {
      setConversations(prev => prev.filter(c => c.id !== conversation_id));
    }

    function onContactUpdated(contact) {
      setConversations(prev => prev.map(c =>
        c.contact_id === contact.id ? { ...c, contact_name: contact.name } : c
      ));
    }

    function onConversationAssigned({ conversation }) {
      if (!conversation?.id) return;
      setConversations(prev => {
        const exists = prev.some(c => c.id === conversation.id);
        if (exists) return prev.map(c => c.id === conversation.id ? { ...c, ...conversation } : c);
        return [{ ...conversation, unread_count: 1 }, ...prev];
      });
    }

    socket.on('message:new', onNewMessage);
    socket.on('message:incoming', onNewMessage);
    socket.on('conversation:updated', onConversationUpdated);
    socket.on('conversation:deleted', onConversationDeleted);
    socket.on('conversation:unassigned', onConversationUnassigned);
    socket.on('conversation:taken', onConversationTaken);
    socket.on('contact:updated', onContactUpdated);
    socket.on('conversation:assigned', onConversationAssigned);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:incoming', onNewMessage);
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('conversation:deleted', onConversationDeleted);
      socket.off('conversation:unassigned', onConversationUnassigned);
      socket.off('conversation:taken', onConversationTaken);
      socket.off('contact:updated', onContactUpdated);
      socket.off('conversation:assigned', onConversationAssigned);
    };
  }, [socket, selected]);

  useEffect(() => {
    if (!selected) return;
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, unread_count: 0 } : c));
  }, [selected?.id]);

  async function load() {
    const params = { status: filter || undefined };
    if (filterPriority) params.priority = filterPriority;
    if (filterAttendant) params.attendant_id = filterAttendant;
    if (filterTag) params.tag_id = filterTag;
    if (filterDept) params.department_id = filterDept;
    if (filterLine) params.line_id = filterLine;
    const { data } = await api.get('/conversations', { params });
    setConversations(Array.isArray(data) ? data : []);
  }

  function clearFilters() {
    setFilterPriority(''); setFilterAttendant(''); setFilterTag('');
  }

  function handleSearch(val) {
    setSearchQ(val);
    clearTimeout(searchTimer.current);
    if (!val.trim() || val.trim().length < 2) { setSearchResults(null); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/search', { params: { q: val.trim() } });
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (_) { setSearchResults([]); }
      setSearching(false);
    }, 350);
  }

  function clearSearch() { setSearchQ(''); setSearchResults(null); setSearching(false); }

  // ── Bulk actions ──
  function toggleSelectMode() {
    setSelectMode(v => { const next = !v; if (!next) setBulkSelected(new Set()); return next; });
    setAssignPickerId(null);
  }
  function toggleBulkSelected(id) {
    setBulkSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function selectAllVisible() {
    setBulkSelected(new Set(conversations.map(c => c.id)));
  }
  function openBulk(action) {
    if (bulkSelected.size === 0) return;
    setBulkAction(action);
    setBulkActionValue('');
  }
  async function executeBulk() {
    if (bulkBusy) return;
    setBulkBusy(true);
    const ids = Array.from(bulkSelected);
    try {
      let endpoint, body, method = 'post';
      switch (bulkAction) {
        case 'close':
          endpoint = '/conversations/bulk/close'; body = { ids };
          if (!confirm(`Fechar ${ids.length} conversa(s)?`)) { setBulkBusy(false); return; }
          break;
        case 'transfer':
          if (!bulkActionValue) { alert('Escolhe atendente'); setBulkBusy(false); return; }
          endpoint = '/conversations/bulk/transfer'; body = { ids, attendant_id: parseInt(bulkActionValue, 10) };
          break;
        case 'tag':
          if (!bulkActionValue) { alert('Escolhe etiqueta'); setBulkBusy(false); return; }
          endpoint = '/conversations/bulk/tag'; body = { ids, tag_id: parseInt(bulkActionValue, 10) };
          break;
        case 'department':
          endpoint = '/conversations/bulk/department'; body = { ids, department_id: bulkActionValue ? parseInt(bulkActionValue, 10) : null };
          break;
        case 'delete':
          if (!confirm(`⚠️ APAGAR DEFINITIVAMENTE ${ids.length} conversa(s) e todas as mensagens? Não pode ser revertido.`)) { setBulkBusy(false); return; }
          endpoint = '/conversations/bulk'; body = { ids }; method = 'delete';
          break;
      }
      const res = method === 'delete'
        ? await api.delete(endpoint, { data: body })
        : await api.post(endpoint, body);
      // Sucesso: limpar selecção e refrescar
      setBulkSelected(new Set());
      setSelectMode(false);
      setBulkAction(null);
      setBulkActionValue('');
      load();
      const denied = res.data?.denied?.length || 0;
      const did = res.data?.updated ?? res.data?.deleted ?? ids.length;
      if (denied > 0) alert(`${did} aplicadas. ${denied} negadas (sem permissão).`);
    } catch (err) {
      alert(err.response?.data?.error || 'Erro na operação em massa');
    }
    setBulkBusy(false);
  }

  async function assignConversation(convId, attendantId) {
    setAssigning(true);
    try {
      await api.patch(`/conversations/${convId}/assign`, { attendant_id: parseInt(attendantId) });
      setAssignPickerId(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao atribuir');
    }
    setAssigning(false);
  }

  const FILTERS = [['open','Abertas'],['waiting','Aguarda'],['closed','Fechadas'],['snoozed','💤 Snooze'],['','Todas']];
  const activeFilterCount = [filterPriority, filterAttendant, filterTag].filter(Boolean).length;

  const isSearching = searchResults !== null;

  return (
    <div style={S.wrap}>
      {/* Search bar */}
      <div style={S.searchBar}>
        <span style={S.searchIcon}>🔍</span>
        <input
          style={S.searchInput}
          placeholder="Pesquisar conversas e mensagens..."
          value={searchQ}
          onChange={e => handleSearch(e.target.value)}
        />
        {searchQ && <button onClick={clearSearch} style={S.searchClear}>✕</button>}
      </div>

      {showNewModal && (
        <NewConversationModal
          onClose={() => setShowNewModal(false)}
          onCreated={conv => { setShowNewModal(false); onSelect(conv); load(); }}
        />
      )}

      {!isSearching && (
        <>
          <div style={S.header}>
            <span style={S.headerTitle}>Conversas</span>
            <span style={S.count}>{conversations.length}</span>
            <button
              onClick={() => setShowFilters(v => !v)}
              style={{ ...S.newBtn, background: activeFilterCount > 0 ? 'var(--accent)' : 'var(--border)', color: activeFilterCount > 0 ? '#fff' : 'var(--muted)', marginLeft: 0, fontSize: '0.75rem', width: 'auto', padding: '0 8px', gap: '3px', display: 'flex', alignItems: 'center' }}
              title="Filtros avançados"
            >
              ⚙️{activeFilterCount > 0 && <span style={{ background: '#fff', color: 'var(--accent)', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 700, minWidth: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{activeFilterCount}</span>}
            </button>
            <button
              onClick={toggleSelectMode}
              style={{ ...S.newBtn, background: selectMode ? 'var(--accent)' : 'var(--border)', color: selectMode ? '#fff' : 'var(--muted)', width: 'auto', padding: '0 8px', fontSize: '0.75rem' }}
              title={selectMode ? 'Sair do modo selecção' : 'Selecionar várias'}
            >
              {selectMode ? '✕' : '☑️'}
            </button>
            <button onClick={() => setShowNewModal(true)} style={S.newBtn} title="Nova conversa">✏️</button>
          </div>

          {/* Barra de acções bulk */}
          {selectMode && (
            <div style={{ padding: '0.5rem 1rem', background: 'var(--accent-l)', borderBottom: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
              <strong style={{ color: 'var(--accent)' }}>{bulkSelected.size} selecionada(s)</strong>
              {bulkSelected.size === 0 && conversations.length > 0 && (
                <button style={{ ...S.filterBtn, fontSize: '0.7rem' }} onClick={selectAllVisible}>Selecionar todas ({conversations.length})</button>
              )}
              {bulkSelected.size > 0 && (
                <>
                  <button style={{ ...S.filterBtn, fontSize: '0.72rem' }} onClick={() => openBulk('close')}>✓ Fechar</button>
                  {user.role === 'owner' && (
                    <button style={{ ...S.filterBtn, fontSize: '0.72rem' }} onClick={() => openBulk('transfer')}>🔄 Transferir</button>
                  )}
                  <button style={{ ...S.filterBtn, fontSize: '0.72rem' }} onClick={() => openBulk('tag')}>🏷️ Etiqueta</button>
                  {user.role === 'owner' && (
                    <button style={{ ...S.filterBtn, fontSize: '0.72rem' }} onClick={() => openBulk('department')}>🏢 Dept</button>
                  )}
                  {user.role === 'owner' && (
                    <button style={{ ...S.filterBtn, fontSize: '0.72rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => openBulk('delete')}>🗑️ Apagar</button>
                  )}
                  <button style={{ ...S.filterBtn, fontSize: '0.7rem', color: 'var(--hint)' }} onClick={() => setBulkSelected(new Set())}>Limpar</button>
                </>
              )}
            </div>
          )}

          {/* Painel de filtros avançados */}
          {showFilters && (
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Prioridade */}
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={S.filterSelect}>
                  <option value="">Prioridade</option>
                  <option value="urgent">🔴 Urgente</option>
                  <option value="normal">🟡 Normal</option>
                  <option value="low">🔵 Baixa</option>
                </select>

                {/* Atendente (owner only) */}
                {user.role === 'owner' && (
                  <select value={filterAttendant} onChange={e => setFilterAttendant(e.target.value)} style={S.filterSelect}>
                    <option value="">Atendente</option>
                    {attendants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}

                {/* Etiqueta */}
                {tags.length > 0 && (
                  <select value={filterTag} onChange={e => setFilterTag(e.target.value)} style={S.filterSelect}>
                    <option value="">Etiqueta</option>
                    {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}

                {activeFilterCount > 0 && (
                  <button onClick={clearFilters} style={{ ...S.filterBtn, color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: '0.72rem' }}>
                    ✕ Limpar
                  </button>
                )}
              </div>

              {/* Chips de filtros activos */}
              {activeFilterCount > 0 && (
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {filterPriority && (
                    <span style={S.chip} onClick={() => setFilterPriority('')}>
                      {PRIORITY_LABEL[filterPriority]} ✕
                    </span>
                  )}
                  {filterAttendant && (
                    <span style={S.chip} onClick={() => setFilterAttendant('')}>
                      👤 {attendants.find(a => String(a.id) === String(filterAttendant))?.name || '?'} ✕
                    </span>
                  )}
                  {filterTag && (
                    <span style={{ ...S.chip, background: (tags.find(t => String(t.id) === String(filterTag))?.color || 'var(--accent)') + '22', color: tags.find(t => String(t.id) === String(filterTag))?.color || 'var(--accent)', borderColor: (tags.find(t => String(t.id) === String(filterTag))?.color || 'var(--accent)') + '55' }}
                      onClick={() => setFilterTag('')}>
                      🏷️ {tags.find(t => String(t.id) === String(filterTag))?.name || '?'} ✕
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chip strip de linhas WhatsApp — só se houver ≥2 linhas activas */}
          {lines.length >= 2 && (
            <div style={{ display: 'flex', gap: '0.3rem', padding: '0.4rem 1rem 0.2rem', flexWrap: 'wrap', borderTop: '1px dashed var(--border)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--hint)', fontWeight: 700, padding: '0.3rem 0' }}>📱</span>
              <button
                style={{ ...S.filterBtn, ...(filterLine === '' ? S.filterActive : {}) }}
                onClick={() => setFilterLine('')}>
                Todas
              </button>
              {lines.map(l => (
                <button key={l.id}
                  style={{
                    ...S.filterBtn,
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    ...(String(filterLine) === String(l.id) ? { background: l.color, color: '#fff', border: `1px solid ${l.color}` } : { borderColor: l.color + '55', color: l.color }),
                  }}
                  onClick={() => setFilterLine(String(filterLine) === String(l.id) ? '' : l.id)}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: String(filterLine) === String(l.id) ? '#fff' : l.color }} />
                  {l.name}
                </button>
              ))}
            </div>
          )}

          {/* Chip strip de departamentos — só atendentes em ≥2 depts */}
          {myDepartments.length >= 2 && (
            <div style={{ display: 'flex', gap: '0.3rem', padding: '0.4rem 1rem 0.2rem', flexWrap: 'wrap' }}>
              <button
                style={{ ...S.filterBtn, ...(filterDept === '' ? S.filterActive : {}), display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => setFilterDept('')}>
                Todos
              </button>
              {myDepartments.map(d => (
                <button key={d.id}
                  style={{
                    ...S.filterBtn,
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    ...(String(filterDept) === String(d.id) ? { background: d.color, color: '#fff', border: `1px solid ${d.color}` } : { borderColor: d.color + '55', color: d.color }),
                  }}
                  onClick={() => setFilterDept(String(filterDept) === String(d.id) ? '' : d.id)}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: String(filterDept) === String(d.id) ? '#fff' : d.color }} />
                  {d.name}
                </button>
              ))}
            </div>
          )}

          <div style={S.filters}>
            {FILTERS.map(([val, label]) => (
              <button key={val} style={{ ...S.filterBtn, ...(filter === val ? S.filterActive : {}) }}
                onClick={() => setFilter(val)}>{label}</button>
            ))}
          </div>
        </>
      )}

      <div style={S.list}>
        {/* SEARCH RESULTS */}
        {isSearching && (
          <>
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>
              {searching ? 'A pesquisar...' : `${searchResults.length} resultado(s)`}
            </div>
            {searchResults.map((r, i) => {
              const initial = (r.contact_name || r.phone || '?')[0].toUpperCase();
              const fakeConv = { id: r.conversation_id, contact_name: r.contact_name, phone: r.phone, status: r.status, attendant_name: r.attendant_name, updated_at: r.updated_at };
              return (
                <div key={`${r.match_type}-${r.conversation_id}-${i}`} style={S.item} onClick={() => { onSelect(fakeConv); clearSearch(); }}>
                  <div style={{ ...S.avatar, background: 'var(--accent-l)', color: 'var(--accent)' }}>{initial}</div>
                  <div style={S.info}>
                    <div style={S.row}>
                      <span style={{ ...S.name, fontWeight: 600 }}>{r.contact_name || r.phone}</span>
                      <span style={{ ...S.badge, background: STATUS_BG[r.status], color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    {r.match_type === 'message' && r.message_body && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        💬 {r.message_body}
                      </span>
                    )}
                    <span style={S.phone}>{r.phone}</span>
                  </div>
                </div>
              );
            })}
            {!searching && searchResults.length === 0 && <p style={S.empty}>Sem resultados</p>}
          </>
        )}

        {/* NORMAL LIST */}
        {!isSearching && (
          <>
            {conversations.length === 0 && <p style={S.empty}>Nenhuma conversa</p>}
            {conversations.map(conv => {
              const isOpen = selected?.id === conv.id;  // currently shown in ChatWindow
              const isChecked = selectMode && bulkSelected.has(conv.id);
              const initial = (conv.contact_name || conv.phone || '?')[0].toUpperCase();
              const unread = conv.unread_count || 0;
              const wait = (conv.status !== 'closed') ? formatWait(conv.last_client_at) : null;
              const priorityColor = conv.priority === 'urgent' ? '#ef4444' : conv.priority === 'low' ? '#3b82f6' : null;
              const itemClickHandler = () => {
                if (selectMode) { toggleBulkSelected(conv.id); return; }
                setAssignPickerId(null);
                onSelect(conv);
              };
              return (
                <div key={conv.id}
                  style={{ ...S.item, ...(isOpen && !selectMode ? S.itemActive : {}), ...(isChecked ? { background: 'var(--accent-l)' } : {}), ...(priorityColor ? { boxShadow: `inset 3px 0 0 ${priorityColor}` } : {}) }}
                  onClick={itemClickHandler}>
                  {selectMode && (
                    <input type="checkbox" checked={!!isChecked} onChange={() => toggleBulkSelected(conv.id)} onClick={e => e.stopPropagation()} style={{ marginRight: '0.25rem', cursor: 'pointer', flexShrink: 0 }} />
                  )}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{ ...S.avatar, background: isOpen ? 'var(--accent)' : 'var(--accent-l)', color: isOpen ? '#fff' : 'var(--accent)' }}>
                      {initial}
                    </div>
                    {unread > 0 && !isOpen && (
                      <span style={S.unreadBadge}>{unread > 99 ? '99+' : unread}</span>
                    )}
                  </div>
                  <div style={S.info}>
                    <div style={S.row}>
                      <span style={{ ...S.name, fontWeight: unread > 0 && !isOpen ? 700 : 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        {conv.department_color && (
                          <span title={conv.department_name || ''} style={{ width: 8, height: 8, borderRadius: '50%', background: conv.department_color, flexShrink: 0 }} />
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.contact_name || conv.phone}</span>
                      </span>
                      <span style={{ ...S.badge, background: STATUS_BG[conv.status], color: STATUS_COLOR[conv.status] }}>
                        {STATUS_LABEL[conv.status]}
                      </span>
                    </div>
                    {user.role === 'owner' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={S.sub}>{conv.attendant_name || 'Sem atendente'}</span>
                        {conv.status === 'waiting' && (
                          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                            <button
                              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, padding: '1px 5px', cursor: 'pointer', lineHeight: '1.4' }}
                              title="Atribuir a atendente"
                              onClick={e => { e.stopPropagation(); setAssignPickerId(assignPickerId === conv.id ? null : conv.id); }}
                            >
                              👤 Atribuir
                            </button>
                            {assignPickerId === conv.id && (
                              <div style={{ position: 'absolute', left: 0, top: '110%', zIndex: 200, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', minWidth: '160px', padding: '0.3rem' }}>
                                {attendants.length === 0 && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--hint)', padding: '0.3rem 0.5rem' }}>Sem atendentes activos</p>}
                                {attendants.map(a => (
                                  <div key={a.id}
                                    onClick={() => assignConversation(conv.id, a.id)}
                                    style={{ padding: '0.35rem 0.6rem', cursor: assigning ? 'wait' : 'pointer', fontSize: '0.8rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                  >
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.status === 'online' ? 'var(--success)' : a.status === 'busy' ? 'var(--warn)' : 'var(--hint)', flexShrink: 0 }} />
                                    {a.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
                      <span style={S.phone}>{conv.phone}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {conv.sla_alerted_at && conv.status !== 'closed' && (!conv.snoozed_until || utc(conv.snoozed_until) <= new Date()) && (
                          <span title="SLA excedido — resposta atrasada" style={{ fontSize: '0.68rem', fontWeight: 700, background: 'var(--danger-l)', color: 'var(--danger)', borderRadius: '4px', padding: '0 4px' }}>
                            ⏰ SLA
                          </span>
                        )}
                        {conv.snoozed_until && utc(conv.snoozed_until) > new Date() ? (
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, background: '#e0e7ff', color: '#4338ca', borderRadius: '4px', padding: '0 4px' }}>
                            💤 {utc(conv.snoozed_until).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : wait ? (
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, background: WAIT_BGS[wait.level], color: WAIT_COLORS[wait.level], borderRadius: '4px', padding: '0 4px' }}>
                            ⏱ {wait.label}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Modal de bulk action que precisa de valor (transfer/tag/department) ou confirmação (close/delete já lidados via confirm() em executeBulk) */}
      {bulkAction && (bulkAction === 'transfer' || bulkAction === 'tag' || bulkAction === 'department') && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setBulkAction(null); setBulkActionValue(''); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', padding: '1.25rem', borderRadius: 'var(--r-md)', minWidth: '280px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
              {bulkAction === 'transfer' && `🔄 Transferir ${bulkSelected.size} conversa(s) para...`}
              {bulkAction === 'tag' && `🏷️ Aplicar etiqueta a ${bulkSelected.size} conversa(s)`}
              {bulkAction === 'department' && `🏢 Mudar departamento de ${bulkSelected.size} conversa(s)`}
            </h3>
            {bulkAction === 'transfer' && (
              <select value={bulkActionValue} onChange={e => setBulkActionValue(e.target.value)}
                style={{ width: '100%', padding: '0.45rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.88rem', marginBottom: '1rem', background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">— Escolher atendente —</option>
                {attendants.map(a => <option key={a.id} value={a.id}>{a.name} ({a.status || 'offline'})</option>)}
              </select>
            )}
            {bulkAction === 'tag' && (
              <select value={bulkActionValue} onChange={e => setBulkActionValue(e.target.value)}
                style={{ width: '100%', padding: '0.45rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.88rem', marginBottom: '1rem', background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">— Escolher etiqueta —</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {bulkAction === 'department' && (
              <select value={bulkActionValue} onChange={e => setBulkActionValue(e.target.value)}
                style={{ width: '100%', padding: '0.45rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.88rem', marginBottom: '1rem', background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">— Sem departamento (limpar) —</option>
                {departments2.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setBulkAction(null); setBulkActionValue(''); }}
                style={{ padding: '0.4rem 0.9rem', border: '1px solid var(--border-m)', background: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem' }}>
                Cancelar
              </button>
              <button onClick={executeBulk} disabled={bulkBusy || (bulkAction !== 'department' && !bulkActionValue)}
                style={{ padding: '0.4rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                {bulkBusy ? '...' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close e Delete usam confirm() nativo dentro de executeBulk — sem modal */}
      {bulkAction && (bulkAction === 'close' || bulkAction === 'delete') && (
        <ExecuteOnMount onMount={executeBulk} />
      )}
    </div>
  );
}

// Helper para disparar executeBulk imediatamente quando close/delete são escolhidos
// (sem modal — só confirmação nativa). É um componente vazio que dispara um efeito.
function ExecuteOnMount({ onMount }) {
  useEffect(() => { onMount(); }, []);
  return null;
}

const S = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--card)', borderRight: '1px solid var(--border)' },
  searchBar: { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg)' },
  searchIcon: { fontSize: '0.85rem', color: 'var(--hint)', flexShrink: 0 },
  searchInput: { flex: 1, border: 'none', background: 'none', outline: 'none', fontSize: '0.83rem', color: 'var(--text)', minWidth: 0 },
  searchClear: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--hint)', fontSize: '0.85rem', padding: 0, flexShrink: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem 0.25rem', gap: '0.5rem' },
  headerTitle: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' },
  count: { background: 'var(--accent-l)', color: 'var(--accent)', borderRadius: '20px', padding: '1px 8px', fontSize: '0.75rem', fontWeight: 600 },
  newBtn: { marginLeft: 'auto', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', width: 28, height: 28, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  filters: { display: 'flex', gap: '0.25rem', padding: '0.4rem 1rem 0.6rem', flexWrap: 'wrap' },
  filterBtn: { padding: '0.25rem 0.65rem', borderRadius: '20px', border: '1px solid var(--border-m)', background: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 },
  filterActive: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  list: { flex: 1, overflowY: 'auto' },
  empty: { textAlign: 'center', color: 'var(--hint)', padding: '2rem', fontSize: '0.85rem' },
  item: { display: 'flex', gap: '0.75rem', padding: '0.65rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', alignItems: 'center', transition: 'background .1s' },
  itemActive: { background: 'var(--accent-l)' },
  avatar: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.88rem', transition: 'all .1s' },
  unreadBadge: { position: 'absolute', top: -4, right: -4, background: 'var(--danger)', color: '#fff', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 700, padding: '0 4px', minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  info: { flex: 1, minWidth: 0 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' },
  name: { fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' },
  badge: { borderRadius: '20px', padding: '1px 7px', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 },
  sub: { display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginTop: '1px' },
  phone: { display: 'block', fontSize: '0.72rem', color: 'var(--hint)' },
  filterSelect: { padding: '0.25rem 0.5rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.78rem', background: 'var(--card)', color: 'var(--text)', outline: 'none', cursor: 'pointer' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '1px 7px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: 'var(--accent-l)', color: 'var(--accent)', border: '1px solid var(--accent)33', cursor: 'pointer', userSelect: 'none' },
};
