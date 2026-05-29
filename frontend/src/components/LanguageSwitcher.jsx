import { useTranslation } from 'react-i18next';

const LANGS = [
  { code: 'pt', label: '🇵🇹 PT' },
  { code: 'es', label: '🇪🇸 ES' },
  { code: 'en', label: '🇬🇧 EN' },
];

export default function LanguageSwitcher({ compact = false, style }) {
  const { i18n } = useTranslation();
  const current = i18n.language?.split('-')[0] || 'pt';
  return (
    <select
      value={current}
      onChange={e => i18n.changeLanguage(e.target.value)}
      title="Idioma"
      style={{
        padding: '0.2rem 0.4rem',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        background: 'var(--card)',
        color: 'var(--text)',
        fontSize: compact ? '0.7rem' : '0.78rem',
        cursor: 'pointer',
        flexShrink: 0,
        ...style,
      }}>
      {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );
}
