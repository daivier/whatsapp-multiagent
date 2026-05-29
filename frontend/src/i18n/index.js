/**
 * i18n setup — PT (default) / ES / EN.
 *
 * Detecção automática pelo browser; pode ser sobreposto via dropdown
 * que guarda em localStorage. Fallback PT-PT.
 *
 * Uso nos componentes:
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *   <button>{t('common.save')}</button>
 *
 * Para adicionar uma chave nova, edita os 3 ficheiros pt.json/es.json/en.json
 * (mantém estrutura coerente).
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import pt from './locales/pt.json';
import es from './locales/es.json';
import en from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      es: { translation: es },
      en: { translation: en },
    },
    fallbackLng: 'pt',
    supportedLngs: ['pt', 'es', 'en'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
