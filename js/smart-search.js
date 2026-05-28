'use strict';

/**
 * Умный поиск: «дай мне абзац на другом языке, соответствующий этому».
 *
 * Логика:
 *   1. Пользователь тапнул слово в EN, выбрал «Найти на RU»
 *   2. Мы знаем: исходное слово, его предложение, его абзац, книгу, главу
 *   3. Находим парную главу в RU через align (или ту же по номеру)
 *   4. Кэш: уже искали этот ключ → возвращаем сохранённое
 *   5. Шлём в LLM: контекст + парная глава + вопрос «номер абзаца»
 *   6. Прыгаем туда с подсветкой
 *   7. Сохраняем в jumpStack для кнопки «← вернуться»
 *
 * Стоимость: одна парная глава обычно 5-15 КБ ≈ 2000-5000 токенов input,
 * ответ < 100 токенов. На Mistral это ~$0.0005-0.001 за поиск.
 */

// Кэш поисков. Ключ = "bookId|fromLang|fromChap|paraIdx", значение = {toChap, toPara}
let _searchCache = {};

async function loadSearchCache(){
  try {
    const entry = await dbGet('settings', 'searchCache');
    if (entry && entry.value) _searchCache = entry.value;
  } catch(e){ _searchCache = {}; }
}

async function saveSearchCache(){
  try {
    await dbPut('settings', {key:'searchCache', value: _searchCache});
  } catch(e){ /* не критично */ }
}

/**
 * Главная функция — вызывается из попапа слова.
 * @param {string} sourceLang — откуда ищем (en/ru)
 * @param {number} sourceParaIdx — индекс абзаца в текущей главе
 * @param {string} sourceSentence — предложение с опорным словом
 * @param {string} sourceWord — само слово
 */
async function smartFindOnOtherLang(sourceLang, sourceParaIdx, sourceSentence, sourceWord){
  const book = S.books.find(b => b.id === R.bookId);
  if (!book) return;

  const targetLang = (sourceLang === 'en') ? 'ru' : 'en';
  const targetChaps = (targetLang === 'en') ? book.enChaps : book.ruChaps;
  if (!targetChaps || !targetChaps.length){
    showToast('Нет текста на другом языке');
    return;
  }

  // Находим парную главу
  const targetChapIdx = findAlignedChapter(book, R.chapIdx, sourceLang, targetLang);
  if (targetChapIdx < 0){
    showToast('Эта глава не привязана к другому языку. Открой ⇄');
    return;
  }

  const targetChap = targetChaps[targetChapIdx];
  if (!targetChap){
    showToast('Парная глава не найдена');
    return;
  }

  // Проверяем кэш
  const cacheKey = `${book.id}|${sourceLang}|${R.chapIdx}|${sourceParaIdx}`;
  if (_searchCache[cacheKey]){
    const cached = _searchCache[cacheKey];
    jumpToParagraph(targetLang, cached.chapIdx, cached.paraIdx, 'кэш');
    return;
  }

  // Стоимость API не нулевая — спрашиваем подтверждение если у нас нет ключа
  if (!S.settings.apiKey){
    showToast('API ключ не задан — зайди в Настройки');
    return;
  }

  showSearchingIndicator();

  try {
    const targetParaIdx = await callLLMForSemanticMatch(
      book, sourceSentence, sourceWord, sourceLang, targetLang, targetChap
    );

    if (targetParaIdx < 0){
      showToast('Соответствие не найдено в этой главе');
      hideSearchingIndicator();
      return;
    }

    // Сохраняем в кэш
    _searchCache[cacheKey] = {chapIdx: targetChapIdx, paraIdx: targetParaIdx};
    await saveSearchCache();

    jumpToParagraph(targetLang, targetChapIdx, targetParaIdx, 'найдено');
  } catch(err){
    hideSearchingIndicator();
    showToast('Ошибка поиска: ' + err.message);
  }
}

/**
 * Запрос в LLM для семантического матчинга.
 *
 * Стратегия по объёму главы:
 * - До 30 КБ → одна пачка
 * - Больше → дробим на куски и берём первый совпавший
 */
async function callLLMForSemanticMatch(book, sentence, word, fromLang, toLang, targetChap){
  const paras = targetChap.content.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  if (!paras.length) return -1;

  // Размер главы в символах
  const chapSize = targetChap.content.length;
  const FROM_LABEL = fromLang === 'en' ? 'English' : 'Russian';
  const TO_LABEL = toLang === 'en' ? 'English' : 'Russian';

  // Готовим нумерованный список абзацев
  function buildList(startIdx, endIdx){
    return paras.slice(startIdx, endIdx).map((p, i) =>
      `[${startIdx + i}] ${p.substring(0, 300)}${p.length > 300 ? '...' : ''}`
    ).join('\n\n');
  }

  async function querySegment(startIdx, endIdx){
    const list = buildList(startIdx, endIdx);
    const prompt = `You are a precise bilingual text matcher.
Book: "${book.title}"${book.author ? ' by ' + book.author : ''}.

There is a sentence in ${FROM_LABEL} with the word "${word}":
"${sentence}"

Below is a portion of the corresponding ${TO_LABEL} chapter, with numbered paragraphs.
Find ONE paragraph that semantically corresponds to the ${FROM_LABEL} sentence — the same scene, same idea, same place in the narrative.

Paragraphs:
${list}

Return ONLY a JSON object: {"paragraph_id": NUMBER, "confidence": "high"|"medium"|"low"}
If no paragraph matches — return {"paragraph_id": -1, "confidence": "none"}.`;

    const cfg = getApiCfg();
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.1,
        max_tokens: 80,
        messages: [{role:'user', content: prompt}]
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || 'HTTP ' + res.status);
    const raw = data.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      paragraphId: typeof parsed.paragraph_id === 'number' ? parsed.paragraph_id : -1,
      confidence: parsed.confidence || 'low'
    };
  }

  // Большая глава — режем на куски по ~25 КБ
  if (chapSize > 30000){
    const CHUNK_SIZE = 25000;
    let curStart = 0;
    let curChars = 0;
    let chunks = [[]];

    for (let i = 0; i < paras.length; i++){
      curChars += paras[i].length + 2;
      chunks[chunks.length - 1].push(i);
      if (curChars >= CHUNK_SIZE && i < paras.length - 1){
        chunks.push([]);
        curChars = 0;
      }
    }

    // Опрашиваем куски по очереди — берём первый "high"/"medium" confidence
    let bestResult = -1;
    for (const chunkParas of chunks){
      if (!chunkParas.length) continue;
      const startIdx = chunkParas[0];
      const endIdx = chunkParas[chunkParas.length - 1] + 1;
      const result = await querySegment(startIdx, endIdx);
      if (result.paragraphId >= 0 && (result.confidence === 'high' || result.confidence === 'medium')){
        return result.paragraphId;
      }
      if (result.paragraphId >= 0 && bestResult < 0){
        bestResult = result.paragraphId;
      }
    }
    return bestResult;
  }

  // Глава нормального размера — одна пачка
  const result = await querySegment(0, paras.length);
  return result.paragraphId;
}

/**
 * Переход на конкретный абзац в другом языке с подсветкой и записью в историю.
 */
function jumpToParagraph(targetLang, targetChapIdx, targetParaIdx, sourceLabel){
  // Запоминаем откуда прыгнули — для кнопки «← вернуться»
  R.jumpStack.push({
    lang: R.lang,
    chapIdx: R.chapIdx,
    pageIdx: R.pageIdx,
    timestamp: Date.now()
  });

  R.lang = targetLang;
  R.chapIdx = targetChapIdx;
  R.highlightParaIdx = targetParaIdx;

  updateLangToggle();
  paginateCurrentChapter();
  R.pageIdx = paraIdxToPageIndex(targetParaIdx);

  hideSearchingIndicator();
  closeWPopup();
  renderCurrentPage();
  updateJumpBackButton();

  // Подсветка применяется после рендера
  setTimeout(() => highlightFoundParagraph(targetParaIdx), 50);

  if (sourceLabel) showToast('Перешли · ' + sourceLabel);
}

/**
 * Возврат на предыдущую позицию из стека jumpStack.
 */
function jumpBack(){
  if (!R.jumpStack.length) return;
  const prev = R.jumpStack.pop();
  R.lang = prev.lang;
  R.chapIdx = prev.chapIdx;
  R.highlightParaIdx = null;

  updateLangToggle();
  paginateCurrentChapter();
  R.pageIdx = prev.pageIdx;
  renderCurrentPage();
  updateJumpBackButton();
}

function updateJumpBackButton(){
  const btn = document.getElementById('rJumpBack');
  if (!btn) return;
  btn.style.display = R.jumpStack.length ? 'flex' : 'none';
}

/**
 * Подсветка найденного абзаца — мягкое свечение на 3 секунды.
 */
function highlightFoundParagraph(paraIdx){
  const pageEl = document.getElementById('rPage');
  if (!pageEl) return;
  // Находим первый span слова с data-p равным paraIdx и идём до его параграфа
  const wordEl = pageEl.querySelector(`.r-word[data-p="${paraIdx}"]`);
  if (!wordEl) return;
  const paraEl = wordEl.closest('p');
  if (!paraEl) return;

  paraEl.classList.add('r-found-highlight');
  paraEl.scrollIntoView({behavior:'smooth', block:'center'});

  setTimeout(() => {
    paraEl.classList.remove('r-found-highlight');
    R.highlightParaIdx = null;
  }, 3500);
}

/* ─── Индикатор поиска ─── */
function showSearchingIndicator(){
  let ind = document.getElementById('rSearchInd');
  if (!ind){
    ind = document.createElement('div');
    ind.id = 'rSearchInd';
    ind.className = 'r-search-indicator';
    ind.innerHTML = '<div class="wp-loader"></div><div>Ищу соответствие...</div>';
    document.body.appendChild(ind);
  }
  ind.classList.add('show');
}

function hideSearchingIndicator(){
  const ind = document.getElementById('rSearchInd');
  if (ind) ind.classList.remove('show');
}

/* ─── Очистка кэша поиска (для настроек) ─── */
async function clearSearchCache(){
  _searchCache = {};
  await saveSearchCache();
}
