'use strict';

function loadSettingsUI(){
  document.getElementById('apiKey').value = S.settings.apiKey || '';
  document.getElementById('apiModel').value = S.settings.apiModel || 'mistral';
  document.getElementById('readerFontLabel').textContent = S.settings.readerFontSize || 18;
}

async function saveApiSettings(){
  const key = document.getElementById('apiKey').value.trim();
  const model = document.getElementById('apiModel').value;
  await saveSetting('apiKey', key);
  await saveSetting('apiModel', model);
  showToast('Настройки сохранены ✓');
}

function exportWords(){
  if (!S.words.length){ showToast('Словарь пуст'); return; }
  const txt = S.words.map(w =>
    `${w.word}${w.translation ? ' — ' + w.translation : ''}\n  "${w.context||''}"\n  [${w.bookTitle}, гл.${(w.chapIdx||0)+1}]`
  ).join('\n\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], {type:'text/plain;charset=utf-8'}));
  a.download = 'linguaread_words.txt';
  a.click();
}

async function clearAll(){
  if (!confirm('Удалить ВСЕ данные? Это необратимо.')) return;
  await dbClear('books');
  await dbClear('words');
  S.books = [];
  S.words = [];
  renderLibrary();
  renderWordsList();
  updateNavBadges();
  showToast('Всё очищено');
}

async function clearSearchCacheAction(){
  if (!confirm('Сбросить кэш умного поиска? Следующие поиски снова пойдут в API.')) return;
  await clearSearchCache();
  showToast('Кэш поиска очищен');
}
