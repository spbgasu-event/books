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
 * Если задан разделитель — режем по нему. Иначе — автоматически по абзацам.
 */
function parseChaps(text, sep){
  if (!text) return null;

  if (sep && sep.trim()){
    const esc = sep.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?=^' + esc + ')', 'im');
    const parts = text.split(re).map(p => p.trim()).filter(p => p.length > 20);
    if (parts.length > 1){
      return parts.map((p, i) => {
        const first = p.split('\n')[0].trim();
        return {
          title: first || ('Глава ' + (i+1)),
          content: p.slice(first.length).trim() || p
        };
      });
    }
  }

  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
  if (!paras.length) return [{title:'Текст', content:text}];

  const chapCount = Math.min(15, Math.max(1, Math.ceil(paras.length / 20)));
  const size = Math.ceil(paras.length / chapCount);
  const chaps = [];
  for (let i = 0; i < paras.length; i += size){
    chaps.push({
      title: 'Часть ' + (chaps.length + 1),
      content: paras.slice(i, i + size).join('\n\n')
    });
  }
  return chaps;
}
