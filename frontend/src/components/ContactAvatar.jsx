import { useEffect, useState } from 'react';
import api from '../api';

// Cache de URLs por contact_id na sessão do browser. Evita refetch em
// re-renders (lista de conversas que actualiza com cada socket event).
const cache = new Map(); // contact_id -> { url, ts }
const TTL = 6 * 60 * 60 * 1000;

export default function ContactAvatar({ contactId, name, phone, size = 36, style, fallbackColor, fallbackBg }) {
  const [url, setUrl] = useState(() => {
    const c = contactId && cache.get(contactId);
    return c && (Date.now() - c.ts) < TTL ? c.url : null;
  });
  const initial = (name || phone || '?')[0].toUpperCase();

  useEffect(() => {
    if (!contactId) return;
    const c = cache.get(contactId);
    if (c && (Date.now() - c.ts) < TTL) {
      setUrl(c.url);
      return;
    }
    let cancelled = false;
    api.get(`/contacts/${contactId}/avatar`)
      .then(r => {
        if (cancelled) return;
        cache.set(contactId, { url: r.data?.url || null, ts: Date.now() });
        setUrl(r.data?.url || null);
      })
      .catch(() => {
        cache.set(contactId, { url: null, ts: Date.now() });
      });
    return () => { cancelled = true; };
  }, [contactId]);

  const baseStyle = {
    width: size, height: size, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: size * 0.4, flexShrink: 0,
    overflow: 'hidden',
    background: fallbackBg || 'var(--accent-l)',
    color: fallbackColor || 'var(--accent)',
    ...style,
  };

  if (url) {
    return (
      <div style={baseStyle}>
        <img
          src={url}
          alt={name || phone || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => {
            // CDN URL pode expirar — invalida cache e mostra inicial
            if (contactId) cache.delete(contactId);
            e.target.style.display = 'none';
            setUrl(null);
          }}
        />
      </div>
    );
  }
  return <div style={baseStyle}>{initial}</div>;
}
