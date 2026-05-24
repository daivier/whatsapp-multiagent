import { useCallback, useEffect, useState } from 'react';
import api from '../api';

// Converte a chave VAPID base64-url para Uint8Array que o PushManager exige.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(safe);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Gerencia subscription a Web Push notifications.
 *
 * Estados possíveis:
 *   unsupported    — browser não tem PushManager (Safari antigo, etc)
 *   denied         — utilizador negou permissão de notificações
 *   unavailable    — backend sem VAPID configurado (503 em /push/vapid-key)
 *   inactive       — tudo OK mas não está subscrito (mostrar botão "Ativar")
 *   active         — subscrito; push vai chegar
 *   loading        — a verificar estado
 */
export function usePushSubscription() {
  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;

  const [status, setStatus] = useState(supported ? 'loading' : 'unsupported');
  const [busy, setBusy] = useState(false);

  // Verifica estado actual ao montar
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === 'denied') return setStatus('denied');
        if (sub) return setStatus('active');
        // Confirmar que backend tem VAPID configurado
        try {
          await api.get('/push/vapid-key');
          setStatus('inactive');
        } catch (err) {
          setStatus(err.response?.status === 503 ? 'unavailable' : 'inactive');
        }
      } catch {
        setStatus('inactive');
      }
    })();
    return () => { cancelled = true; };
  }, [supported]);

  const enable = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus(perm === 'denied' ? 'denied' : 'inactive'); return; }

      const { data } = await api.get('/push/vapid-key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key),
      });
      await api.post('/push/subscribe', sub.toJSON());
      setStatus('active');
    } catch (err) {
      console.error('[push] enable falhou:', err);
      alert('Não foi possível activar notificações: ' + (err.response?.data?.error || err.message));
      setStatus('inactive');
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  const disable = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setStatus('inactive');
    } catch (err) {
      console.error('[push] disable falhou:', err);
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  return { status, busy, enable, disable };
}
