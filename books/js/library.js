'use strict';

/**
 * Библиотека книг: рендеринг списка, добавление, удаление.
 */

let newBook = { en:null, ru:null };

function renderLibrary(){
  const g = document.getElementById('booksList');
  if (!S.books.length){
    g.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📚</div>
        <h3>Библиотека пуста</h3>
        <p>Нажми ＋, чтобы добавить книгу. Поддерживаются .txt, .epub, .fb2 на английском (и опционально на русском).</p>
      </div>`;
    return;
  }

  g.innerHTML = S.books.map(b => {
    const prog = b.progress || {chapIdx:0, lang:'en', paraIdx:0};
    const chaps = (prog.lang === 'ru' ? b.ruChaps : b.enChaps) || b.enChaps || b.ruChaps || [];
    const total = chaps.length || 1;
    // Считаем долю текущей главы по абзацам (для прогресс-бара)
    const curChap = chaps[prog.chapIdx];
    const chapParas = curChap ? curChap.content.split(/\n{2,}/).filter(p => p.trim().length > 0).length : 1;
    const chapRatio = Math.min(1, (prog.paraIdx || 0) / Math.max(1, chapParas));
    const overallPct = Math.round(((prog.chapIdx + chapRatio) / total) * 100);
    return `<div class="book-card" onclick="openBook('${b.id}')">
      <div class="book-actions">
        <button class="ca-btn del" onclick="event.stopPropagation();deleteBook('${b.id}')">✕</button>
      </div>
      <div class="book-title">${escapeHtml(b.title)}</div>
      <div class="book-author">${escapeHtml(b.author || 'Автор не указан')}</div>
      <div class="book-langs">
        <span class="lang-badge ${b.enChaps?'en':'miss'}">EN ${b.enChaps ? b.enChaps.length+' гл.' : '—'}</span>
        <span class="lang-badge ${b.ruChaps?'ru':'miss'}">RU ${b.ruChaps ? b.ruChaps.length+' гл.' : '—'}</span>
      </div>
      <div class="book-progress-bar"><div class="book-progress-fill" style="width:${overallPct}%"></div></div>
      <div class="book-meta">
        <span>Глава ${prog.chapIdx+1} / ${total}</span>
        <span>${overallPct}%</span>
      </div>
    </div>`;
  }).join('');
}

function openAddBook(){
  newBook = {en:null, ru:null};
  ['nbTitle','nbAuthor','nbSep'].forEach(id => document.getElementById(id).value = '');
  ['fdEnName','fdRuName'].forEach(id => document.getElementById(id).textContent = '');
  try {
    document.getElementById('fileEn').value = '';
    document.getElementById('fileRu').value = '';
  } catch(e){}
  document.getElementById('addBookOverlay').classList.add('open');
}

async function readFile(inputId, lang, nameId){
  const input = document.getElementById(inputId);
  if (!input?.files?.length) return;
  const file = input.files[0];
  const ext = file.name.split('.').pop().toLowerCase();
  document.getElementById(nameId).textContent = '⏳ Читаю ' + file.name + '...';

  try {
    let text = '';
    if (ext === 'txt')   text = await readTxt(file);
    else if (ext === 'epub') text = await readEpub(file);
    else if (ext === 'fb2')  text = await readFb2(file);
    else {
      showToast('Формат не поддерживается: .' + ext);
      return;
    }

    if (!text || text.trim().length < 50){
      showToast('Файл пустой или не читается');
      return;
    }

    newBook[lang] = text;
    document.getElementById(nameId).textContent =
      '✓ ' + file.name + ' (' + Math.round(text.length/1000) + 'KB)';
  } catch(e){
    console.error(e);
    showToast('Ошибка чтения: ' + e.message);
    document.getElementById(nameId).textContent = '';
  }
}

async function addBook(){
  const title = document.getElementById('nbTitle').value.trim();
  if (!title){ showToast('Введи название'); return; }
  if (!newBook.en && !newBook.ru){
    showToast('Загрузи хотя бы один файл');
    return;
  }

  try {
    const sep = document.getElementById('nbSep').value.trim();
    const book = {
      id: Date.now().toString(),
      title,
      author: document.getElementById('nbAuthor').value.trim(),
      enChaps: parseChaps(newBook.en, sep),
      ruChaps: parseChaps(newBook.ru, sep),
      progress: {chapIdx:0, lang:'en', paraIdx:0},
      addedAt: Date.now()
    };
    S.books.push(book);
    await saveBook(book);
    closeOverlay('addBookOverlay');
    renderLibrary();
    showToast('Книга добавлена ✓');
  } catch(e){
    showToast('Ошибка: ' + e.message);
    console.error(e);
  }
}

async function deleteBook(id){
  if (!confirm('Удалить книгу?')) return;
  S.books = S.books.filter(b => b.id !== id);
  await dbDel('books', id);
  renderLibrary();
}
