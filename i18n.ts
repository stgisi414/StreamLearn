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
import arJSON from './locales/ar.json';
import ruJSON from './locales/ru.json';
import hiJSON from './locales/hi.json';
import plJSON from './locales/pl.json';
import viJSON from './locales/vi.json';
import ptJSON from './locales/pt.json';
import idJSON from './locales/id.json';
import thJSON from './locales/th.json';

const resources = {
  en: { ...enJSON },
  es: { ...esJSON },
  fr: { ...frJSON },
  de: { ...deJSON },
  it: { ...itJSON },
  ko: { ...koJSON },
  ja: { ...jaJSON },
  zh: { ...zhJSON },
  ar: { ...arJSON },
  ru: { ...ruJSON },
  hi: { ...hiJSON },
  pl: { ...plJSON },
  vi: { ...viJSON },
  pt: { ...ptJSON },
  id: { ...idJSON },
  th: { ...thJSON },
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