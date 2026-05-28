import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../../api';

const COMMON_EMOJIS = ['😊','😂','❤️','👍','🙏','🎉','😮','🔥','✅','👀','😢','😍','🤔','💪','🙌','👋','😅','🤣','💯','🚀'];

export default function MessageInput({ threadId, onMessageSent, replyTo, onCancelReply, allUsers = [] }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Audio recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimerRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  const filteredMentions = mentionQuery !== null
    ? allUsers.filter(u => u.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8)
    : [];

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  function handleInput(e) {
    const val = e.target.value;
    setBody(val);
    const caret = e.target.selectionStart;
    const textBefore = val.slice(0, caret);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionStart(caret - atMatch[0].length);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(u) {
    const before = body.slice(0, mentionStart);
    const after = body.slice(textareaRef.current?.selectionStart || mentionStart + (mentionQuery?.length || 0) + 1);
    const newBody = before + `@${u.name} ` + after;
    setBody(newBody);
    setMentionQuery(null);
    setTimeout(() => {
      textareaRef.current?.focus();
      const pos = (before + `@${u.name} `).length;
      textareaRef.current?.setSelectionRange(pos, pos);
    }, 10);
  }

  function handleKeyDown(e) {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filteredMentions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filteredMentions[mentionIndex]); return; }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setFilePreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
    e.target.value = '';
  }

  function removeFile() { setFile(null); setFilePreview(null); }

  // ── Audio recording ──────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const mr = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const audioFile = new File([blob], `audio_${Date.now()}.${ext}`, { type: mimeType });
        setFile(audioFile);
        setFilePreview(null);
        setRecording(false);
        setRecordSeconds(0);
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
  }

  function formatSeconds(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  // ─────────────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (sending) return;
    if (!body.trim() && !file) return;

    setSending(true);
    try {
      const formData = new FormData();
      formData.append('body', body.trim());
      if (replyTo) formData.append('reply_to_id', replyTo.id);
      if (file) formData.append('file', file);

      const { data } = await api.post(`/internal-chat/threads/${threadId}/messages`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setBody('');
      setFile(null);
      setFilePreview(null);
      setMentionQuery(null);
      onCancelReply?.();
      onMessageSent?.(data);
      textareaRef.current?.focus();
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }

  const S = {
    container: { padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--card)', position: 'relative' },
    replyBar: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.7rem', background: 'var(--bg)', borderRadius: '6px 6px 0 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--muted)' },
    filePreviewBar: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.7rem', background: 'var(--bg)', borderRadius: '6px', marginBottom: '0.5rem', fontSize: '0.82rem', border: '1px solid var(--border)' },
    inputRow: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem' },
    textarea: { flex: 1, padding: '0.55rem 0.75rem', border: '1px solid var(--border-m)', borderRadius: '10px', fontSize: '0.9rem', background: 'var(--bg)', color: 'var(--text)', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: '160px', overflowY: 'auto', outline: 'none' },
    iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.1rem', padding: '0.3rem', borderRadius: '6px', flexShrink: 0, lineHeight: 1 },
    sendBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.88rem', flexShrink: 0, lineHeight: 1.4 },
    mentionList: { position: 'absolute', bottom: '100%', left: '1rem', right: '1rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 50, overflow: 'hidden', maxHeight: '220px', overflowY: 'auto' },
    emojiPicker: { position: 'absolute', bottom: '100%', right: '1rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '4px', width: '220px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 50 },
    recordingBar: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: '#fee2e2', borderRadius: '10px', flex: 1 },
  };

  return (
    <div style={S.container}>
      {/* Mention autocomplete */}
      {mentionQuery !== null && filteredMentions.length > 0 && (
        <div style={S.mentionList}>
          <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.72rem', color: 'var(--muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>Mencionar utilizador</div>
          {filteredMentions.map((u, i) => (
            <div key={u.id}
              onClick={() => insertMention(u)}
              style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', background: i === mentionIndex ? 'var(--accent-l)' : 'transparent', fontSize: '0.875rem' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>
                {u.name[0].toUpperCase()}
              </div>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: '0.75rem', marginLeft: 'auto' }}>{u.role}</span>
            </div>
          ))}
        </div>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <div style={S.emojiPicker}>
          {COMMON_EMOJIS.map(emoji => (
            <button key={emoji}
              onClick={() => { setBody(b => b + emoji); setShowEmoji(false); textareaRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', padding: '3px', borderRadius: '5px' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Reply bar */}
      {replyTo && (
        <div style={S.replyBar}>
          <span>↩ A responder a <strong style={{ color: 'var(--text)' }}>{replyTo.sender?.name || 'alguém'}</strong>: {(replyTo.body || '').substring(0, 60)}{(replyTo.body || '').length > 60 ? '...' : ''}</span>
          <button onClick={onCancelReply} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Audio file preview (after recording) */}
      {file && file.type.startsWith('audio/') && !recording && (
        <div style={S.filePreviewBar}>
          <span>🎤</span>
          <span style={{ flex: 1, color: 'var(--text)' }}>Áudio gravado ({formatSeconds(recordSeconds > 0 ? recordSeconds : Math.round(file.size / 16000))})</span>
          <audio src={URL.createObjectURL(file)} controls style={{ height: 32, flex: 2 }} />
          <button onClick={removeFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Non-audio file preview */}
      {file && !file.type.startsWith('audio/') && (
        <div style={S.filePreviewBar}>
          {filePreview ? (
            <img src={filePreview} alt="" style={{ width: 40, height: 40, borderRadius: '4px', objectFit: 'cover' }} />
          ) : (
            <span>📎</span>
          )}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{file.name}</span>
          <button onClick={removeFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      <div style={S.inputRow}>
        {recording ? (
          /* Recording mode UI */
          <>
            <button style={{ ...S.iconBtn, color: '#ef4444' }} onClick={cancelRecording} title="Cancelar gravação">✕</button>
            <div style={S.recordingBar}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, animation: 'pulse 1s infinite' }} />
              <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>{formatSeconds(recordSeconds)}</span>
              <span style={{ color: '#b91c1c', fontSize: '0.8rem' }}>A gravar áudio...</span>
            </div>
            <button
              style={{ ...S.sendBtn, background: '#ef4444' }}
              onClick={stopRecording}
              title="Parar gravação">
              ⏹ Parar
            </button>
          </>
        ) : (
          /* Normal mode UI */
          <>
            {/* File attach */}
            <button style={S.iconBtn} onClick={() => fileRef.current?.click()} title="Anexar ficheiro"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              📎
            </button>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />

            {/* Emoji */}
            <button style={S.iconBtn} onClick={() => setShowEmoji(v => !v)} title="Emoji"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              😊
            </button>

            {/* Audio record */}
            <button style={S.iconBtn} onClick={startRecording} title="Gravar áudio"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              🎤
            </button>

            {/* Text area */}
            <textarea
              ref={textareaRef}
              value={body}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Escreve uma mensagem... (@ para mencionar)"
              rows={1}
              style={{ ...S.textarea, height: 'auto' }}
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
              }}
            />

            {/* Send */}
            <button
              style={{ ...S.sendBtn, opacity: (!body.trim() && !file) || sending ? 0.5 : 1, cursor: (!body.trim() && !file) || sending ? 'not-allowed' : 'pointer' }}
              onClick={handleSend}
              disabled={(!body.trim() && !file) || sending}
            >
              {sending ? '...' : 'Enviar'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
