import { useState, useRef } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '👀', '✅', '🔥'];

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function ReactionBar({ reactions, messageId, onReactionChange }) {
  const { user } = useAuth();
  if (!reactions || reactions.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
      {reactions.map(r => {
        const isMine = r.users?.some(u => u.id === user.id);
        return (
          <button key={r.emoji}
            onClick={() => onReactionChange(messageId, r.emoji)}
            title={r.users?.map(u => u.name).join(', ')}
            style={{ background: isMine ? 'var(--accent-l)' : 'var(--bg)', border: `1px solid ${isMine ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '999px', cursor: 'pointer', padding: '1px 7px', fontSize: '0.82rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            {r.emoji} <span style={{ fontSize: '0.72rem', color: isMine ? 'var(--accent)' : 'var(--muted)' }}>{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function MediaPreview({ url, type, filename }) {
  if (!url) return null;
  const isImage = type?.startsWith('image/');
  const isVideo = type?.startsWith('video/');
  const isAudio = type?.startsWith('audio/');
  const baseUrl = (import.meta.env.VITE_API_URL ?? '') + url;

  if (isImage) {
    return (
      <a href={baseUrl} target="_blank" rel="noopener noreferrer">
        <img src={baseUrl} alt={filename || 'imagem'} style={{ maxWidth: '260px', maxHeight: '200px', borderRadius: '8px', display: 'block', marginTop: '6px', cursor: 'pointer', objectFit: 'cover' }} />
      </a>
    );
  }
  if (isVideo) {
    return <video src={baseUrl} controls style={{ maxWidth: '260px', borderRadius: '8px', marginTop: '6px', display: 'block' }} />;
  }
  if (isAudio) {
    return <audio src={baseUrl} controls style={{ marginTop: '6px', display: 'block' }} />;
  }
  return (
    <a href={baseUrl} target="_blank" rel="noopener noreferrer" download={filename}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '6px', padding: '0.4rem 0.7rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--accent)', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 500 }}>
      📎 {filename || 'Ficheiro'}
    </a>
  );
}

export default function MessageItem({ message, isOwn, showAvatar, onReply, onReactionChange, isOwner }) {
  const { user } = useAuth();
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body || '');
  const [saving, setSaving] = useState(false);
  const editRef = useRef(null);

  const isDeleted = !!message.deleted;
  const isPinned = !!message.pinned;
  const isEdited = !!message.edited;

  // Parse @mentions for highlighting
  function renderBody(body) {
    if (!body) return null;
    // Highlight @mentions
    const parts = body.split(/(@\w[\w\s]*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>{part}</span>;
      }
      // Render line breaks
      return part.split('\n').map((line, j) => (
        <span key={`${i}-${j}`}>{j > 0 && <br />}{line}</span>
      ));
    });
  }

  async function saveEdit() {
    if (!editBody.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/internal-chat/messages/${message.id}`, { body: editBody.trim() });
      setEditing(false);
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao editar');
    } finally {
      setSaving(false);
    }
  }

  async function deleteMsg() {
    if (!confirm('Apagar esta mensagem?')) return;
    try {
      await api.delete(`/internal-chat/messages/${message.id}`);
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao apagar');
    }
  }

  async function togglePin() {
    try {
      await api.post(`/internal-chat/messages/${message.id}/pin`);
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao fixar');
    }
  }

  const canEdit = isOwn && !isDeleted;
  const canDelete = (isOwn || isOwner) && !isDeleted;
  const canPin = isOwner && !isDeleted;

  return (
    <div
      style={{ position: 'relative', padding: '2px 1rem', marginBottom: showAvatar ? '0.5rem' : '0' }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); }}
    >
      {/* Pinned indicator */}
      {isPinned && (
        <div style={{ fontSize: '0.7rem', color: 'var(--accent)', marginBottom: '2px', paddingLeft: showAvatar ? '40px' : '40px' }}>
          📌 Fixada
        </div>
      )}

      {/* Reply preview */}
      {message.reply_to && (
        <div style={{ marginLeft: '40px', marginBottom: '4px', padding: '4px 8px', borderLeft: '3px solid var(--accent)', background: 'var(--bg)', borderRadius: '0 6px 6px 0', fontSize: '0.78rem', color: 'var(--muted)', maxWidth: '420px' }}>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{message.reply_to.sender_name}</span>
          <span style={{ marginLeft: '6px' }}>{message.reply_to.body?.substring(0, 80)}{message.reply_to.body?.length > 80 ? '...' : ''}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
        {/* Avatar area — always 32px wide for alignment */}
        <div style={{ width: 32, flexShrink: 0, paddingTop: '2px' }}>
          {showAvatar ? (
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: (() => { const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#ef4444', '#06b6d4']; return colors[(message.sender?.name || '').charCodeAt(0) % colors.length]; })(), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.78rem', fontWeight: 700 }}>
              {(message.sender?.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
          ) : null}
        </div>

        {/* Message body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {showAvatar && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '2px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)' }}>{message.sender?.name || 'Desconhecido'}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--hint)' }}>{formatTime(message.created_at)}</span>
              {isEdited && !isDeleted && <span style={{ fontSize: '0.7rem', color: 'var(--hint)', fontStyle: 'italic' }}>(editado)</span>}
            </div>
          )}

          {isDeleted ? (
            <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.875rem' }}>Mensagem apagada</span>
          ) : editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxWidth: '480px' }}>
              <textarea
                ref={editRef}
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                  if (e.key === 'Escape') setEditing(false);
                }}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--accent)', borderRadius: '6px', fontSize: '0.875rem', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit', boxSizing: 'border-box' }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.75rem' }}>
                <button onClick={saveEdit} disabled={saving} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', padding: '0.25rem 0.6rem', fontWeight: 600 }}>
                  {saving ? '...' : 'Guardar'}
                </button>
                <button onClick={() => setEditing(false)} style={{ background: 'none', border: '1px solid var(--border-m)', borderRadius: '5px', cursor: 'pointer', padding: '0.25rem 0.6rem', color: 'var(--muted)' }}>
                  Cancelar
                </button>
                <span style={{ color: 'var(--hint)', alignSelf: 'center' }}>Esc para cancelar · Enter para guardar</span>
              </div>
            </div>
          ) : (
            <div>
              <span style={{ fontSize: '0.875rem', color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                {renderBody(message.body)}
              </span>
              <MediaPreview url={message.media_url} type={message.media_type} filename={message.media_filename} />
            </div>
          )}

          {!isDeleted && !editing && !showAvatar && (
            <div style={{ fontSize: '0.68rem', color: 'var(--hint)', marginTop: '1px' }}>
              {formatTime(message.created_at)}
              {isEdited && <span style={{ marginLeft: '4px', fontStyle: 'italic' }}>(editado)</span>}
            </div>
          )}

          <ReactionBar reactions={message.reactions} messageId={message.id} onReactionChange={onReactionChange} />
        </div>
      </div>

      {/* Hover action bar */}
      {showActions && !isDeleted && !editing && (
        <div style={{ position: 'absolute', right: '1rem', top: '-14px', display: 'flex', gap: '2px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', padding: '2px 4px', zIndex: 10 }}>
          {/* React */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowEmojiPicker(v => !v)} title="Reagir"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', padding: '3px 5px', borderRadius: '5px', color: 'var(--muted)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              😊
            </button>
            {showEmojiPicker && (
              <div style={{ position: 'absolute', right: 0, top: '28px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px', width: '180px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 20 }}>
                {COMMON_EMOJIS.map(emoji => (
                  <button key={emoji}
                    onClick={() => { onReactionChange(message.id, emoji); setShowEmojiPicker(false); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '3px', borderRadius: '5px' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reply */}
          <button onClick={() => onReply(message)} title="Responder"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: '3px 5px', borderRadius: '5px', color: 'var(--muted)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            ↩
          </button>

          {/* Edit */}
          {canEdit && (
            <button onClick={() => { setEditing(true); setEditBody(message.body || ''); }} title="Editar"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: '3px 5px', borderRadius: '5px', color: 'var(--muted)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              ✏️
            </button>
          )}

          {/* Pin */}
          {canPin && (
            <button onClick={togglePin} title={message.pinned ? 'Desafixar' : 'Fixar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: '3px 5px', borderRadius: '5px', color: message.pinned ? 'var(--accent)' : 'var(--muted)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              📌
            </button>
          )}

          {/* Delete */}
          {canDelete && (
            <button onClick={deleteMsg} title="Apagar"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: '3px 5px', borderRadius: '5px', color: 'var(--muted)' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = 'var(--danger)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--muted)'; }}>
              🗑️
            </button>
          )}
        </div>
      )}
    </div>
  );
}
