import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enJSON from './locales/en.json';
import esJSON from './locales/es.json';
import frJSON from './locales/fr.json';
import deJSON from './locales/de.json';
import itJSON from './locales/it.json';
import koJSON from './locales/ko.json';
import jaJSON from './locales/ja.json';
import zhJSON from './locales/zh.json';

const resources = {
  en: { ...enJSON },
  es: { ...esJSON },
  fr: { ...frJSON },
  de: { ...deJSON },
  it: { ...itJSON },
  ko: { ...koJSON },
  ja: { ...jaJSON },
  zh: { ...zhJSON },
};

i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    resources,
    lng: 'en', // default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    react: {
      // Turn off suspense for simplicity for now
      // (we'll add it back in index.tsx)
      useSuspense: true, 
    }
  });

export default i18n;