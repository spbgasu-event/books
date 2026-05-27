'use strict';

/**
 * Модуль сведения глав (align).
 *
 * Книга может иметь поле alignment:
 * {
 *   pairs: [
 *     {en: 0, ru: 2},   // EN глава 0 = RU глава 2
 *     {en: 1, ru: 3},   // EN глава 1 = RU глава 3
 *     ...
 *   ]
 * }
 *
 * Если alignment пуст или nullable — фолбэк на «та же глава по номеру».
 *
 * Главы, не упомянутые ни в одной паре, считаются «лишними» (вступление переводчика,
 * послесловия и т.д.) и не показываются при переключении языков — но видны при чтении
 * на их «родном» языке.
 */

// ┌─────────────────────────────────────────────────────────────────┐
// │  Поиск пары для конкретной главы                                │
// └─────────────────────────────────────────────────────────────────┘

/**
 * По индексу главы и языку находит индекс парной главы в другом языке.
 * Возвращает -1 если соответствия нет.
 */
function findAlignedChapter(book, chapIdx, fromLang, toLang){
  if (fromLang === toLang) return chapIdx;
  if (!book) return -1;

  // Если есть ручной align — используем его
  if (book.alignment && Array.isArray(book.alignment.pairs)){
    const pair = book.alignment.pairs.find(p => p[fromLang] === chapIdx);
    if (pair && typeof pair[toLang] === 'number') return pair[toLang];
    return -1; // явно «нет соответствия»
  }

  // Фолбэк: одинаковая нумерация
  const toChaps = (toLang === 'en' ? book.enChaps : book.ruChaps) || [];
  if (chapIdx < toChaps.length) return chapIdx;
  return toChaps.length - 1;
}

/**
 * Авто-генерация align: главы в порядке spine привязываются 1-к-1.
 * Если число глав разное — лишние из конца отбрасываются.
 * Это начальное состояние для редактора align — пользователь дальше дотюнивает.
 */
function autoGenerateAlignment(book){
  const en = book.enChaps || [];
  const ru = book.ruChaps || [];
  const n = Math.min(en.length, ru.length);
  const pairs = [];
  for (let i = 0; i < n; i++){
    pairs.push({en:i, ru:i});
  }
  return { pairs };
}

// ┌─────────────────────────────────────────────────────────────────┐
// │  UI экрана сведения                                              │
// └─────────────────────────────────────────────────────────────────┘

let alignState = {
  bookId: null,
  pairs: [],            // текущая редактируемая таблица
  selectedEn: null,
  selectedRu: null
};

function openAlign(bookId){
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;
  if (!book.enChaps || !book.ruChaps){
    showToast('Нужны оба языка для сведения');
    return;
  }

  alignState.bookId = bookId;
  alignState.pairs = book.alignment?.pairs
    ? JSON.parse(JSON.stringify(book.alignment.pairs))
    : autoGenerateAlignment(book).pairs;
  alignState.selectedEn = null;
  alignState.selectedRu = null;

  renderAlign();
  document.getElementById('alignOverlay').classList.add('open');
}

function renderAlign(){
  const book = S.books.find(b => b.id === alignState.bookId);
  if (!book) return;

  const en = book.enChaps || [];
  const ru = book.ruChaps || [];

  // Карты для быстрой проверки «привязано ли»
  const enPaired = new Set(alignState.pairs.map(p => p.en));
  const ruPaired = new Set(alignState.pairs.map(p => p.ru));

  const enList = en.map((c, i) => {
    const paired = enPaired.has(i);
    const pair = alignState.pairs.find(p => p.en === i);
    const selected = alignState.selectedEn === i ? 'selected' : '';
    const pairedClass = paired ? 'paired' : 'unpaired';
    const pairLabel = pair ? `↔ RU ${pair.ru + 1}` : '<i>не привязано</i>';
    return `<div class="align-chap ${selected} ${pairedClass}" onclick="selectAlignChap('en',${i})">
      <div class="align-chap-num">EN ${i+1}</div>
      <div class="align-chap-title">${escapeHtml(c.title || 'Глава ' + (i+1))}</div>
      <div class="align-chap-pair">${pairLabel}</div>
    </div>`;
  }).join('');

  const ruList = ru.map((c, i) => {
    const paired = ruPaired.has(i);
    const pair = alignState.pairs.find(p => p.ru === i);
    const selected = alignState.selectedRu === i ? 'selected' : '';
    const pairedClass = paired ? 'paired' : 'unpaired';
    const pairLabel = pair ? `↔ EN ${pair.en + 1}` : '<i>не привязано</i>';
    return `<div class="align-chap ${selected} ${pairedClass}" onclick="selectAlignChap('ru',${i})">
      <div class="align-chap-num">RU ${i+1}</div>
      <div class="align-chap-title">${escapeHtml(c.title || 'Глава ' + (i+1))}</div>
      <div class="align-chap-pair">${pairLabel}</div>
    </div>`;
  }).join('');

  const canLink = alignState.selectedEn !== null && alignState.selectedRu !== null;
  const canUnlink =
    (alignState.selectedEn !== null && enPaired.has(alignState.selectedEn)) ||
    (alignState.selectedRu !== null && ruPaired.has(alignState.selectedRu));

  document.getElementById('alignBookTitle').textContent = book.title;
  document.getElementById('alignEnList').innerHTML = enList;
  document.getElementById('alignRuList').innerHTML = ruList;
  document.getElementById('alignLinkBtn').disabled = !canLink;
  document.getElementById('alignUnlinkBtn').disabled = !canUnlink;
  document.getElementById('alignCounter').textContent =
    `Связей: ${alignState.pairs.length}  ·  EN ${en.length} гл.  ·  RU ${ru.length} гл.`;
}

function selectAlignChap(lang, idx){
  if (lang === 'en'){
    alignState.selectedEn = (alignState.selectedEn === idx) ? null : idx;
  } else {
    alignState.selectedRu = (alignState.selectedRu === idx) ? null : idx;
  }
  renderAlign();
}

function alignLink(){
  const en = alignState.selectedEn, ru = alignState.selectedRu;
  if (en === null || ru === null) return;
  // Удалить старые привязки этих глав
  alignState.pairs = alignState.pairs.filter(p => p.en !== en && p.ru !== ru);
  // Добавить новую
  alignState.pairs.push({en, ru});
  // Сортируем по en для красоты
  alignState.pairs.sort((a, b) => a.en - b.en);
  // Сбрасываем выбор
  alignState.selectedEn = null;
  alignState.selectedRu = null;
  renderAlign();
}

function alignUnlink(){
  const en = alignState.selectedEn, ru = alignState.selectedRu;
  alignState.pairs = alignState.pairs.filter(p => {
    if (en !== null && p.en === en) return false;
    if (ru !== null && p.ru === ru) return false;
    return true;
  });
  alignState.selectedEn = null;
  alignState.selectedRu = null;
  renderAlign();
}

function alignAuto(){
  const book = S.books.find(b => b.id === alignState.bookId);
  if (!book) return;
  if (!confirm('Сбросить и пересвести 1-к-1 (по порядку)?')) return;
  alignState.pairs = autoGenerateAlignment(book).pairs;
  alignState.selectedEn = null;
  alignState.selectedRu = null;
  renderAlign();
}

async function saveAlign(){
  const book = S.books.find(b => b.id === alignState.bookId);
  if (!book) return;
  book.alignment = { pairs: alignState.pairs };
  await saveBook(book);
  closeOverlay('alignOverlay');
  renderLibrary();
  showToast('Сведение сохранено');
}

function cancelAlign(){
  closeOverlay('alignOverlay');
}
