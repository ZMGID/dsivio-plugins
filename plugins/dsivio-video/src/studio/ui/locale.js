import { getState, update } from './state.js';
/** @type {Record<string,Record<string,string>>} */const messages={};
export async function loadLocales() {
  for(const locale of ['en','zh-CN']){const response=await fetch(`/ui/locales/${locale}.json`);if(!response.ok)throw new Error(`Locale ${locale}: HTTP ${response.status}`);messages[locale]=await response.json();}
  const en=messages.en??{},zh=messages['zh-CN']??{};
  if(Object.keys(en).some(key=>!(key in zh))||Object.keys(zh).some(key=>!(key in en)))throw new Error('Studio locale keys differ');
  for(const key of Object.keys(en)){const vars=(en[key]?.match(/\{\w+\}/g)??[]).sort().join();const translated=(zh[key]?.match(/\{\w+\}/g)??[]).sort().join();if(vars!==translated)throw new Error(`Locale variables differ for ${key}`);}
  const saved=localStorage.getItem('dsivio-video.studio.locale');const locale=saved==='en'||saved==='zh-CN'?saved:navigator.languages.some(language=>/^zh(?:-|$)/i.test(language))?'zh-CN':'en';update({locale});
}
/** @param {string} key @param {Record<string,string|number>} [variables] */
export function t(key,variables={}) {
  const message=messages[getState().locale]?.[key]??messages.en?.[key];
  if(message===undefined){console.error(`Missing Studio locale key: ${key}`);return `[${key}]`;}
  return message.replace(/\{(\w+)\}/g,(_match,name)=>{if(variables[name]===undefined){console.error(`Missing locale variable: ${key}.${name}`);return `{${name}}`;}return String(variables[name]);});
}
/** @param {'en'|'zh-CN'} locale */
export function setLocale(locale) { localStorage.setItem('dsivio-video.studio.locale',locale);document.documentElement.lang=locale;update({locale}); }
