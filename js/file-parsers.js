'use strict';

/**
 * Парсинг входных файлов в чистый текст.
 * Поддерживаем TXT (как есть), FB2 (XML), EPUB (ZIP с HTML внутри).
 */

function readTxt(file){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = ev => res(ev.target.result);
    fr.onerror = rej;
    fr.readAsText(file, 'UTF-8');
  });
}

function readFb2(file){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = ev => {
      try {
        let content = ev.target.result;
        // FB2 часто бывает в windows-1251 — пробуем определить по BOM/декларации
        if (/encoding=["']windows-1251["']/i.test(content)){
          // перечитаем в нужной кодировке
          const fr2 = new FileReader();
          fr2.onload = e2 => {
            try { res(parseFb2Xml(e2.target.result)); }
            catch(err){ rej(err); }
          };
          fr2.onerror = rej;
          fr2.readAsText(file, 'windows-1251');
          return;
        }
        res(parseFb2Xml(content));
      } catch(e){ rej(e); }
    };
    fr.onerror = rej;
    fr.readAsText(file, 'UTF-8');
  });
}

function parseFb2Xml(xmlString){
  const xml = new DOMParser().parseFromString(xmlString, 'text/xml');
  const parseError = xml.querySelector('parsererror');
  if (parseError) throw new Error('FB2 повреждён или не XML');

  // Основное тело книги — первый <body> без атрибута name="notes"
  const bodies = xml.querySelectorAll('body');
  let text = '';

  bodies.forEach(body => {
    const name = body.getAttribute('name');
    if (name === 'notes' || name === 'comments') return; // пропускаем примечания

    // Идём по структуре: section → title + p
    const sections = body.querySelectorAll('section');
    if (sections.length){
      sections.forEach(sec => {
        const titleEl = sec.querySelector(':scope > title');
        if (titleEl){
          const t = titleEl.textContent.trim();
          if (t) text += t + '\n\n';
        }
        sec.querySelectorAll(':scope > p, :scope > poem, :scope > cite, :scope > subtitle').forEach(p => {
          const t = p.textContent.trim();
          if (t) text += t + '\n\n';
        });
      });
    } else {
      // Простой FB2 без секций
      body.querySelectorAll('p,title,subtitle,cite,poem').forEach(el => {
        const t = el.textContent.trim();
        if (t) text += t + '\n\n';
      });
    }
  });

  if (!text || text.trim().length < 50){
    throw new Error('Не удалось извлечь текст из FB2');
  }
  return text;
}

/**
 * Парсит EPUB → массив глав [{title, content}].
 *
 * Каждый xhtml-файл из spine — отдельная глава. Это естественная структура EPUB,
 * не нужно потом дробить текст по разделителям.
 *
 * @param {File} file
 * @param {function} [onProgress] — колбэк прогресса (0..1) для индикации
 * @returns {Promise<{chapters: Array, fullText: string}>}
 */
async function readEpubChapters(file, onProgress){
  await ensureJSZip();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // 1. container.xml → путь до OPF
  const containerFile = zip.file('META-INF/container.xml');
  let opfPath = null;
  if (containerFile){
    const containerXml = await containerFile.async('string');
    const m = containerXml.match(/full-path=["']([^"']+)["']/);
    if (m) opfPath = m[1];
  }

  // 2. Манифест и spine
  let orderedFiles = [];
  let opfDir = '';

  if (opfPath){
    opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfFile = zip.file(opfPath);
    if (opfFile){
      const opfXml = await opfFile.async('string');
      const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

      const manifest = {};
      opfDoc.querySelectorAll('manifest item').forEach(item => {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        const mediaType = item.getAttribute('media-type') || '';
        if (id && href && mediaType.includes('xhtml')){
          manifest[id] = href;
        }
      });

      opfDoc.querySelectorAll('spine itemref').forEach(ref => {
        const href = manifest[ref.getAttribute('idref')];
        if (href) orderedFiles.push(opfDir + href);
      });
    }
  }

  // Фолбэк
  if (!orderedFiles.length){
    orderedFiles = Object.keys(zip.files)
      .filter(k => /\.(x?html|htm)$/i.test(k) && !zip.files[k].dir)
      .sort();
  }

  if (!orderedFiles.length){
    throw new Error('EPUB: spine пустой, не нашёл текстовых файлов');
  }

  // 3. Параллельно читаем все файлы, потом извлекаем текст
  const total = orderedFiles.length;
  const chapters = [];

  // Распакуем сразу все строки параллельно — это быстрее последовательного цикла
  const fileContents = await Promise.all(
    orderedFiles.map(async (key, idx) => {
      const f = zip.file(key);
      if (!f) return null;
      const html = await f.async('string');
      if (onProgress) onProgress((idx + 1) / total * 0.5); // первая половина — распаковка
      return {key, html};
    })
  );

  // 4. Извлекаем текст из каждого файла — это уже синхронно
  fileContents.forEach((fc, idx) => {
    if (!fc) return;
    const {key, html} = fc;
    const chap = extractChapterFromXhtml(html, key);
    if (chap && chap.content.length > 30){
      chapters.push(chap);
    }
    if (onProgress) onProgress(0.5 + (idx + 1) / total * 0.5);
  });

  if (!chapters.length){
    throw new Error('EPUB прочитан, но текстовое содержимое пустое');
  }

  return {
    chapters,
    fullText: chapters.map(c => (c.title ? c.title + '\n\n' : '') + c.content).join('\n\n')
  };
}

/**
 * Парсит один XHTML файл главы.
 * Учитывает XML-декларацию (часто встречается в EPUB) — убираем её перед парсингом.
 */
function extractChapterFromXhtml(html, hint){
  // 1. Срезаем XML-декларацию и DOCTYPE, они мешают DOMParser в режиме text/html
  let cleaned = html.replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '');

  // 2. Сначала пробуем как XHTML — если XML невалидный, упадёт в parsererror
  let doc;
  try {
    doc = new DOMParser().parseFromString(cleaned, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')){
      doc = new DOMParser().parseFromString(cleaned, 'text/html');
    }
  } catch(e){
    doc = new DOMParser().parseFromString(cleaned, 'text/html');
  }

  // 3. Чистим служебное
  doc.querySelectorAll('script,style,nav,header,footer,link,meta').forEach(el => el.remove());

  // 4. Заголовок главы: <h1>/<h2>/<h3>, или элемент с class="title", или первый <p class="title">
  let title = '';
  const titleEl =
    doc.querySelector('h1, h2, h3, h4') ||
    doc.querySelector('[class*="title"]') ||
    doc.querySelector('p.title, div.title');
  if (titleEl) title = titleEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);

  // 5. Содержимое — все блочные элементы через \n\n
  const body = doc.body || doc.documentElement;
  if (!body) return null;

  const blocks = [];
  body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, div.cite, div.epigraph, pre').forEach(el => {
    // Пропускаем сам заголовок (он уже в title)
    if (el === titleEl) return;
    // Пропускаем элементы внутри других блоков, чтобы не дублировать
    if (el.parentElement && el.parentElement.closest('p, blockquote, div.cite, div.epigraph, pre, li')) return;
    const t = el.textContent.trim().replace(/\s+/g, ' ');
    if (t.length > 1) blocks.push(t);
  });

  // Если ничего не нашли через блочные теги — берём весь текст body
  let content = blocks.join('\n\n');
  if (!content || content.length < 20){
    const allText = body.textContent.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    if (allText.length > 20) content = allText;
  }

  // Если заголовок не нашли — используем подсказку из имени файла
  if (!title && hint){
    const m = hint.match(/([^\/]+)\.x?html$/i);
    if (m) title = m[1];
  }
  if (!title) title = 'Глава';

  return { title, content };
}

/**
 * Старый API — для совместимости. Возвращает только текст.
 */
async function readEpub(file, onProgress){
  const result = await readEpubChapters(file, onProgress);
  return result.fullText;
}

/**
 * Подгружает JSZip с CDN при первом обращении. Кешируется браузером и SW.
 */
let _jsZipPromise = null;
function ensureJSZip(){
  if (typeof JSZip !== 'undefined') return Promise.resolve();
  if (_jsZipPromise) return _jsZipPromise;
  _jsZipPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Не удалось загрузить JSZip (нужен интернет при первой загрузке EPUB)'));
    document.head.appendChild(s);
  });
  return _jsZipPromise;
}

/**
 * Разбиение полного текста на главы.
 *
 * Стратегии (по убыванию приоритета):
 *   1. Пользовательский разделитель (если задан)
 *   2. Стандартные паттерны заголовков (Chapter N, Глава N, римские, etc.)
 *   3. «Короткий абзац среди длинных» (заголовки обычно 1-3 слова)
 *   4. Большие пустые промежутки (4+ переносов строки)
 *   5. Фолбэк: вся книга одной главой (без синтетических «Часть 1, 2, 3»)
 *
 * Если глав мало (1-2) — не пытаемся резать синтетически.
 * Пользователь может потом нажать «Найти главы через LLM» вручную.
 */
function parseChaps(text, sep){
  if (!text || text.trim().length < 100) return null;

  const trimmed = text.trim();

  // ─── Стратегия 1: пользовательский разделитель ───
  if (sep && sep.trim()){
    const result = splitByCustomSeparator(trimmed, sep.trim());
    if (result && result.length > 1) return result;
  }

  // ─── Стратегия 2: стандартные паттерны заголовков ───
  const byPatterns = splitByChapterPatterns(trimmed);
  if (byPatterns && byPatterns.length >= 3) return byPatterns;

  // ─── Стратегия 3: короткие строки как разделители ───
  const byShortLines = splitByShortLines(trimmed);
  if (byShortLines && byShortLines.length >= 3) return byShortLines;

  // ─── Стратегия 4: большие пустоты ───
  const byGaps = splitByLargeGaps(trimmed);
  if (byGaps && byGaps.length >= 3) return byGaps;

  // ─── Если выше что-то нашло хоть 2 главы — берём это ───
  for (const candidate of [byPatterns, byShortLines, byGaps]){
    if (candidate && candidate.length >= 2) return candidate;
  }

  // ─── Фолбэк: вся книга одной главой ───
  // Без синтетических «Часть 1, 2, 3» — пользователь сам решит, нужно ли резать
  return [{ title: 'Книга целиком', content: trimmed }];
}

function splitByCustomSeparator(text, sep){
  try {
    const esc = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?=^' + esc + ')', 'im');
    const parts = text.split(re).map(p => p.trim()).filter(p => p.length > 30);
    if (parts.length <= 1) return null;
    return parts.map((p, i) => extractChapter(p, i));
  } catch(e){ return null; }
}

/**
 * Регулярки для типичных заголовков глав.
 * Должны стоять в НАЧАЛЕ строки и заканчиваться переносом строки.
 */
function splitByChapterPatterns(text){
  // Перечень паттернов в порядке убывания специфичности
  const patterns = [
    // Английские
    /^Chapter\s+[IVXLCDM\d]+/im,
    /^CHAPTER\s+[IVXLCDM\d]+/m,
    /^Ch\.\s*\d+/im,
    // Русские
    /^Глава\s+[IVXLCDM\d]+/im,
    /^ГЛАВА\s+[IVXLCDM\d]+/m,
    /^Глава\s+(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая)/im,
    // Универсальные
    /^Part\s+[IVXLCDM\d]+/im,
    /^Часть\s+[IVXLCDM\d]+/im,
    // Короткие номера в начале строки (1., I., § 1.)
    /^(?:§\s*)?[IVXLCDM]+\.\s*$/m,
    /^\d{1,3}\.\s*$/m,
  ];

  // Берём самый часто встречающийся паттерн
  let bestMatches = [];
  let bestPattern = null;

  for (const pat of patterns){
    const global = new RegExp(pat.source, pat.flags.includes('g') ? pat.flags : pat.flags + 'g');
    const matches = [...text.matchAll(global)];
    if (matches.length > bestMatches.length){
      bestMatches = matches;
      bestPattern = global;
    }
  }

  if (!bestMatches.length || bestMatches.length < 2) return null;

  // Режем по позициям совпадений
  const parts = [];
  for (let i = 0; i < bestMatches.length; i++){
    const start = bestMatches[i].index;
    const end = (i + 1 < bestMatches.length) ? bestMatches[i + 1].index : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 30) parts.push(chunk);
  }

  if (parts.length <= 1) return null;
  return parts.map((p, i) => extractChapter(p, i));
}

/**
 * Эвристика «короткая строка среди длинных».
 * Заголовки обычно — короткая строка (1-6 слов), окружённая длинными абзацами.
 */
function splitByShortLines(text){
  const lines = text.split(/\n+/).map(l => l.trim());
  if (lines.length < 20) return null;

  // Средняя длина непустой строки
  const nonEmpty = lines.filter(l => l.length > 0);
  const avgLen = nonEmpty.reduce((s, l) => s + l.length, 0) / nonEmpty.length;

  // Слишком короткие книги — здесь не сработает
  if (avgLen < 60) return null;

  // Кандидаты — строки <= 50 символов и не выглядящие как фрагмент предложения (нет точки/запятой в конце)
  const breakIndices = [];
  for (let i = 0; i < lines.length; i++){
    const l = lines[i];
    if (l.length === 0) continue;
    const wordCount = l.split(/\s+/).length;
    if (l.length <= 50 && wordCount <= 8 && !/[,;]$/.test(l) && !/[a-zа-я]$/.test(l)){
      // Дополнительно: следующая значимая строка должна быть длинной (это начало текста главы)
      let nextNonEmpty = '';
      for (let j = i + 1; j < lines.length; j++){
        if (lines[j].length > 0){ nextNonEmpty = lines[j]; break; }
      }
      if (nextNonEmpty.length >= 60){
        breakIndices.push(i);
      }
    }
  }

  if (breakIndices.length < 2) return null;

  // Слишком много кандидатов — это не главы (страница объявлений, оглавление и т.д.)
  if (breakIndices.length > lines.length / 5) return null;

  const parts = [];
  for (let i = 0; i < breakIndices.length; i++){
    const startLine = breakIndices[i];
    const endLine = (i + 1 < breakIndices.length) ? breakIndices[i + 1] : lines.length;
    const chunk = lines.slice(startLine, endLine).join('\n').trim();
    if (chunk.length > 100) parts.push(chunk);
  }

  if (parts.length <= 1) return null;
  return parts.map((p, i) => extractChapter(p, i));
}

/**
 * Разрез по большим пустотам (4+ переносов подряд).
 */
function splitByLargeGaps(text){
  const parts = text.split(/\n{4,}/).map(p => p.trim()).filter(p => p.length > 100);
  if (parts.length <= 1) return null;
  return parts.map((p, i) => extractChapter(p, i));
}

/**
 * Из куска текста извлекает {title, content}.
 * Заголовок — первая строка если она короткая.
 */
function extractChapter(chunk, idx){
  const lines = chunk.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) return { title: 'Глава ' + (idx + 1), content: chunk };

  const first = lines[0];
  let title, content;
  if (first.length <= 80){
    title = first;
    content = lines.slice(1).join('\n\n') || chunk;
  } else {
    title = 'Глава ' + (idx + 1);
    content = chunk;
  }
  return { title, content };
}

/**
 * LLM-разметка глав: посылаем превью текста в Mistral, получаем номера строк
 * где предположительно начинаются главы. Используется когда автомат не справился.
 *
 * @param {Object} book — книга для перепарсинга
 * @param {string} lang — 'en' или 'ru'
 * @returns {Promise<Array>} новый массив глав
 */
async function detectChaptersViaLLM(book, lang){
  const chaps = (lang === 'en' ? book.enChaps : book.ruChaps) || [];
  if (!chaps.length) throw new Error('Нет текста для разметки');

  // Восстанавливаем полный текст
  const fullText = chaps.map(c => (c.title ? c.title + '\n\n' : '') + c.content).join('\n\n');
  const lines = fullText.split(/\n/);

  // Берём короткие строки — это вероятные кандидаты в заголовки
  const candidates = [];
  for (let i = 0; i < lines.length; i++){
    const l = lines[i].trim();
    if (l.length === 0) continue;
    if (l.length <= 80){
      candidates.push({lineNum: i, text: l});
    }
  }

  // Слишком много кандидатов — берём только первые 200
  const sample = candidates.slice(0, 200);
  if (!sample.length) throw new Error('Нет коротких строк для анализа');

  const cfg = getApiCfg();
  if (!cfg.key) throw new Error('API ключ не задан');

  const prompt = `You are analyzing a book to find chapter headings.
Below is a list of short lines from the text (likely candidates for chapter titles, but most are NOT actual chapter headings — only some are).

Return ONLY a JSON array of line numbers that are REAL chapter headings.
A real heading: starts a chapter, looks like "Chapter X", "Глава N", "Part I", a Roman numeral, or a distinct short title.
NOT a heading: a short dialogue line, a short paragraph, a stage direction, a fragment.

Lines:
${sample.map(c => `[${c.lineNum}] ${c.text}`).join('\n')}

Return: {"chapter_lines": [num, num, ...]}
If you can't reliably identify chapter headings, return {"chapter_lines": []}.`;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.key},
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: 800,
      messages: [{role:'user', content: prompt}]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'HTTP ' + res.status);
  const raw = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  const chapterLines = parsed.chapter_lines || [];

  if (!chapterLines.length) throw new Error('LLM не нашёл заголовков глав');

  // Режем текст по найденным строкам
  chapterLines.sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < chapterLines.length; i++){
    const startLine = chapterLines[i];
    const endLine = (i + 1 < chapterLines.length) ? chapterLines[i + 1] : lines.length;
    const chunk = lines.slice(startLine, endLine).join('\n').trim();
    if (chunk.length > 50){
      result.push(extractChapter(chunk, i));
    }
  }

  if (!result.length) throw new Error('После разметки главы пустые');
  return result;
}
