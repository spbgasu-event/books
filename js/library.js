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
    const curChap = chaps[prog.chapIdx];
    const chapParas = curChap ? curChap.content.split(/\n{2,}/).filter(p => p.trim().length > 0).length : 1;
    const chapRatio = Math.min(1, (prog.paraIdx || 0) / Math.max(1, chapParas));
    const overallPct = Math.round(((prog.chapIdx + chapRatio) / total) * 100);
    const hasBoth = b.enChaps && b.ruChaps;
    const aligned = b.alignment && b.alignment.pairs && b.alignment.pairs.length;
    return `<div class="book-card" onclick="openBook('${b.id}')">
      <div class="book-actions">
        ${hasBoth ? `<button class="ca-btn ${aligned?'aligned':''}" title="Сведение глав" onclick="event.stopPropagation();openAlign('${b.id}')">⇄</button>` : ''}
        <button class="ca-btn" title="Сбросить прогресс" onclick="event.stopPropagation();resetBookProgress('${b.id}')">↺</button>
        <button class="ca-btn del" title="Удалить" onclick="event.stopPropagation();deleteBook('${b.id}')">✕</button>
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
  const nameEl = document.getElementById(nameId);
  nameEl.textContent = '⏳ Читаю ' + file.name + '...';

  try {
    if (ext === 'txt'){
      const text = await readTxt(file);
      if (!text || text.trim().length < 50) throw new Error('Файл пустой');
      newBook[lang] = { kind:'text', text };
    }
    else if (ext === 'epub'){
      // EPUB сразу даёт готовые главы — не нужен авторазбор по разделителю
      const result = await readEpubChapters(file, (p) => {
        nameEl.textContent = '⏳ ' + file.name + ' (' + Math.round(p * 100) + '%)';
      });
      newBook[lang] = { kind:'chapters', chapters: result.chapters };
    }
    else if (ext === 'fb2'){
      const text = await readFb2(file);
      if (!text || text.trim().length < 50) throw new Error('Файл пустой');
      newBook[lang] = { kind:'text', text };
    }
    else {
      showToast('Формат не поддерживается: .' + ext);
      nameEl.textContent = '';
      return;
    }

    const summary = newBook[lang].kind === 'chapters'
      ? `${newBook[lang].chapters.length} глав`
      : Math.round(newBook[lang].text.length / 1000) + 'KB';
    nameEl.textContent = '✓ ' + file.name + ' (' + summary + ')';
  } catch(e){
    console.error(e);
    showToast('Ошибка чтения: ' + e.message);
    nameEl.textContent = '';
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

    // Если EPUB вернул главы — используем их. Если TXT/FB2 — раскладываем сами.
    const enChaps = newBook.en
      ? (newBook.en.kind === 'chapters' ? newBook.en.chapters : parseChaps(newBook.en.text, sep))
      : null;
    const ruChaps = newBook.ru
      ? (newBook.ru.kind === 'chapters' ? newBook.ru.chapters : parseChaps(newBook.ru.text, sep))
      : null;

    // Защита от слишком больших книг — рекомендуем сократить
    const totalChaps = (enChaps?.length || 0) + (ruChaps?.length || 0);
    if (totalChaps > 800){
      if (!confirm(`Книга очень большая (${totalChaps} глав). Это может тормозить. Продолжить?`)) return;
    }

    const book = {
      id: Date.now().toString(),
      title,
      author: document.getElementById('nbAuthor').value.trim(),
      enChaps,
      ruChaps,
      progress: {chapIdx:0, lang: enChaps ? 'en' : 'ru', paraIdx:0},
      // Связи глав между языками (заполняются через экран Align)
      alignment: null,
      addedAt: Date.now()
    };
    S.books.push(book);
    await saveBook(book);
    closeOverlay('addBookOverlay');
    renderLibrary();
    showToast('Книга добавлена ✓');

    // Если оба языка загружены — предлагаем сразу сделать align
    if (enChaps && ruChaps && enChaps.length !== ruChaps.length){
      setTimeout(() => {
        if (confirm(`У книги разное число глав: EN ${enChaps.length}, RU ${ruChaps.length}. Открыть сведение глав сейчас?`)){
          openAlign(book.id);
        }
      }, 400);
    }
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

async function resetBookProgress(id){
  const book = S.books.find(b => b.id === id);
  if (!book) return;
  if (!confirm('Сбросить прогресс? Откроется с начала первой главы.')) return;
  book.progress = {chapIdx:0, lang: book.enChaps ? 'en' : 'ru', paraIdx:0};
  await saveBook(book);
  renderLibrary();
  showToast('Прогресс сброшен');
}
