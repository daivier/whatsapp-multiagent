import { usePushSubscription } from '../hooks/usePushSubscription';

/**
 * Botão de toggle de notificações push. Esconde-se sozinho quando o browser
 * não suporta ou o servidor não tem VAPID configurado.
 */
export default function PushNotificationsButton({ compact = false }) {
  const { status, busy, enable, disable } = usePushSubscription();

  if (status === 'unsupported' || status === 'unavailable' || status === 'loading') return null;

  if (status === 'denied') {
    return (
      <button
        disabled
        title="Notificações bloqueadas — vai a Definições do browser para reactivar"
        style={btn(false, true)}
      >
        🔕{compact ? '' : ' Bloqueado'}
      </button>
    );
  }

  const active = status === 'active';
  return (
    <button
      onClick={active ? disable : enable}
      disabled={busy}
      title={active
        ? 'Notificações activas — clica para desactivar neste device'
        : 'Receber notificações no telemóvel mesmo com browser fechado'}
      style={btn(active, false)}
    >
      {active ? '🔔' : '🔕'}{compact ? '' : (active ? ' Notif.' : ' Activar')}
    </button>
  );
}

const btn = (active, denied) => ({
  padding: '0.3rem 0.65rem',
  borderRadius: 'var(--r-sm)',
  border: `1px solid ${denied ? 'var(--border-m)' : active ? 'var(--success)' : 'var(--border-m)'}`,
  background: active ? 'var(--success)' : 'none',
  color: denied ? 'var(--hint)' : active ? '#fff' : 'var(--muted)',
  cursor: denied ? 'not-allowed' : 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  flexShrink: 0,
});
