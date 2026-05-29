import { useEffect, useRef } from 'react';
import api from '../api';

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Dois tons: "ding-dong" suave
    [[880, 0], [1100, 0.18]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch (_) {}
}

function playMentionSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Três tons subindo, mais audíveis e distintivos — chama atenção
    [[660, 0, 0.32], [880, 0.13, 0.32], [1320, 0.26, 0.42]].forEach(([freq, delay, vol]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle'; // mais brilhante que sine
      osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch (_) {}
}

export function useNotifications(socket, selectedConv, user) {
  // Set local de IDs de conversas mutadas pelo utilizador actual. O
  // 'conversation' que chega no payload do socket message:new é global
  // (do getConversationWithContact) e não inclui is_muted per-user, por
  // isso filtramos aqui com fetch inicial + sync via socket mute_change.
  const mutedIds = useRef(new Set());

  // Pede permissão ao montar
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // Fetch inicial dos IDs mutados
    api.get('/conversations/mutes').then(r => {
      if (Array.isArray(r.data)) mutedIds.current = new Set(r.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;

    function onNewMessage({ message, conversation }) {
      if (message?.from_me) return;
      if (conversation?.id === selectedConv?.id) return;
      if (user?.role === 'attendant' && conversation?.assigned_to !== user?.id) return;
      // Conversa silenciada por este user — sem som nem desktop notification.
      // Usa Set local (is_muted no payload chega indefinido por ser per-user).
      if (mutedIds.current.has(conversation?.id)) return;

      // Som — sempre que chega mensagem noutras conversas
      playNotificationSound();

      // Notificação visual — só se janela não está em foco
      if (!document.hasFocus() && Notification.permission === 'granted') {
        const name = conversation?.contact_name || conversation?.phone || 'Mensagem nova';
        const body = message?.body || '📎 Ficheiro';
        const n = new Notification(name, {
          body: body.length > 80 ? body.slice(0, 80) + '…' : body,
          icon: '/favicon.ico',
          tag: `conv-${conversation?.id}`,
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }

    function onSlaAlert({ contact_name, sla_minutes, conversation_id }) {
      playNotificationSound();
      if (Notification.permission === 'granted') {
        const n = new Notification(`⏰ SLA ultrapassado — ${contact_name}`, {
          body: `Sem resposta há mais de ${sla_minutes} minutos.`,
          icon: '/favicon.ico',
          tag: `sla-${conversation_id}`,
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }

    function onMentionNew({ message, conversation, mentioned_by }) {
      playMentionSound();
      if (Notification.permission === 'granted') {
        const n = new Notification(`📌 ${mentioned_by} mencionou-te`, {
          body: `Em "${conversation?.contact_name || conversation?.phone}": ${(message?.body || '').slice(0, 80)}`,
          icon: '/favicon.ico',
          tag: `mention-${message?.id}`,
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }

    function onMuteChange({ conversation_id, muted }) {
      if (muted) mutedIds.current.add(conversation_id);
      else mutedIds.current.delete(conversation_id);
    }

    socket.on('message:new', onNewMessage);
    socket.on('message:incoming', onNewMessage);
    socket.on('mention:new', onMentionNew);
    socket.on('sla:alert', onSlaAlert);
    socket.on('conversation:mute_change', onMuteChange);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:incoming', onNewMessage);
      socket.off('mention:new', onMentionNew);
      socket.off('sla:alert', onSlaAlert);
      socket.off('conversation:mute_change', onMuteChange);
    };
  }, [socket, selectedConv?.id]);
}
