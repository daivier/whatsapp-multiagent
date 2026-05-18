import { useEffect } from 'react';

export function useNotifications(socket, selectedConv) {
  // Pede permissão ao montar
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    function onNewMessage({ message, conversation }) {
      // Só notifica se a janela não está em foco e não é a conversa aberta
      if (document.hasFocus()) return;
      if (conversation?.id === selectedConv?.id) return;
      if (message?.from_me) return;
      if (Notification.permission !== 'granted') return;

      const name = conversation?.contact_name || conversation?.phone || 'Mensagem nova';
      const body = message?.body || '📎 Ficheiro';

      const n = new Notification(name, {
        body: body.length > 80 ? body.slice(0, 80) + '…' : body,
        icon: '/favicon.ico',
        tag: `conv-${conversation?.id}`,   // agrupa notificações da mesma conversa
      });

      // Foca a janela ao clicar na notificação
      n.onclick = () => { window.focus(); n.close(); };
    }

    socket.on('message:new', onNewMessage);
    socket.on('message:incoming', onNewMessage);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:incoming', onNewMessage);
    };
  }, [socket, selectedConv?.id]);
}
