import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import ContactHistory from './ContactHistory';
import ContactAvatar from './ContactAvatar';

const API = import.meta.env.VITE_API_URL || '';

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '✅'];

function parseReactions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

// SQLite guarda UTC sem 'Z' — forçar interpretação correta
function utc(str) {
  if (!str) return new Date(str);
  // Já tem indicador de fuso (Z ou +HH:MM)
  if (/[Z+]/.test(str.slice(-6))) return new Date(str);
  // Formato ISO com T → adicionar Z
  if (str.includes('T')) return new Date(str + 'Z');
  // Formato SQLite "YYYY-MM-DD HH:MM:SS" → converter para ISO UTC
  return new Date(str.replace(' ', 'T') + 'Z');
}

function parseVcard(vcf) {
  const fn = vcf.match(/FN[^:]*:(.+)/)?.[1]?.trim() || 'Contacto';
  const tel = vcf.match(/TEL[^:]*:(.+)/)?.[1]?.trim() || '';
  return { fn, tel };
}

// Remove Zalgo text (combining Unicode marks em excesso)
function sanitizeZalgo(text) {
  if (!text) return text;
  return text.replace(/(\p{M}{3,})/gu, m => m.slice(0, 2));
}

// Variáveis suportadas em templates de respostas rápidas. Listadas explicitamente
// para podermos documentá-las na UI de admin e validar de forma central.
export const TEMPLATE_VARS = [
  ['{{nome}}',                  'Nome completo do contacto'],
  ['{{primeiro_nome}}',         'Primeira palavra do nome do contacto'],
  ['{{telefone}}',              'Número de telefone do contacto'],
  ['{{atendente}}',             'Nome do atendente atual'],
  ['{{primeiro_nome_atendente}}','Primeira palavra do nome do atendente'],
  ['{{saudacao}}',              'Bom dia / Boa tarde / Boa noite'],
  ['{{empresa}}',               'Nome do tenant (VITE_TENANT_NAME)'],
];

// Em notas internas, realça @palavras (provavelmente menções a atendentes).
// Não tentamos validar contra a lista de utilizadores aqui — qualquer @X é
// realçado, o que cobre menções com nomes pouco usuais sem chamadas extra.
function renderBodyWithMentions(body) {
  if (!body) return body;
  const parts = body.split(/(@\S+)/g);
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <strong key={i} style={{ color: '#b45309', background: '#fef3c7', padding: '0 4px', borderRadius: '4px', fontWeight: 700 }}>{part}</strong>
      : part
  );
}

function renderTemplate(body, conversation, user) {
  if (!body || !body.includes('{{')) return body;
  const contact = conversation?.contact_name || conversation?.phone || '';
  const phone = conversation?.phone || '';
  const att = user?.name || '';
  const empresa = import.meta.env.VITE_TENANT_NAME || '';
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite';
  const firstWord = s => (s || '').trim().split(/\s+/)[0] || '';
  return body
    .replace(/\{\{nome\}\}/gi, contact)
    .replace(/\{\{primeiro_nome\}\}/gi, firstWord(contact))
    .replace(/\{\{telefone\}\}/gi, phone)
    .replace(/\{\{atendente\}\}/gi, att)
    .replace(/\{\{primeiro_nome_atendente\}\}/gi, firstWord(att))
    .replace(/\{\{saudacao\}\}/gi, saudacao)
    .replace(/\{\{empresa\}\}/gi, empresa);
}

function MessageContent({ msg, onMediaLoad }) {
  if (msg.media_type === 'vcard') {
    const { fn, tel } = parseVcard(msg.body || '');
    return (
      <div style={{ background: 'rgba(0,0,0,0.05)', borderRadius: '8px', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.5rem' }}>👤</span>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{fn}</p>
          {tel && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{tel}</p>}
        </div>
      </div>
    );
  }
  if (msg.media_url && msg.media_type?.startsWith('image/')) {
    return (
      <>
        <img src={`${API}${msg.media_url}`} alt="imagem"
          style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', display: 'block', cursor: 'pointer', marginBottom: msg.body ? '0.25rem' : 0 }}
          onLoad={onMediaLoad}
          onClick={() => window.open(`${API}${msg.media_url}`, '_blank')} />
        {msg.body && <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{msg.body}</p>}
      </>
    );
  }
  if (msg.deleted) {
    return <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--hint)', fontStyle: 'italic' }}>🚫 Mensagem apagada</p>;
  }
  // Sentinelas exactos que o backend guarda para mensagens de visualização única.
  // NUNCA usar .includes() pois apanharia mensagens normais com essas palavras.
  const VIEW_ONCE_SENTINELS = new Set([
    '🔒 Mensagem de visualização única',
    '📷 Imagem de visualização única',
    '🎥 Vídeo de visualização única',
    '🎤 Áudio de visualização única',
    '🪄 Sticker de visualização única',
    '📎 Ficheiro de visualização única',
  ]);
  const isViewOnce = !msg.media_url && msg.body && VIEW_ONCE_SENTINELS.has(msg.body);
  if (isViewOnce) {
    return (
      <div title="Mensagens de visualização única só podem ser abertas pelo destinatário no telemóvel. O conteúdo não está disponível aqui."
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'help' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--hint)', fontStyle: 'italic' }}>{msg.body}</p>
        <span style={{ fontSize: '0.75rem', background: 'var(--border)', color: 'var(--muted)', borderRadius: '999px', padding: '0.05rem 0.45rem', fontWeight: 600, flexShrink: 0 }}>?</span>
      </div>
    );
  }
  if (msg.media_url && msg.media_type?.startsWith('audio/')) {
    return (
      <>
        <audio controls src={`${API}${msg.media_url}`} style={{ maxWidth: '280px' }} />
        {msg.body && (
          <p title="Transcrição automática" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--muted)', borderLeft: '2px solid var(--border-m)', paddingLeft: '0.5rem', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
            🎤 {msg.body}
          </p>
        )}
      </>
    );
  }
  if (msg.media_url && msg.media_type?.startsWith('video/')) {
    return (
      <>
        <video controls src={`${API}${msg.media_url}`} style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', display: 'block' }} onLoadedMetadata={onMediaLoad} />
        {msg.body && <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{msg.body}</p>}
      </>
    );
  }
  if (msg.media_url) {
    const fname = msg.media_filename || msg.media_url.split('/').pop();
    return (
      <a href={`${API}${msg.media_url}`} target="_blank" rel="noreferrer" download={fname}
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>
        📎 {fname}
      </a>
    );
  }
  return <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
    {msg.is_internal ? renderBodyWithMentions(msg.body) : msg.body}
  </p>;
}

export default function ChatWindow({ conversation: convProp, socket, onClose, onDelete, onConversationChange }) {
  const { user } = useAuth();
  const [conversation, setConversation] = useState(convProp);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState('');
  const [typers, setTypers] = useState({});
  const [clientPresence, setClientPresence] = useState(null); // 'composing' | 'recording' | null
  const clientPresenceTimer = useRef(null);
  const [quickReplies, setQuickReplies] = useState([]);
  const [qrSuggestions, setQrSuggestions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showContact360, setShowContact360] = useState(false);
  const [history, setHistory] = useState([]);
  const [isInternal, setIsInternal] = useState(false);
  const [allTags, setAllTags] = useState([]);
  const [convTags, setConvTags] = useState([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleBody, setScheduleBody] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);    // file waiting for caption
  const [pendingCaption, setPendingCaption] = useState('');
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  // Reply to message
  const [replyTo, setReplyTo] = useState(null); // { id, body, from_me, sender_name }
  // Edit message
  const [editingMsg, setEditingMsg] = useState(null); // { id, body }
  const [editBody, setEditBody] = useState('');
  // Edit contact
  const [showContactEdit, setShowContactEdit] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', notes: '' });
  const [contactSaving, setContactSaving] = useState(false);
  // Priority
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  // Snooze
  const [showSnooze, setShowSnooze] = useState(false);
  // Transfer
  const [showTransfer, setShowTransfer] = useState(false);
  const [availableAttendants, setAvailableAttendants] = useState([]);
  const [transferToId, setTransferToId] = useState('');
  const [transferring, setTransferring] = useState(false);
  // Export
  const [showExport, setShowExport] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  // @mention autocomplete
  const [teamUsers, setTeamUsers] = useState([]);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const fileInputRef = useRef(null);
  const typingTimer = useRef(null);
  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  // Rastreia IDs já adicionados ao estado — evita duplicatas por re-render de effect ou eventos duplos
  const seenMsgIds = useRef(new Set());

  // Audio recording
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioFile, setAudioFile] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  // Sync conversation prop → state (close/reopen updates it); reset panels on conversation change
  useEffect(() => {
    setConversation(convProp);
    seenMsgIds.current = new Set(); // limpar ao trocar conversa
    setShowHistory(false);
    setShowTagPicker(false);
    setShowSchedule(false);
    setShowSnooze(false);
    setShowPriorityPicker(false);
    setShowTransfer(false);
  }, [convProp?.id]);

  useEffect(() => {
    api.get('/quick-replies').then(r => setQuickReplies(Array.isArray(r.data) ? r.data : []));
    api.get('/tags').then(r => setAllTags(Array.isArray(r.data) ? r.data : []));
    api.get('/users/team').then(r => setTeamUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversation) return;
    api.get(`/conversations/${conversation.id}/messages`).then(r => setMessages(Array.isArray(r.data) ? r.data : []));
    api.get(`/tags/conversations/${conversation.id}`).then(r => setConvTags(Array.isArray(r.data) ? r.data : []));
    socket?.emit('conv:join', { conversation_id: conversation.id });
    setIsInternal(false);
    setShowTagPicker(false);
    setWarning('');
    return () => socket?.emit('conv:leave', { conversation_id: conversation.id });
  }, [conversation?.id]);

  useEffect(() => {
    if (!socket || !conversation) return;
    function onMessage({ message, conversation: conv }) {
      const convId = conv?.id ?? message?.conversation_id;
      if (convId !== conversation?.id) return;
      // Dedup via ref — a aba que enviou regista o ID real no callback de envio,
      // por isso ignora o evento aqui. Outras abas não têm o ID e mostram a mensagem.
      if (seenMsgIds.current.has(message.id)) return;
      seenMsgIds.current.add(message.id);
      setMessages(prev => [...prev, message]);
    }
    function onTyping({ userId, name, typing, conversation_id }) {
      if (conversation_id !== conversation.id) return;
      setTypers(prev => { const next = { ...prev }; if (typing) next[userId] = name; else delete next[userId]; return next; });
    }
    function onEdited(msg) {
      if (msg.conversation_id !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
    }
    function onUpdated({ message: msg }) {
      // Usado por transcrição de áudio: backend actualiza body e dispara este evento
      if (!msg || msg.conversation_id !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m));
    }
    function onFailed({ message: msg }) {
      if (msg.conversation_id !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, failed: msg.failed } : m));
    }
    function onDeleted({ id, conversation_id }) {
      if (conversation_id !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === id ? { ...m, deleted: 1 } : m));
    }
    function onStatus({ id, conversation_id, wa_status }) {
      if (conversation_id !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === id ? { ...m, wa_status } : m));
    }
    function onReactions({ id, conversation_id, reactions }) {
      if (conversation_id !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === id ? { ...m, reactions: JSON.stringify(reactions) } : m));
    }
    function onPresence({ conversation_id, status }) {
      if (conversation_id !== conversation.id) return;
      if (clientPresenceTimer.current) clearTimeout(clientPresenceTimer.current);
      if (status === 'composing' || status === 'recording') {
        setClientPresence(status);
        // Auto-clear se Baileys não enviar update de "parou" em ~8s
        clientPresenceTimer.current = setTimeout(() => setClientPresence(null), 8000);
      } else {
        setClientPresence(null);
      }
    }
    function onTagsUpdated({ conversation_id, tags }) {
      if (Number(conversation_id) !== conversation.id) return;
      setConvTags(tags);
    }
    function onConversationUpdated(conv) {
      if (!conv?.id || conv.id !== conversation?.id) return;
      setConversation(prev => ({ ...prev, ...conv }));
    }
    function onContactUpdated(contact) {
      if (!conversation?.contact_id || contact.id !== conversation.contact_id) return;
      setConversation(prev => ({ ...prev, contact_name: contact.name, contact_email: contact.email, contact_notes: contact.notes }));
    }
    socket.on('message:new', onMessage);
    socket.on('typing:update', onTyping);
    socket.on('message:edited', onEdited);
    socket.on('message:updated', onUpdated);
    socket.on('message:failed', onFailed);
    socket.on('message:deleted', onDeleted);
    socket.on('message:status', onStatus);
    socket.on('message:reactions', onReactions);
    socket.on('whatsapp:presence', onPresence);
    socket.on('conversation:tags_updated', onTagsUpdated);
    socket.on('conversation:updated', onConversationUpdated);
    socket.on('contact:updated', onContactUpdated);
    return () => {
      socket.off('message:new', onMessage);
      socket.off('typing:update', onTyping);
      socket.off('message:edited', onEdited);
      socket.off('message:updated', onUpdated);
      socket.off('message:failed', onFailed);
      socket.off('message:deleted', onDeleted);
      socket.off('message:status', onStatus);
      socket.off('message:reactions', onReactions);
      socket.off('whatsapp:presence', onPresence);
      if (clientPresenceTimer.current) clearTimeout(clientPresenceTimer.current);
      socket.off('conversation:tags_updated', onTagsUpdated);
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('contact:updated', onContactUpdated);
    };
  }, [socket, conversation]);

  function scrollToBottom() {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }

  useLayoutEffect(() => { scrollToBottom(); }, [messages]);

  async function loadHistory() {
    if (!conversation) return;
    const r = await api.get(`/conversations/contact/${conversation.phone}`);
    setHistory(Array.isArray(r.data) ? r.data.filter(c => c.id !== conversation.id) : []);
    setShowHistory(true);
  }

  async function mergeConversation() {
    const targetId = parseInt(mergeTargetId.trim());
    if (!targetId) return alert('Introduz o ID da conversa de destino');
    if (!confirm(`Fundir esta conversa (ID ${conversation.id}) na conversa ID ${targetId}?\nTodas as mensagens serão movidas e esta conversa eliminada.`)) return;
    try {
      await api.post(`/conversations/${conversation.id}/merge`, { into_id: targetId });
      setShowMerge(false);
      setMergeTargetId('');
      onClose?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao fundir conversas');
    }
  }

  async function saveEdit() {
    if (!editBody.trim() || !editingMsg) return;
    try {
      const { data } = await api.patch(`/messages/${editingMsg.id}`, { body: editBody.trim() });
      setMessages(prev => prev.map(m => m.id === data.id ? data : m));
      setEditingMsg(null);
      setEditBody('');
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao editar mensagem');
    }
  }

  function openContactEdit() {
    setContactForm({
      name: conversation.contact_name || '',
      email: conversation.contact_email || '',
      notes: conversation.contact_notes || '',
    });
    setShowContactEdit(true);
  }

  async function saveContact() {
    setContactSaving(true);
    try {
      await api.patch(`/contacts/${conversation.contact_id}`, contactForm);
      setConversation(prev => ({ ...prev, contact_name: contactForm.name, contact_email: contactForm.email, contact_notes: contactForm.notes }));
      setShowContactEdit(false);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Erro ao guardar contacto');
    } finally {
      setContactSaving(false);
    }
  }

  async function closeConversation() {
    if (!confirm('Fechar esta conversa?')) return;
    try {
      const { data } = await api.patch(`/conversations/${conversation.id}/close`);
      setConversation(data);
      onConversationChange?.(data);
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao fechar');
    }
  }

  async function reopenConversation() {
    try {
      const { data } = await api.patch(`/conversations/${conversation.id}/reopen`);
      setConversation(data);
      onConversationChange?.(data);
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao reabrir');
    }
  }

  async function send() {
    if (!text.trim() || sending) return;
    if (conversation?.status === 'closed') return;
    setSending(true);
    setWarning('');
    const body = sanitizeZalgo(text);
    setText('');

    if (isInternal) {
      try {
        await api.post(`/conversations/${conversation.id}/notes`, { body });
        // Não adicionar aqui — o socket event 'message:new' já adiciona via backend emit
      } catch (err) {
        setWarning(err.response?.data?.error || 'Erro ao guardar nota');
        setText(body);
      }
      setSending(false);
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const replyToId = replyTo?.id || null;
    const tempMsg = { id: tempId, conversation_id: conversation.id, from_me: 1, body, timestamp: new Date().toISOString(), sender_name: user.name, reply_to_id: replyToId, quoted_body: replyTo?.body, quoted_from_me: replyTo?.from_me, quoted_sender_name: replyTo?.sender_name };
    setMessages(prev => [...prev, tempMsg]);
    setReplyTo(null);

    socket.emit('message:send', { conversation_id: conversation.id, body, reply_to_id: replyToId }, (res) => {
      setSending(false);
      if (res?.message) {
        // Registar ID real — impede que message:new (que chega depois) duplique
        seenMsgIds.current.add(res.message.id);
        setMessages(prev => {
          // Se message:new já chegou antes do callback e adicionou a mensagem real,
          // apenas remover o tempId para não duplicar
          const alreadyAdded = prev.some(m => m.id === res.message.id);
          if (alreadyAdded) return prev.filter(m => m.id !== tempId);
          // Caso normal: substituir tempId pela mensagem real
          return prev.map(m => m.id === tempId ? { ...res.message, quoted_body: tempMsg.quoted_body, quoted_from_me: tempMsg.quoted_from_me, quoted_sender_name: tempMsg.quoted_sender_name } : m);
        });
      } else if (res?.error) {
        setWarning(res.error);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true } : m));
        setText(body);
      }
    });
  }

  function formatRecordSecs(s) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mr = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const af = new File([blob], `audio_${Date.now()}.${ext}`, { type: mimeType });
        setAudioFile(af);
        setRecording(false);
        clearInterval(recordTimerRef.current);
      };
      mr.start(200);
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (err) {
      alert('Sem permissão para usar o microfone: ' + err.message);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    setRecordSeconds(0);
    clearInterval(recordTimerRef.current);
    audioChunksRef.current = [];
    setAudioFile(null);
  }

  async function sendAudio() {
    if (!audioFile) return;
    const f = audioFile;
    setAudioFile(null);
    setRecordSeconds(0);
    await sendFile(f);
  }

  async function sendFile(file, caption = '') {
    if (!file) return;
    setUploadingFile(true);
    setWarning('');
    const tempId = `temp-media-${Date.now()}`;
    const tempBody = caption ? `📎 ${caption}` : `📎 ${file.name}`;
    setMessages(prev => [...prev, { id: tempId, from_me: 1, body: tempBody, conversation_id: conversation.id, timestamp: new Date().toISOString(), sender_name: user.name }]);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (caption) formData.append('caption', caption);
      const { data: message } = await api.post(`/conversations/${conversation.id}/send-media`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Registar ID real — se o socket já adicionou a mensagem, apenas remove o temp
      seenMsgIds.current.add(message.id);
      setMessages(prev => {
        const alreadyAdded = prev.some(m => m.id === message.id);
        if (alreadyAdded) return prev.filter(m => m.id !== tempId);
        return prev.map(m => m.id === tempId ? message : m);
      });
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      if (err.response?.status === 413) {
        setWarning('Ficheiro demasiado grande. O limite máximo é 50 MB.');
      } else {
        setWarning(err.response?.data?.error || err.message || 'Erro ao enviar ficheiro');
      }
    }
    setUploadingFile(false);
  }

  function handleTyping(e) {
    const val = e.target.value;
    setText(val);

    // Quick replies trigger
    if (val.startsWith('/')) {
      const q = val.slice(1).toLowerCase();
      setQrSuggestions(quickReplies.filter(r => r.shortcut.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)));
    } else {
      setQrSuggestions([]);
    }

    // @mention trigger (only in internal notes)
    if (isInternal) {
      const atMatch = val.match(/@(\S*)$/);
      if (atMatch) {
        const q = atMatch[1].toLowerCase();
        setMentionSearch(q);
        setMentionActive(true);
      } else {
        setMentionActive(false);
      }
    } else {
      setMentionActive(false);
    }

    if (!socket || !conversation || isInternal) return;
    socket.emit('typing:start', { conversation_id: conversation.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('typing:stop', { conversation_id: conversation.id }), 2000);
  }

  function applyQuickReply(qr) { setText(renderTemplate(qr.body, conversation, user)); setQrSuggestions([]); }

  async function changePriority(priority) {
    try {
      const { data } = await api.patch(`/conversations/${conversation.id}/priority`, { priority });
      setConversation(data);
      onConversationChange?.(data);
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao alterar prioridade');
    }
    setShowPriorityPicker(false);
  }

  async function openTransfer() {
    try {
      const { data } = await api.get('/users/available');
      setAvailableAttendants(Array.isArray(data) ? data : []);
      setTransferToId('');
      setShowTransfer(true);
    } catch { setWarning('Erro ao carregar atendentes'); }
  }

  // Actualizar status dos atendentes em tempo real enquanto o painel de transferência está aberto
  useEffect(() => {
    if (!showTransfer || !socket) return;
    function onUserStatus({ userId, status }) {
      setAvailableAttendants(prev => prev.map(a => a.id === userId ? { ...a, status } : a));
    }
    socket.on('user:status', onUserStatus);
    return () => socket.off('user:status', onUserStatus);
  }, [showTransfer, socket]);

  async function doTransfer() {
    if (!transferToId) return;
    setTransferring(true);
    try {
      await api.post(`/conversations/${conversation.id}/transfer`, { attendant_id: parseInt(transferToId) });
      setShowTransfer(false);
      onClose?.();
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao transferir');
    }
    setTransferring(false);
  }

  async function snoozeConversation(minutes) {
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    try {
      const { data } = await api.patch(`/conversations/${conversation.id}/snooze`, { snoozed_until: until });
      setConversation(data);
      onConversationChange?.(data);
      setShowSnooze(false);
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao adiar');
    }
  }

  async function unsnoozeConversation() {
    try {
      const { data } = await api.patch(`/conversations/${conversation.id}/snooze`, { snoozed_until: null });
      setConversation(data);
      onConversationChange?.(data);
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao reativar');
    }
  }

  function applyMention(teamUser) {
    const newText = text.replace(/@\S*$/, `@${teamUser.name} `);
    setText(newText);
    setMentionActive(false);
    setMentionSearch('');
  }

  async function saveSchedule() {
    if (!scheduleBody.trim() || !scheduleAt) return;
    const dt = new Date(scheduleAt);
    if (isNaN(dt.getTime())) { setWarning('Data inválida'); return; }
    if (dt <= new Date()) { setWarning('A data/hora do agendamento deve ser no futuro'); return; }
    const maxFuture = new Date(); maxFuture.setFullYear(maxFuture.getFullYear() + 1);
    if (dt > maxFuture) { setWarning('Data inválida: o agendamento não pode ultrapassar 1 ano no futuro'); return; }
    setScheduleSaving(true);
    try {
      await api.post('/scheduled-messages', {
        conversation_id: conversation.id,
        wa_id: conversation.wa_id || conversation.phone,
        body: scheduleBody,
        scheduled_at: scheduleAt,
      });
      setShowSchedule(false);
      setScheduleBody('');
      setScheduleAt('');
    } catch (err) {
      setWarning(err.response?.data?.error || 'Erro ao agendar');
    }
    setScheduleSaving(false);
  }

  async function toggleTag(tag) {
    const has = convTags.some(t => t.id === tag.id);
    if (has) {
      await api.delete(`/tags/conversations/${conversation.id}/${tag.id}`);
    } else {
      await api.post(`/tags/conversations/${conversation.id}`, { tag_id: tag.id });
    }
    // O update do estado é feito pelo socket event 'conversation:tags_updated'
    // que chega para todas as abas (incluindo esta) — evita duplicação
  }

  function handleKey(e) {
    if (e.key === 'Escape') { setQrSuggestions([]); setMentionActive(false); return; }
    // Tab ou Enter no dropdown de menções: aceita o primeiro match
    if (mentionActive && mentionFiltered.length > 0 && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      applyMention(mentionFiltered[0]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionActive) { e.preventDefault(); send(); }
  }

  const typerNames = Object.values(typers).filter(Boolean);
  const isClosed = conversation?.status === 'closed';

  function exportCSV() {
    const contactName = conversation.contact_name || conversation.phone;
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Data/Hora', 'De', 'Tipo', 'Mensagem', 'Media'];
    const rows = messages.map(m => [
      utc(m.timestamp).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
      m.from_me ? (m.sender_name || 'Atendente') : contactName,
      m.is_internal ? 'Nota interna' : 'Mensagem',
      m.deleted ? '[Apagada]' : (m.body || ''),
      m.media_url || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${conversation.id}-${contactName.replace(/\s+/g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    const contactName = conversation.contact_name || conversation.phone;
    const exported = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const APIURL = import.meta.env.VITE_API_URL || window.location.origin;

    const msgsHtml = messages.map(m => {
      const time = utc(m.timestamp).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const isMe = !!m.from_me;
      const sender = isMe ? (m.sender_name || 'Atendente') : contactName;
      const bodyText = m.deleted ? '<em style="color:#9ca3af">[Mensagem apagada]</em>'
        : m.media_url && !m.body ? '<em style="color:#6b7280">[Media]</em>'
        : (m.body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const bgColor = m.is_internal ? '#fffbeb' : isMe ? '#dcf8c6' : '#ffffff';
      const align = isMe ? 'flex-end' : 'flex-start';
      const noteLabel = m.is_internal ? '<div style="font-size:10px;color:#b45309;font-weight:600;margin-bottom:3px">📝 Nota interna</div>' : '';
      const mediaLine = m.media_url ? `<div style="font-size:11px;color:#3b82f6;margin-top:3px">📎 ${m.media_filename || m.media_url.split('/').pop()}</div>` : '';
      return `<div style="display:flex;flex-direction:column;align-items:${align};margin:3px 0">
        <div style="background:${bgColor};border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;max-width:72%">
          ${noteLabel}<div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:2px">${sender}</div>
          <div style="font-size:13px;line-height:1.4">${bodyText}</div>${mediaLine}
        </div>
        <div style="font-size:10px;color:#9ca3af;margin-top:2px">${time}</div>
      </div>`;
    }).join('');

    const STATUS_PT = { open: 'Aberta', waiting: 'Em espera', closed: 'Fechada' };
    const html = `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8">
<title>Conversa #${conversation.id} — ${contactName}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; max-width: 820px; margin: 0 auto; padding: 20px; color: #111827; font-size: 14px; }
  h1 { font-size: 17px; margin: 0 0 6px; color: #111827; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
  .meta span { margin-right: 14px; }
  .messages { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
  @media print { body { padding: 10px; } button { display: none; } }
</style></head><body>
<h1>💬 Conversa com ${contactName}</h1>
<div class="meta">
  <span>📱 ${conversation.phone}</span>
  <span>👤 ${conversation.attendant_name || 'Sem atendente'}</span>
  <span>📋 ${STATUS_PT[conversation.status] || conversation.status}</span>
  <span>💬 ${messages.length} mensagens</span>
  <span>🕒 Exportado: ${exported}</span>
</div>
<div class="messages">${msgsHtml}</div>
<script>window.onload = () => window.print();<\/script>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Permite popups para exportar PDF.'); return; }
    win.document.write(html);
    win.document.close();
  }
  const isSnoozed = conversation?.snoozed_until && new Date(conversation.snoozed_until) > new Date();

  const PRIORITY_OPTIONS = [
    { value: 'urgent', label: '🔴 Urgente', color: '#ef4444' },
    { value: 'normal', label: '⚪ Normal', color: 'var(--muted)' },
    { value: 'low',    label: '🔵 Baixa',   color: '#3b82f6' },
  ];
  const currentPriority = PRIORITY_OPTIONS.find(p => p.value === (conversation?.priority || 'normal'));

  const mentionFiltered = mentionActive
    ? teamUsers.filter(u => u.name.toLowerCase().includes(mentionSearch))
    : [];

  // Group quick replies by category for the dropdown
  const qrGrouped = qrSuggestions.reduce((acc, qr) => {
    const cat = qr.category || '';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(qr);
    return acc;
  }, {});

  if (!conversation) {
    return (
      <div style={S.empty}>
        <div style={S.emptyInner}>
          <span style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>💬</span>
          <p style={{ color: 'var(--hint)', fontSize: '0.9rem' }}>Seleciona uma conversa para começar</p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <ContactAvatar
          contactId={conversation.contact_id}
          name={conversation.contact_name}
          phone={conversation.phone}
          size={36}
          style={{ marginRight: '0.6rem' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.9rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40vw' }}>{conversation.contact_name || conversation.phone}</strong>
            <button onClick={openContactEdit} title="Editar contacto" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.8rem', opacity: 0.5, lineHeight: 1 }}>✏️</button>
            {conversation.department_name && (
              <span title="Departamento" style={{ background: (conversation.department_color || '#6b7280') + '18', border: `1px solid ${(conversation.department_color || '#6b7280')}55`, color: conversation.department_color || '#6b7280', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.7rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: conversation.department_color || '#6b7280' }} />
                {conversation.department_name}
              </span>
            )}
            {isClosed && <span style={{ background: '#f3f4f6', color: 'var(--hint)', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.7rem', fontWeight: 600 }}>Fechada</span>}
            {isSnoozed && <span style={{ background: '#e0e7ff', color: '#4338ca', borderRadius: '999px', padding: '0.1rem 0.55rem', fontSize: '0.7rem', fontWeight: 600 }}>💤 Adiada</span>}
            {convTags.map(t => (
              <span key={t.id} style={{ background: t.color + '18', border: `1px solid ${t.color}55`, color: t.color, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', fontWeight: 600 }}>{t.name}</span>
            ))}
          </div>
          <span style={S.phone}>{conversation.phone}</span>
        </div>
        <div style={S.headerActions}>
          {user.role === 'owner' && (
            <span style={S.attendantBadge}>{conversation.attendant_name || 'Sem atendente'}</span>
          )}

          {/* Prioridade — sempre visível */}
          <div style={{ position: 'relative' }}>
            <button style={{ ...S.iconBtn, color: currentPriority.color, borderColor: currentPriority.color + '66' }}
              onClick={() => setShowPriorityPicker(v => !v)} title="Prioridade">
              {currentPriority.label.split(' ')[0]}
            </button>
            {showPriorityPicker && (
              <div style={{ ...S.tagPicker, minWidth: '130px' }}>
                {PRIORITY_OPTIONS.map(p => (
                  <div key={p.value} onClick={() => changePriority(p.value)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', borderRadius: 'var(--r-sm)', background: conversation.priority === p.value ? p.color + '15' : 'none' }}>
                    <span style={{ fontSize: '0.85rem', color: p.color, flex: 1, fontWeight: conversation.priority === p.value ? 700 : 400 }}>{p.label}</span>
                    {conversation.priority === p.value && <span style={{ color: p.color, fontWeight: 700, fontSize: '0.85rem' }}>✓</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Menu ⋯ — ações secundárias */}
          <div style={{ position: 'relative' }}>
            <button style={{ ...S.iconBtn, fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-1px', color: showOverflow ? 'var(--accent)' : 'var(--muted)', borderColor: showOverflow ? 'var(--accent)' : 'var(--border-m)' }}
              onClick={() => setShowOverflow(v => !v)} title="Mais ações">
              ⋯
            </button>
            {showOverflow && (
              <div style={{ ...S.tagPicker, right: 0, minWidth: '185px', zIndex: 200 }}>

                <div onClick={() => { setShowContact360(v => !v); setShowOverflow(false); }}
                  style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  📊 Histórico contacto
                </div>

                <div onClick={() => { setShowTagPicker(v => !v); setShowOverflow(false); }}
                  style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  🏷️ Etiquetas {convTags.length > 0 && <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: '999px', fontSize: '0.65rem', padding: '0 5px', fontWeight: 700, marginLeft: '2px' }}>{convTags.length}</span>}
                </div>

                <div onClick={() => { setShowExport(v => !v); setShowOverflow(false); }}
                  style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  📥 Exportar histórico
                </div>

                <div onClick={() => { loadHistory(); setShowOverflow(false); }}
                  style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  🕐 Histórico mensagens
                </div>

                {!isClosed && (
                  <div onClick={() => { openTransfer(); setShowOverflow(false); }}
                    style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    🔄 Transferir conversa
                  </div>
                )}

                {user.role === 'owner' && (
                  <div onClick={async () => {
                      setShowOverflow(false);
                      const phone = conversation.phone;
                      if (!confirm('Bloquear ' + (conversation.contact_name || phone) + '?')) return;
                      try {
                        await api.post('/blacklist', { phone, reason: 'Bloqueado via chat' });
                        alert(phone + ' adicionado à blacklist.');
                      } catch (err) {
                        const msg = err.response?.data?.error;
                        if (msg === 'Número já está na blacklist') alert('Este número já está bloqueado.');
                        else alert('Erro: ' + (msg || err.message));
                      }
                    }}
                    style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    🚫 Bloquear contacto
                  </div>
                )}

                {onDelete && (
                  <div onClick={() => { setShowOverflow(false); onDelete(); }}
                    style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    🗑️ Eliminar conversa
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tags picker (posição fixa para não cortar em ecrãs pequenos) */}
          {showTagPicker && (
            <div style={{ position: 'fixed', right: '1rem', top: '60px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', padding: '0.4rem', minWidth: '170px', zIndex: 300 }}>
              {allTags.length === 0 && <p style={{ margin: 0, color: 'var(--hint)', fontSize: '0.8rem' }}>Sem etiquetas criadas</p>}
              {allTags.map(t => {
                const active = convTags.some(ct => ct.id === t.id);
                return (
                  <div key={t.id} onClick={() => toggleTag(t)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', borderRadius: 'var(--r-sm)', background: active ? t.color + '15' : 'none' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', flex: 1, color: 'var(--text)' }}>{t.name}</span>
                    {active && <span style={{ color: t.color, fontWeight: 700, fontSize: '0.85rem' }}>✓</span>}
                  </div>
                );
              })}
              <div onClick={() => setShowTagPicker(false)} style={{ padding: '0.3rem 0.65rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', borderTop: '1px solid var(--border)', marginTop: '0.3rem' }}>Fechar</div>
            </div>
          )}

          {/* Export picker (posição fixa) */}
          {showExport && (
            <div style={{ position: 'fixed', right: '1rem', top: '60px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', padding: '0.4rem', minWidth: '150px', zIndex: 300 }}>
              <div onClick={() => { exportCSV(); setShowExport(false); }}
                style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                📊 Exportar CSV
              </div>
              <div onClick={() => { exportPDF(); setShowExport(false); }}
                style={{ padding: '0.4rem 0.65rem', cursor: 'pointer', fontSize: '0.83rem', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                🖨️ Imprimir / PDF
              </div>
              <div onClick={() => setShowExport(false)} style={{ padding: '0.3rem 0.65rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', borderTop: '1px solid var(--border)', marginTop: '0.3rem' }}>Fechar</div>
            </div>
          )}

          {isClosed ? (
            <button style={{ ...S.iconBtn, color: 'var(--success)', borderColor: 'var(--success)' }} onClick={reopenConversation} title="Reabrir conversa">🔓</button>
          ) : (
            <button style={{ ...S.iconBtn, color: 'var(--warn)', borderColor: 'var(--warn)' }} onClick={closeConversation} title="Fechar conversa">🔒</button>
          )}
          <button style={S.closeBtn} onClick={onClose} title="Minimizar">✕</button>
        </div>
      </div>


      {/* Histórico */}
      {showHistory && (
        <div style={S.historyPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.82rem', color: 'var(--text)' }}>Conversas anteriores</strong>
            <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          {history.length === 0
            ? <p style={{ fontSize: '0.8rem', color: 'var(--hint)', margin: 0 }}>Sem conversas anteriores</p>
            : history.map(c => (
              <div key={c.id} style={S.historyItem}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{utc(c.created_at).toLocaleDateString('pt-PT')}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text)', marginLeft: '0.5rem' }}>{c.attendant_name || 'Sem atendente'} · {c.message_count} msgs</span>
                <span style={{ fontSize: '0.72rem', color: c.status === 'closed' ? 'var(--hint)' : 'var(--success)', marginLeft: 'auto' }}>{c.status}</span>
              </div>
            ))}
        </div>
      )}

      {/* Editar Contacto */}
      {showContactEdit && (
        <div style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border-m)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>✏️ Editar contacto</span>
            <button onClick={() => setShowContactEdit(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input placeholder="Nome" value={contactForm.name} maxLength={100}
              onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))}
              style={{ flex: '1 1 140px', padding: '0.3rem 0.5rem', border: '1px solid var(--border-m)', borderRadius: '4px', fontSize: '0.83rem', background: 'var(--bg)', color: 'var(--text)' }} />
            <input placeholder="Email" value={contactForm.email}
              onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
              style={{ flex: '1 1 160px', padding: '0.3rem 0.5rem', border: '1px solid var(--border-m)', borderRadius: '4px', fontSize: '0.83rem', background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <textarea placeholder="Notas" value={contactForm.notes} rows={2}
            onChange={e => setContactForm(p => ({ ...p, notes: e.target.value }))}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-m)', borderRadius: '4px', fontSize: '0.83rem', resize: 'vertical', background: 'var(--bg)', color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowContactEdit(false)} style={{ padding: '0.25rem 0.75rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.83rem', color: 'var(--muted)' }}>Cancelar</button>
            <button onClick={saveContact} disabled={contactSaving} style={{ padding: '0.25rem 0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.83rem', opacity: contactSaving ? 0.6 : 1 }}>
              {contactSaving ? 'A guardar…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} style={S.messages}>
        {messages.map((msg) => {
          const isEditing = editingMsg?.id === msg.id;
          const canEdit = !!msg.from_me && !msg.is_internal && (Date.now() - utc(msg.timestamp).getTime()) < 15 * 60 * 1000;
          const hasQuote = !!msg.quoted_body || msg.quoted_media_type;
          return (
            <div key={msg.id} style={{ ...S.bubble, ...(msg.from_me ? S.mine : S.theirs), ...(msg.is_internal ? S.internal : {}), position: 'relative' }}
              onMouseEnter={e => {
                e.currentTarget.querySelector('.reply-btn').style.opacity = '1';
                if (canEdit) e.currentTarget.querySelector('.edit-btn')?.style && (e.currentTarget.querySelector('.edit-btn').style.opacity = '1');
                const del = e.currentTarget.querySelector('.delete-btn'); if (del) del.style.opacity = '1';
                const rb = e.currentTarget.querySelector('.react-btn'); if (rb) rb.style.opacity = '1';
              }}
              onMouseLeave={e => {
                e.currentTarget.querySelector('.reply-btn').style.opacity = '0';
                e.currentTarget.querySelector('.edit-btn')?.style && (e.currentTarget.querySelector('.edit-btn').style.opacity = '0');
                const del = e.currentTarget.querySelector('.delete-btn'); if (del) del.style.opacity = '0';
                // O picker tem o seu próprio onMouseLeave (mantém aberto enquanto
                // o cursor está sobre ele ou sobre o botão 😊). Não fechamos aqui.
                const rb = e.currentTarget.querySelector('.react-btn');
                if (rb) {
                  const picker = rb.querySelector('.emoji-picker');
                  const pickerOpen = picker && picker.style.display === 'flex';
                  if (!pickerOpen) rb.style.opacity = '0';
                }
              }}>
              {!!msg.from_me && msg.sender_name && (
                <span style={S.senderName}>{msg.sender_name}{msg.is_internal ? ' · nota interna' : ''}</span>
              )}
              {/* Citação (reply) */}
              {hasQuote && (
                <div style={{ borderLeft: '3px solid var(--accent)', background: msg.from_me ? 'rgba(255,255,255,0.15)' : 'var(--accent-l)', borderRadius: '3px', padding: '0.25rem 0.5rem', marginBottom: '0.3rem', maxWidth: '100%', overflow: 'hidden' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', display: 'block' }}>
                    {msg.quoted_from_me ? (msg.quoted_sender_name || 'Eu') : 'Cliente'}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {msg.quoted_media_type ? '📎 Ficheiro' : msg.quoted_body}
                  </span>
                </div>
              )}
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '180px' }}>
                  <textarea
                    autoFocus
                    value={editBody}
                    onChange={e => setEditBody(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { setEditingMsg(null); } }}
                    style={{ fontSize: '0.88rem', padding: '0.25rem', borderRadius: '4px', border: '1px solid var(--accent)', resize: 'none', minHeight: '60px', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                  <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingMsg(null)} style={{ fontSize: '0.75rem', padding: '2px 8px', border: '1px solid var(--border-m)', background: 'none', borderRadius: '4px', cursor: 'pointer', color: 'var(--muted)' }}>Cancelar</button>
                    <button onClick={saveEdit} style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Guardar</button>
                  </div>
                </div>
              ) : (
                <>
                  <MessageContent msg={msg} onMediaLoad={scrollToBottom} />
                  {(() => {
                    const reactions = parseReactions(msg.reactions);
                    if (reactions.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                        {reactions.map(r => {
                          const isMine = (r.users || []).some(u => u.id === user.id);
                          return (
                            <button key={r.emoji}
                              onClick={async () => {
                                try { await api.post(`/messages/${msg.id}/react`, { emoji: isMine ? '' : r.emoji }); }
                                catch (err) { setWarning(err.response?.data?.error || 'Erro ao reagir'); }
                              }}
                              title={(r.users || []).map(u => u.name).join(', ')}
                              style={{ background: isMine ? 'var(--accent-l)' : 'rgba(0,0,0,0.06)', border: `1px solid ${isMine ? 'var(--accent)' : 'transparent'}`, borderRadius: '999px', cursor: 'pointer', padding: '0 6px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '2px', lineHeight: 1.6 }}>
                              {r.emoji}<span style={{ fontSize: '0.7rem', color: isMine ? 'var(--accent)' : 'var(--muted)', fontWeight: 600 }}>{r.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {msg.failed ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>⚠️ Não entregue</span>
                      <button onClick={async (e) => {
                        const btn = e.currentTarget;
                        btn.disabled = true;
                        btn.textContent = '...';
                        try {
                          const { data } = await api.post(`/messages/${msg.id}/retry`);
                          setMessages(prev => prev.map(m => m.id === data.id ? data : m));
                        } catch (err) {
                          const errMsg = err.response?.data?.error || 'Erro ao reenviar';
                          setMessages(prev => prev.map(m => m.id === msg.id
                            ? { ...m, retryError: errMsg }
                            : m
                          ));
                          btn.disabled = false;
                          btn.textContent = '↻ Reenviar';
                        }
                      }} style={{ fontSize: '0.72rem', padding: '1px 7px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        ↻ Reenviar
                      </button>
                      {msg.retryError && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>⚠ {msg.retryError}</span>
                      )}
                    </div>
                  ) : null}
                </>
              )}
              <span style={S.time}>
                {msg.edited_at && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>editada · </span>}
                {utc(msg.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                {!!msg.from_me && !msg.is_internal && !msg.deleted && (
                  <span title={
                    msg.wa_status >= 4 ? 'Lida' : msg.wa_status >= 3 ? 'Entregue' : msg.wa_status >= 2 ? 'Enviada ao servidor' : 'A enviar'
                  } style={{ marginLeft: '4px', fontSize: '0.78rem', color: msg.wa_status >= 4 ? '#34b7f1' : 'var(--muted)', opacity: msg.wa_status >= 2 ? 1 : 0.55 }}>
                    {msg.wa_status >= 3 ? '✓✓' : '✓'}
                  </span>
                )}
              </span>
              {/* Botão reply — sempre presente (visível no hover) */}
              <button className="reply-btn" onClick={() => !msg.is_internal && setReplyTo({ id: msg.id, body: msg.body, from_me: msg.from_me, sender_name: msg.sender_name, quoted_media_type: msg.media_type })}
                style={{ opacity: 0, transition: 'opacity .15s', position: 'absolute', top: '4px', left: msg.from_me ? '-52px' : 'auto', right: msg.from_me ? 'auto' : '-52px', background: 'var(--card)', border: '1px solid var(--border-m)', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh)' }}>
                ↩️
              </button>
              {canEdit && !isEditing && (
                <button className="edit-btn" onClick={() => { setEditingMsg(msg); setEditBody(msg.body); }}
                  style={{ opacity: 0, transition: 'opacity .15s', position: 'absolute', top: '4px', left: msg.from_me ? '-28px' : 'auto', right: msg.from_me ? 'auto' : '-28px', background: 'var(--card)', border: '1px solid var(--border-m)', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh)' }}>
                  ✏️
                </button>
              )}
              {!msg.is_internal && !msg.deleted && (
                <div className="react-btn" style={{ opacity: 0, transition: 'opacity .15s', position: 'absolute', top: '4px', left: msg.from_me ? '-100px' : 'auto', right: msg.from_me ? 'auto' : '-100px' }}>
                  <button title="Reagir"
                    onClick={e => {
                      e.stopPropagation();
                      const picker = e.currentTarget.parentElement.querySelector('.emoji-picker');
                      if (picker) picker.style.display = picker.style.display === 'flex' ? 'none' : 'flex';
                    }}
                    style={{ background: 'var(--card)', border: '1px solid var(--border-m)', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh)' }}>😊</button>
                  <div className="emoji-picker"
                    onMouseLeave={e => {
                      // Fecha quando o cursor sai realmente do picker (não da bolha)
                      e.currentTarget.style.display = 'none';
                      const rb = e.currentTarget.closest('.react-btn');
                      if (rb) rb.style.opacity = '0';
                    }}
                    style={{ display: 'none', position: 'absolute', top: '22px', left: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px', gap: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 10 }}>
                    {COMMON_EMOJIS.map(em => (
                      <button key={em}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const picker = e.currentTarget.parentElement;
                          picker.style.display = 'none';
                          const rb = picker.closest('.react-btn');
                          if (rb) rb.style.opacity = '0';
                          try { await api.post(`/messages/${msg.id}/react`, { emoji: em }); }
                          catch (err) { setWarning(err.response?.data?.error || 'Erro ao reagir'); }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '2px 4px', borderRadius: '4px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!!msg.from_me && !msg.is_internal && !msg.deleted && (
                <button className="delete-btn" title="Apagar para todos"
                  onClick={async () => {
                    if (!window.confirm('Apagar esta mensagem? Vai também ser apagada no WhatsApp do destinatário.')) return;
                    try { await api.delete(`/messages/${msg.id}`); }
                    catch (err) { setWarning(err.response?.data?.error || 'Erro ao apagar mensagem'); }
                  }}
                  style={{ opacity: 0, transition: 'opacity .15s', position: 'absolute', top: '4px', left: msg.from_me ? '-76px' : 'auto', right: msg.from_me ? 'auto' : '-76px', background: 'var(--card)', border: '1px solid var(--border-m)', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh)', color: 'var(--danger)' }}>
                  🗑️
                </button>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {(typerNames.length > 0 || clientPresence) && (
        <div style={S.typingBar}>
          <span style={{ color: 'var(--wa-green)', fontSize: '0.55rem', letterSpacing: '3px' }}>●●●</span>
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {clientPresence === 'recording'
              ? `${conversation.contact_name || conversation.phone} está a gravar áudio...`
              : clientPresence === 'composing'
                ? `${conversation.contact_name || conversation.phone} está a digitar...`
                : `${typerNames.join(', ')} a digitar...`}
          </span>
        </div>
      )}

      {warning && <div style={S.warning}>{warning}</div>}

      {qrSuggestions.length > 0 && (
        <div style={S.qrDropdown}>
          {Object.entries(qrGrouped).map(([cat, items]) => (
            <div key={cat}>
              {cat && <div style={{ padding: '0.25rem 1rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-l)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cat}</div>}
              {items.map(qr => (
                <div key={qr.id} style={S.qrItem} onClick={() => applyQuickReply(qr)}>
                  {qr.owner_user_id && (
                    <span title="Atalho pessoal" style={{ marginRight: '0.3rem', fontSize: '0.75rem' }}>👤</span>
                  )}
                  <strong style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>/{qr.shortcut}</strong>
                  <span style={{ color: 'var(--muted)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{qr.body}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* @mention dropdown */}
      {mentionActive && mentionFiltered.length > 0 && (
        <div style={{ ...S.qrDropdown, maxHeight: '140px' }}>
          <div style={{ padding: '0.25rem 1rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)' }}>Mencionar atendente</div>
          {mentionFiltered.map(u => (
            <div key={u.id} style={S.qrItem} onClick={() => applyMention(u)}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', marginRight: '0.5rem', flexShrink: 0 }}>{u.name[0].toUpperCase()}</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>@{u.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Transfer panel */}
      {showTransfer && (
        <div style={S.schedulePanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>🔄 Transferir conversa</strong>
            <button onClick={() => setShowTransfer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          {availableAttendants.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--hint)' }}>Nenhum atendente disponível no momento.</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={transferToId} onChange={e => setTransferToId(e.target.value)}
                style={{ flex: 1, padding: '0.35rem 0.5rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.85rem', background: 'var(--card)', color: 'var(--text)' }}>
                <option value=''>Selecionar atendente...</option>
                {availableAttendants.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.status === 'online' ? '🟢' : a.status === 'busy' ? '🟡' : '⚫'} {a.status})</option>
                ))}
              </select>
              <button onClick={doTransfer} disabled={!transferToId || transferring}
                style={{ padding: '0.35rem 0.9rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, opacity: (!transferToId || transferring) ? 0.6 : 1 }}>
                {transferring ? 'A transferir...' : 'Transferir'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Snooze panel */}
      {showSnooze && (
        <div style={S.schedulePanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>💤 Adiar conversa</strong>
            <button onClick={() => setShowSnooze(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { label: '1 hora', mins: 60 },
              { label: '3 horas', mins: 180 },
              { label: '8 horas', mins: 480 },
              { label: 'Amanhã 9h', mins: (() => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return Math.round((t - Date.now()) / 60000); })() },
            ].map(({ label, mins }) => (
              <button key={label} style={{ padding: '0.3rem 0.7rem', background: 'var(--card)', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text)', fontWeight: 500 }}
                onClick={() => snoozeConversation(mins)}>{label}</button>
            ))}
          </div>
          {isSnoozed && (
            <button style={{ marginTop: '0.5rem', padding: '0.25rem 0.6rem', background: 'none', border: '1px solid var(--danger)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--danger)' }}
              onClick={unsnoozeConversation}>Cancelar snooze</button>
          )}
        </div>
      )}

      {showSchedule && (
        <div style={S.schedulePanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Agendar mensagem</strong>
            <button onClick={() => setShowSchedule(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>✕</button>
          </div>
          <input type="datetime-local" style={{ ...S.schedInput, marginBottom: '0.5rem' }}
            value={scheduleAt} onChange={e => setScheduleAt(e.target.value)}
            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
            max={new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)} />
          <textarea style={{ ...S.schedInput, resize: 'vertical', minHeight: '60px' }}
            placeholder="Texto da mensagem..." value={scheduleBody}
            onChange={e => setScheduleBody(e.target.value)} />
          <button style={S.schedBtn} onClick={saveSchedule} disabled={scheduleSaving || !scheduleBody.trim() || !scheduleAt}>
            {scheduleSaving ? 'A guardar...' : '📅 Agendar'}
          </button>
        </div>
      )}

      {/* Input area — bloqueado se conversa fechada */}
      {isClosed ? (
        <div style={S.closedBar}>
          <span>Conversa fechada.</span>
          <button style={S.reopenBtn} onClick={reopenConversation}>🔓 Reabrir para responder</button>
        </div>
      ) : (
        <div style={S.inputArea}>
          {/* Reply preview bar */}
          {replyTo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--accent-l)', borderLeft: '3px solid var(--accent)', borderRadius: '4px', padding: '0.35rem 0.6rem', margin: '0 0 0.3rem', fontSize: '0.8rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: 'var(--accent)', display: 'block' }}>
                  ↩️ {replyTo.from_me ? (replyTo.sender_name || 'Eu') : 'Cliente'}
                </span>
                <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                  {replyTo.quoted_media_type ? '📎 Ficheiro' : replyTo.body}
                </span>
              </div>
              <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--hint)', fontSize: '0.85rem', flexShrink: 0 }}>✕</button>
            </div>
          )}

          {/* Hidden file input */}
          <input ref={fileInputRef} type="file" style={{ display: 'none' }}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.type.startsWith('image/')) {
                setPendingFile(file);
                setPendingCaption('');
                setPendingPreviewUrl(URL.createObjectURL(file));
              } else {
                sendFile(file);
              }
            }} />

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0.3rem' }}>
            {/* Recording bar */}
            {recording && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0.75rem', background: '#fee2e2', borderRadius: '8px' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>{formatRecordSecs(recordSeconds)}</span>
                <span style={{ color: '#991b1b', fontSize: '0.8rem', flex: 1 }}>A gravar...</span>
              </div>
            )}
            {/* Audio preview after recording */}
            {audioFile && !recording && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.65rem', background: 'var(--accent-l)', borderRadius: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>🎙️</span>
                <audio src={URL.createObjectURL(audioFile)} controls style={{ height: 28, flex: 1, minWidth: 0 }} />
              </div>
            )}
            {/* Normal input (hidden while recording/previewing audio) */}
            {!recording && !audioFile && (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button style={{ ...S.modeBtn, ...(isInternal ? S.modeBtnInternal : {}) }} onClick={() => setIsInternal(v => !v)}>
                    {isInternal ? '🔒 Nota' : '💬 Mensagem'}
                  </button>
                  <span style={{ fontSize: '0.72rem', color: 'var(--hint)' }}>{isInternal ? '@ para mencionar atendente' : '/ para respostas rápidas'}</span>
                </div>
                <textarea
                  style={{ ...S.textarea, ...(isInternal ? S.textareaInternal : {}) }}
                  value={text}
                  onChange={handleTyping}
                  onKeyDown={handleKey}
                  placeholder={isInternal ? 'Nota interna (só a equipa vê)...' : 'Escreve uma mensagem...'}
                  rows={2}
                />
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {!recording && !audioFile && (
              <>
                <button style={S.schedIconBtn} onClick={() => fileInputRef.current?.click()} title="Enviar ficheiro" disabled={uploadingFile}>
                  {uploadingFile ? '⏳' : '📎'}
                </button>
                <button style={S.schedIconBtn} onClick={startRecording} title="Gravar áudio">🎙️</button>
                <button style={S.schedIconBtn} onClick={() => setShowSchedule(v => !v)} title="Agendar mensagem">📅</button>
                <button style={{ ...S.schedIconBtn, ...(isSnoozed ? { background: '#e0e7ff', borderColor: '#4338ca' } : {}) }} onClick={() => setShowSnooze(v => !v)} title="Adiar conversa">💤</button>
                <button style={S.sendBtn} onClick={send} disabled={sending || !text.trim()}>▶</button>
              </>
            )}
            {(recording || audioFile) && (
              <>
                <button style={{ ...S.schedIconBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={cancelRecording} title="Cancelar">✕</button>
                {recording
                  ? <button style={{ ...S.sendBtn, background: '#ef4444' }} onClick={stopRecording} title="Parar gravação">⏹</button>
                  : <button style={S.sendBtn} onClick={sendAudio} disabled={sending}>▶</button>
                }
              </>
            )}
          </div>
        </div>
      )}

      {/* File preview modal — caption for images */}
      {pendingFile && pendingPreviewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--card)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>Enviar imagem</span>
              <button onClick={() => { setPendingFile(null); setPendingCaption(''); setPendingPreviewUrl(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--muted)' }}>✕</button>
            </div>
            {/* Image preview */}
            <div style={{ background: '#000', maxHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src={pendingPreviewUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: '50vh', objectFit: 'contain', display: 'block' }} />
            </div>
            {/* Caption input */}
            <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)' }}>
              <input
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.9rem', background: 'var(--bg)', color: 'var(--text)', outline: 'none' }}
                placeholder="Adicionar legenda (opcional)..."
                value={pendingCaption}
                onChange={e => setPendingCaption(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const f = pendingFile; const cap = pendingCaption;
                    setPendingFile(null); setPendingCaption(''); setPendingPreviewUrl(null);
                    sendFile(f, cap);
                  }
                  if (e.key === 'Escape') { setPendingFile(null); setPendingCaption(''); setPendingPreviewUrl(null); }
                }}
              />
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', padding: '0 1rem 1rem' }}>
              <button onClick={() => { setPendingFile(null); setPendingCaption(''); setPendingPreviewUrl(null); }}
                style={{ padding: '0.45rem 1rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Cancelar
              </button>
              <button onClick={() => {
                  const f = pendingFile; const cap = pendingCaption;
                  setPendingFile(null); setPendingCaption(''); setPendingPreviewUrl(null);
                  sendFile(f, cap);
                }}
                style={{ padding: '0.45rem 1.25rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                disabled={uploadingFile}>
                ▶ Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Painel lateral: Histórico 360 do contacto */}
      <ContactHistory
        open={showContact360}
        contactId={conversation?.contact_id}
        onClose={() => setShowContact360(false)}
        onSelectConversation={(c) => {
          // Permitir navegar para conversa antiga apenas se for diferente da actual
          if (c.id !== conversation?.id && onConversationChange) {
            onConversationChange({ id: c.id });
            setShowContact360(false);
          }
        }}
      />
    </div>
  );
}

const S = {
  container: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--bg)' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg)' },
  emptyInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--card)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--sh)', gap: '0.75rem' },
  phone: { display: 'block', fontSize: '0.75rem', color: 'var(--hint)', marginTop: '1px' },
  headerActions: { display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' },
  attendantBadge: { background: 'var(--accent-l)', color: 'var(--accent)', padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 },
  iconBtn: { background: 'none', border: '1px solid var(--border-m)', padding: '0', width: '30px', height: '30px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tagPicker: { position: 'absolute', right: 0, top: '110%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)', padding: '0.4rem', minWidth: '170px', zIndex: 100 },
  dangerBtn: { background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0', width: '30px', height: '30px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  closeBtn: { background: 'none', border: '1px solid var(--border-m)', color: 'var(--muted)', padding: '0', width: '30px', height: '30px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  historyPanel: { background: 'var(--warn-l)', borderBottom: '1px solid rgba(217,119,6,0.2)', padding: '0.75rem 1rem', maxHeight: '150px', overflowY: 'auto' },
  historyItem: { display: 'flex', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid rgba(217,119,6,0.12)' },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  bubble: { maxWidth: '70%', padding: '0.5rem 0.75rem', borderRadius: 'var(--r-md)', position: 'relative', overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 },
  mine: { alignSelf: 'flex-end', background: 'var(--wa-bubble)', boxShadow: 'var(--sh)' },
  theirs: { alignSelf: 'flex-start', background: 'var(--card)', boxShadow: 'var(--sh)' },
  internal: { background: 'var(--warn-l)', border: '1px dashed var(--warn)', alignSelf: 'flex-end' },
  senderName: { fontSize: '0.68rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem', fontWeight: 600 },
  time: { fontSize: '0.67rem', color: 'var(--hint)', float: 'right', marginTop: '0.25rem', marginLeft: '0.5rem' },
  typingBar: { padding: '0.3rem 1rem', background: 'var(--card)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 },
  warning: { background: 'var(--warn-l)', color: 'var(--warn)', padding: '0.4rem 1rem', fontSize: '0.82rem', borderTop: '1px solid rgba(217,119,6,0.25)', flexShrink: 0 },
  qrDropdown: { background: 'var(--card)', borderTop: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto', flexShrink: 0 },
  qrItem: { padding: '0.5rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline' },
  schedulePanel: { background: 'var(--accent-l)', borderTop: '1px solid rgba(26,86,160,0.15)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 },
  schedInput: { padding: '0.4rem 0.6rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', background: 'var(--card)', color: 'var(--text)' },
  schedBtn: { padding: '0.4rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 600, alignSelf: 'flex-start', fontSize: '0.85rem' },
  closedBar: { padding: '0.75rem 1rem', background: '#f3f4f6', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, fontSize: '0.85rem', color: 'var(--muted)' },
  reopenBtn: { padding: '0.35rem 0.9rem', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 },
  inputArea: { display: 'flex', gap: '0.5rem', padding: '0.75rem', background: 'var(--card)', borderTop: '1px solid var(--border)', alignItems: 'flex-end', flexShrink: 0 },
  modeBtn: { padding: '0.2rem 0.6rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap', background: 'none', color: 'var(--muted)' },
  modeBtnInternal: { background: 'var(--warn-l)', borderColor: 'var(--warn)', color: '#92400e' },
  textarea: { width: '100%', padding: '0.5rem', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', resize: 'none', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: 'var(--card)', color: 'var(--text)' },
  textareaInternal: { background: 'var(--warn-l)', borderColor: 'var(--warn)' },
  sendBtn: { padding: '0 0.85rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontWeight: 700, flex: 1, fontSize: '1rem' },
  schedIconBtn: { padding: '0.2rem 0.5rem', background: 'none', border: '1px solid var(--border-m)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '0.95rem' },
};
