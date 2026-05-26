'use strict';

/**
 * Читалка в постраничном режиме (как в eBoox).
 *
 * Идея пагинации: измеряем реальные размеры абзацев в скрытом контейнере
 * той же ширины, что и страница. Накапливаем абзацы пока влезают по высоте.
 * Как только перестали влезать — закрываем страницу, начинаем новую.
 *
 * Длинный абзац (длиннее одной страницы) режется по предложениям.
 *
 * Якорь (anchor) — доля прочитанной части главы [0..1]. Используем его
 * для сохранения позиции при переключении языка: попадаем в ту же относительную
 * точку в переведённой главе.
 */

let toolbarHidden = false;
let touchStartX = 0, touchStartY = 0, touchStartT = 0;

function openBook(id){
  const b = S.books.find(x => x.id === id);
  if (!b) return;

  R.bookId = id;
  const prog = b.progress || {chapIdx:0, lang:'en', paraIdx:0, anchorRatio:0};
  R.lang = prog.lang || (b.enChaps ? 'en' : 'ru');
  R.chapIdx = prog.chapIdx || 0;

  document.getElementById('rTitle').textContent = b.title;
  document.getElementById('readerPage').classList.add('active');
  document.body.classList.add('reading');
  updateLangToggle();

  // Откладываем рендер чтобы CSS успел применить размеры контейнера
  requestAnimationFrame(() => {
    paginateCurrentChapter();
    // Если сохранён paraIdx — используем его (точное возвращение на страницу).
    // Если нет — fallback на anchorRatio (старая запись или после смены языка).
    if (typeof prog.paraIdx === 'number'){
      R.pageIdx = paraIdxToPageIndex(prog.paraIdx);
    } else {
      R.pageIdx = anchorRatioToPageIndex(prog.anchorRatio || 0);
    }
    renderCurrentPage();
  });
}

function closeReader(){
  saveProgress();
  document.getElementById('readerPage').classList.remove('active');
  document.body.classList.remove('reading');
  closeWPopup();
  renderLibrary();
}

function updateLangToggle(){
  const book = S.books.find(b => b.id === R.bookId);
  const enBtn = document.querySelector('.lt-btn.en');
  const ruBtn = document.querySelector('.lt-btn.ru');
  enBtn.classList.toggle('active', R.lang === 'en');
  ruBtn.classList.toggle('active', R.lang === 'ru');
  enBtn.style.opacity = book?.enChaps ? '1' : '0.3';
  ruBtn.style.opacity = book?.ruChaps ? '1' : '0.3';
}

function getChaps(book, lang){
  return (lang === 'en' ? book.enChaps : book.ruChaps) || [];
}

function getCurrentChapter(){
  const book = S.books.find(b => b.id === R.bookId);
  const chaps = getChaps(book, R.lang);
  const i = Math.max(0, Math.min(chaps.length - 1, R.chapIdx));
  return chaps[i];
}

/**
 * Главный алгоритм пагинации.
 * Раскладывает текущую главу на массив страниц R.pages.
 */
function paginateCurrentChapter(){
  const chap = getCurrentChapter();
  if (!chap){ R.pages = []; return; }

  const pager = document.getElementById('rPager');
  const w = pager.clientWidth;
  const h = pager.clientHeight;
  const padX = 22 * 2;
  const padY = 24 * 2;
  const availH = h - padY;
  const availW = w - padX;
  const fontSize = S.settings.readerFontSize || 18;

  const rawParas = chap.content
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Скрытый измеритель — точно такие же параметры стилей, как у .r-page
  const meas = document.createElement('div');
  meas.style.cssText = `
    position:absolute; visibility:hidden; pointer-events:none;
    width:${availW}px; left:-9999px; top:0;
    font-family:'Lora',serif; line-height:1.65;
    font-size:${fontSize}px;
  `;
  document.body.appendChild(meas);

  const pages = [];
  let pageBuffer = [];
  let pageStartIdx = 0;
  let titleHtml = `<h2 class="chap-title">${escapeHtml(chap.title || 'Глава')}</h2>`;

  function flushPage(endIdx){
    pages.push({
      html: (pageStartIdx === 0 ? titleHtml : '') + pageBuffer.join(''),
      paraFrom: pageStartIdx,
      paraTo: endIdx,
    });
    pageStartIdx = endIdx;
    pageBuffer = [];
    titleHtml = ''; // только первая страница главы содержит заголовок
  }

  for (let i = 0; i < rawParas.length; i++){
    const pHtml = `<p>${wrapWords(rawParas[i], i)}</p>`;
    pageBuffer.push(pHtml);
    meas.innerHTML = (pageStartIdx === 0 ? titleHtml : '') + pageBuffer.join('');

    if (meas.scrollHeight > availH){
      pageBuffer.pop(); // откатываем последний параграф

      if (pageBuffer.length === 0){
        // Параграф длиннее страницы — режем по предложениям
        const sentences = rawParas[i].match(/[^.!?]+[.!?]+|\S+/g) || [rawParas[i]];
        let sBuf = '';
        for (const s of sentences){
          const test = sBuf + s + ' ';
          meas.innerHTML = (pageStartIdx === 0 ? titleHtml : '') + `<p>${wrapWords(test.trim(), i)}</p>`;
          if (meas.scrollHeight > availH && sBuf){
            pageBuffer = [`<p>${wrapWords(sBuf.trim(), i)}</p>`];
            flushPage(i);
            pageStartIdx = i;
            sBuf = s + ' ';
          } else {
            sBuf = test;
          }
        }
        if (sBuf.trim()){
          pageBuffer = [`<p>${wrapWords(sBuf.trim(), i)}</p>`];
        }
        continue;
      }

      flushPage(i);
      pageBuffer = [pHtml]; // следующая страница начинается с этого параграфа
    }
  }
  if (pageBuffer.length > 0) flushPage(rawParas.length);

  document.body.removeChild(meas);

  R.pages = pages.length ? pages : [{html:titleHtml + '<p>(пустая глава)</p>', paraFrom:0, paraTo:0}];
  R.totalParas = rawParas.length || 1;
}

/**
 * Оборачиваем каждое слово в span — чтобы тапать по нему.
 * Подсвечиваем уже сохранённые слова в зависимости от состояния SRS.
 */
function wrapWords(text, paraIdx){
  return text.replace(/([A-Za-zА-Яа-яЁёA-Za-z'\-]+)/g, (m) => {
    const wordKey = m.toLowerCase();
    const saved = S.words.find(w =>
      (w.word||'').toLowerCase() === wordKey && w.bookId === R.bookId
    );
    const classes = ['r-word'];
    if (saved){
      classes.push('saved');
      const state = (saved.srs && saved.srs.interval > 21) ? 'review' : 'learning';
      classes.push(state);
    }
    return `<span class="${classes.join(' ')}" data-w="${escapeHtml(m)}" data-p="${paraIdx}">${escapeHtml(m)}</span>`;
  });
}

function renderCurrentPage(){
  if (!R.pages.length) return;
  R.pageIdx = Math.max(0, Math.min(R.pages.length - 1, R.pageIdx));
  const page = R.pages[R.pageIdx];
  const el = document.getElementById('rPage');
  el.style.fontSize = (S.settings.readerFontSize || 18) + 'px';
  el.innerHTML = page.html;
  updateReaderFoot();
  saveProgress();
}

function updateReaderFoot(){
  const book = S.books.find(b => b.id === R.bookId);
  const chaps = getChaps(book, R.lang);
  document.getElementById('rFootChap').textContent = `Гл. ${R.chapIdx+1}/${chaps.length}`;
  document.getElementById('rFootPage').textContent = `${R.pageIdx+1} / ${R.pages.length}`;
  const ratio = R.pages.length > 1 ? (R.pageIdx / (R.pages.length-1)) : 0;
  const totalPct = ((R.chapIdx + ratio) / Math.max(1, chaps.length)) * 100;
  document.getElementById('rFootProgFill').style.width = totalPct + '%';
}

/**
 * Якорь — индекс первого видимого абзаца на текущей странице (внутри главы).
 * Это значение надёжно: открываешь книгу — попадаешь на ту страницу, где остался.
 * При переключении языка — попадаешь в ту же относительную точку.
 */
function currentAnchor(){
  if (!R.pages.length) return 0;
  const page = R.pages[R.pageIdx];
  return page ? (page.paraFrom || 0) : 0;
}

/**
 * Доля прочитанного [0..1] — нужна для переключения языков
 * (т.к. в RU-главе число абзацев другое, а доля сохраняется).
 */
function currentAnchorRatio(){
  if (!R.pages.length || !R.totalParas) return 0;
  const para = currentAnchor();
  return Math.min(0.999, para / R.totalParas);
}

/**
 * Находит страницу, на которой находится абзац с заданным индексом.
 */
function paraIdxToPageIndex(paraIdx){
  if (!R.pages.length) return 0;
  let bestIdx = 0;
  for (let i = 0; i < R.pages.length; i++){
    if (R.pages[i].paraFrom <= paraIdx) bestIdx = i;
    else break;
  }
  return bestIdx;
}

/**
 * При переключении языка — переводим долю в номер абзаца новой главы.
 */
function anchorRatioToPageIndex(ratio){
  if (!R.pages.length) return 0;
  const targetPara = Math.floor((ratio || 0) * (R.totalParas || 1));
  return paraIdxToPageIndex(targetPara);
}

/** Алиас для обратной совместимости */
function anchorToPageIndex(ratio){
  return anchorRatioToPageIndex(ratio);
}

function nextPage(){
  if (R.pageIdx + 1 < R.pages.length){
    R.pageIdx++;
    renderCurrentPage();
  } else {
    // Конец главы — переходим к следующей
    const book = S.books.find(b => b.id === R.bookId);
    const chaps = getChaps(book, R.lang);
    if (R.chapIdx + 1 < chaps.length){
      R.chapIdx++;
      paginateCurrentChapter();
      R.pageIdx = 0;
      renderCurrentPage();
    }
  }
}

function prevPage(){
  if (R.pageIdx > 0){
    R.pageIdx--;
    renderCurrentPage();
  } else {
    if (R.chapIdx > 0){
      R.chapIdx--;
      paginateCurrentChapter();
      R.pageIdx = R.pages.length - 1;
      renderCurrentPage();
    }
  }
}

/**
 * Переключение языка — сохраняем долю прочитанного, меняем язык, репагинируем,
 * прыгаем на ту же относительную позицию в новой главе.
 */
function switchReaderLang(lang){
  const book = S.books.find(b => b.id === R.bookId);
  if (!book) return;
  const target = (lang === 'en') ? book.enChaps : book.ruChaps;
  if (!target || !target.length){
    showToast('Нет текста на этом языке');
    return;
  }

  const ratio = currentAnchorRatio();
  R.lang = lang;

  const chaps = getChaps(book, lang);
  if (R.chapIdx >= chaps.length) R.chapIdx = chaps.length - 1;

  updateLangToggle();
  paginateCurrentChapter();
  R.pageIdx = anchorRatioToPageIndex(ratio);
  renderCurrentPage();
  closeWPopup();
}

async function saveProgress(){
  const book = S.books.find(b => b.id === R.bookId);
  if (!book) return;
  // Защита: если страницы ещё не сверстаны — не перезаписываем прогресс
  if (!R.pages.length) return;

  book.progress = {
    chapIdx: R.chapIdx,
    lang: R.lang,
    paraIdx: currentAnchor(),         // индекс первого абзаца на странице
    anchorRatio: currentAnchorRatio(), // для переключения языков
    updatedAt: Date.now()
  };
  await saveBook(book);
}

function adjustReaderFont(delta){
  const newSize = Math.max(13, Math.min(28, (S.settings.readerFontSize || 18) + delta));
  saveSetting('readerFontSize', newSize);
  document.getElementById('readerFontLabel').textContent = newSize;
  const el2 = document.getElementById('readerFontLabel2');
  if (el2) el2.textContent = newSize;

  if (document.getElementById('readerPage').classList.contains('active')){
    const ratio = currentAnchorRatio();
    paginateCurrentChapter();
    R.pageIdx = anchorRatioToPageIndex(ratio);
    renderCurrentPage();
  }
}

/**
 * Жесты в читалке — свайп влево/вправо и тап-зоны по краям.
 */
function setupReaderGestures(){
  const pager = document.getElementById('rPager');

  pager.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartT = Date.now();
  }, {passive:true});

  pager.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dt = Date.now() - touchStartT;
    if (dt < 600 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5){
      if (dx < 0) nextPage(); else prevPage();
    }
  }, {passive:true});

  document.getElementById('rTapLeft').addEventListener('click', (e) => {
    e.stopPropagation(); prevPage();
  });
  document.getElementById('rTapRight').addEventListener('click', (e) => {
    e.stopPropagation(); nextPage();
  });

  // Тап по странице (не по слову) — прячем/показываем тулбары
  document.getElementById('rPage').addEventListener('click', (e) => {
    const target = e.target.closest('.r-word');
    if (!target){
      toggleToolbar();
      return;
    }
    handleWordTap(target);
  });
}

function toggleToolbar(){
  toolbarHidden = !toolbarHidden;
  document.getElementById('rToolbar').classList.toggle('hidden', toolbarHidden);
  document.getElementById('rFoot').classList.toggle('hidden', toolbarHidden);
}

function openReaderMenu(){
  const book = S.books.find(b => b.id === R.bookId);
  const chaps = getChaps(book, R.lang);
  document.getElementById('rmCurrentChap').textContent =
    chaps[R.chapIdx]?.title || ('Глава ' + (R.chapIdx+1));
  document.getElementById('readerMenuOverlay').classList.add('open');
}

function openChapPicker(){
  closeOverlay('readerMenuOverlay');
  const book = S.books.find(b => b.id === R.bookId);
  const chaps = getChaps(book, R.lang);
  const list = document.getElementById('chapPickerList');
  list.innerHTML = chaps.map((c, i) => `
    <button class="btn-sec"
      style="text-align:left;justify-content:flex-start;${i===R.chapIdx?'border-color:var(--accent);':''}"
      onclick="jumpToChap(${i})">
      ${i+1}. ${escapeHtml(c.title || 'Без названия')}
    </button>
  `).join('');
  document.getElementById('chapPickerOverlay').classList.add('open');
}

function jumpToChap(i){
  R.chapIdx = i;
  paginateCurrentChapter();
  R.pageIdx = 0;
  renderCurrentPage();
  closeOverlay('chapPickerOverlay');
}
