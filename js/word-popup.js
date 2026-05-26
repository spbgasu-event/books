'use strict';

/**
 * Попап перевода — открывается при тапе по слову в читалке.
 * Хранит текущий выбор: какое слово, какой контекст, какой LLM-результат.
 */
let wCur = {
  word: null,
  sentence: null,
  lexRes: null,
  el: null,
  paraIdx: 0
};

function handleWordTap(el){
  // Визуальная подсветка тапа
  document.querySelectorAll('.r-word.tap-flash').forEach(e => e.classList.remove('tap-flash'));
  el.classList.add('tap-flash');
  setTimeout(() => el.classList.remove('tap-flash'), 250);

  const word = el.dataset.w;
  const paraIdx = parseInt(el.dataset.p);

  // Достаём предложение с этим словом из исходной главы — это контекст для попапа и карточки
  const chap = getCurrentChapter();
  const rawParas = chap.content.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  const para = rawParas[paraIdx] || '';
  const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
  let sentence = para;
  for (const s of sentences){
    if (s.toLowerCase().includes(word.toLowerCase())){
      sentence = s.trim();
      break;
    }
  }

  wCur = { word, sentence, lexRes:null, el, paraIdx };

  // Если слово уже в словаре — показываем сразу сохранённый результат
  const existing = S.words.find(w =>
    (w.word||'').toLowerCase() === word.toLowerCase() && w.bookId === R.bookId
  );
  if (existing) wCur.lexRes = existing.fullResult;

  showWordPopup(existing);
}

function showWordPopup(existing){
  const popup = document.getElementById('wPopup');
  const word = wCur.word;
  const tr = existing?.translation || existing?.fullResult?.meanings?.[0]?.translation || '';
  const trc = existing?.fullResult?.transcription || '';
  const ctx = wCur.sentence;

  popup.innerHTML = `
    <div class="wp-word">${escapeHtml(word)}</div>
    ${trc ? `<div class="wp-det">${escapeHtml(trc)}</div>` : ''}
    ${tr ? `<div class="wp-tr">${escapeHtml(tr)}</div>` : ''}
    <div class="wp-ctx">${escapeHtml(ctx)}</div>
    <div class="wp-actions">
      <button class="wp-btn pr" onclick="translateWord()" id="wpTransBtn">${tr ? 'Обновить' : 'Перевести'}</button>
      <button class="wp-btn ${existing?'saved':''}" onclick="saveWordFromPopup()" id="wpSaveBtn">${existing ? '✓ В словаре' : '+ В словарь'}</button>
      <button class="wp-btn" onclick="closeWPopup()">Закрыть</button>
    </div>
  `;
  popup.classList.add('open');
}

function closeWPopup(){
  document.getElementById('wPopup').classList.remove('open');
}

async function translateWord(){
  const word = wCur.word;
  if (!word) return;

  const btn = document.getElementById('wpTransBtn');
  btn.innerHTML = '<span class="wp-loader"></span>';

  try {
    const r = await callLLM(buildWordPrompt(word));
    wCur.lexRes = r;

    const popup = document.getElementById('wPopup');
    const tr = r.meanings?.[0]?.translation || '';
    const trc = r.transcription || '';
    const example = r.meanings?.[0]?.example_original || '';
    const exampleTr = r.meanings?.[0]?.example_translated || '';

    popup.innerHTML = `
      <div class="wp-word">${escapeHtml(word)}</div>
      ${trc ? `<div class="wp-det">${escapeHtml(trc)} · ${escapeHtml(r.meanings?.[0]?.pos || '')}</div>` : ''}
      <div class="wp-tr"><strong>${escapeHtml(tr)}</strong></div>
      <div class="wp-ctx">${escapeHtml(wCur.sentence)}</div>
      ${example ? `<div class="wp-ctx" style="border-left:2px solid var(--accent);">${escapeHtml(example)}<br><em style="color:var(--muted);font-size:11px;">${escapeHtml(exampleTr)}</em></div>` : ''}
      <div class="wp-actions">
        <button class="wp-btn pr" onclick="translateWord()">Обновить</button>
        <button class="wp-btn" onclick="saveWordFromPopup()" id="wpSaveBtn">+ В словарь</button>
        <button class="wp-btn" onclick="closeWPopup()">Закрыть</button>
      </div>
    `;
  } catch(err){
    btn.textContent = 'Ошибка';
    showToast(err.message);
    setTimeout(() => { btn.textContent = 'Перевести'; }, 2000);
  }
}

async function saveWordFromPopup(){
  const word = wCur.word;
  if (!word) return;

  const existingIdx = S.words.findIndex(w =>
    (w.word||'').toLowerCase() === word.toLowerCase() && w.bookId === R.bookId
  );
  if (existingIdx >= 0){
    showToast('Слово уже в словаре');
    return;
  }

  const r = wCur.lexRes;
  const book = S.books.find(b => b.id === R.bookId);
  const newWord = {
    id: Date.now().toString() + '_' + Math.random().toString(36).slice(2,7),
    word,
    bookId: R.bookId,
    bookTitle: book?.title || '',
    context: wCur.sentence,
    chapIdx: R.chapIdx,
    lang: R.lang,
    translation: r?.meanings?.[0]?.translation || '',
    fullResult: r || null,
    srs: initSRS(),
    addedAt: Date.now()
  };

  S.words.unshift(newWord);
  await saveWord(newWord);

  // Сразу подсвечиваем все вхождения этого слова в тексте
  document.querySelectorAll(`.r-word[data-w="${word.replace(/"/g,'\\"')}"]`).forEach(el => {
    el.classList.add('saved', 'learning');
  });

  document.getElementById('wpSaveBtn').textContent = '✓ В словаре';
  document.getElementById('wpSaveBtn').classList.add('saved');
  updateNavBadges();
  showToast('Сохранено в словарь ✓');
}
