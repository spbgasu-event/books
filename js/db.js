'use strict';

/**
 * IndexedDB слой.
 * Одна БД с тремя object stores: books, words, settings.
 * IndexedDB вместо localStorage потому что:
 *  — limit localStorage 5–10 МБ (книги быстро его пробьют)
 *  — IndexedDB поддерживает сотни МБ
 *  — асинхронный API, не блокирует UI на больших операциях
 */
const DB_NAME = 'linguaread-db';
const DB_VERSION = 1;
let dbInstance = null;

function openDB(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => rej(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books'))    db.createObjectStore('books',    {keyPath:'id'});
      if (!db.objectStoreNames.contains('words'))    db.createObjectStore('words',    {keyPath:'id'});
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', {keyPath:'key'});
    };
    req.onsuccess = () => { dbInstance = req.result; res(dbInstance); };
  });
}

function tx(store, mode = 'readonly'){
  return dbInstance.transaction(store, mode).objectStore(store);
}

function dbGetAll(store){
  return new Promise((res, rej) => {
    const req = tx(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
function dbGet(store, key){
  return new Promise((res, rej) => {
    const req = tx(store).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}
function dbPut(store, value){
  return new Promise((res, rej) => {
    const req = tx(store, 'readwrite').put(value);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function dbDel(store, key){
  return new Promise((res, rej) => {
    const req = tx(store, 'readwrite').delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
function dbClear(store){
  return new Promise((res, rej) => {
    const req = tx(store, 'readwrite').clear();
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

/**
 * Миграция с прошлой версии (если когда-то использовался localStorage).
 * Безопасно вызывать всегда — если данных нет, просто ничего не делает.
 */
async function migrateFromLocalStorage(){
  const oldData = localStorage.getItem('linguaread_data');
  if (!oldData) return;
  try {
    const parsed = JSON.parse(oldData);
    if (parsed.books)
      for (const b of parsed.books) await dbPut('books', b);
    if (parsed.words)
      for (const w of parsed.words) await dbPut('words', w);
    if (parsed.settings){
      for (const [k, v] of Object.entries(parsed.settings)){
        await dbPut('settings', {key:k, value:v});
      }
    }
    localStorage.removeItem('linguaread_data');
    showToast('Данные перенесены в новое хранилище ✓');
  } catch(e){
    console.warn('Миграция не удалась:', e);
  }
}

async function loadFromDB(){
  S.books = await dbGetAll('books');
  S.words = await dbGetAll('words');
  const settingsArr = await dbGetAll('settings');
  for (const s of settingsArr) S.settings[s.key] = s.value;
  S.settings.apiModel = S.settings.apiModel || 'mistral';
  S.settings.apiKey = S.settings.apiKey || '';
  S.settings.readerFontSize = S.settings.readerFontSize || 18;
}

async function saveBook(b){ await dbPut('books', b); }
async function saveWord(w){ await dbPut('words', w); }
async function saveSetting(key, value){
  S.settings[key] = value;
  await dbPut('settings', {key, value});
}
