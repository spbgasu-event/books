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
 * Парсит EPUB: ZIP с HTML внутри + манифест OPF, указывающий порядок чтения.
 * Использует JSZip (подгружается лениво из CDN при первом вызове).
 */
async function readEpub(file){
  await ensureJSZip();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Шаг 1: найти container.xml — он скажет где лежит OPF-манифест
  const containerFile = zip.file('META-INF/container.xml');
  let opfPath = null;
  if (containerFile){
    const containerXml = await containerFile.async('string');
    const m = containerXml.match(/full-path=["']([^"']+)["']/);
    if (m) opfPath = m[1];
  }

  // Шаг 2: разобрать OPF, чтобы получить порядок глав (spine)
  let orderedFiles = [];
  let opfDir = '';

  if (opfPath){
    opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfFile = zip.file(opfPath);
    if (opfFile){
      const opfXml = await opfFile.async('string');
      const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

      // Манифест: id → href
      const manifest = {};
      opfDoc.querySelectorAll('manifest item').forEach(item => {
        manifest[item.getAttribute('id')] = item.getAttribute('href');
      });

      // Spine: какие idref в каком порядке
      opfDoc.querySelectorAll('spine itemref').forEach(ref => {
        const href = manifest[ref.getAttribute('idref')];
        if (href) orderedFiles.push(opfDir + href);
      });
    }
  }

  // Фолбэк: если OPF не разобрался — просто берём все html/xhtml в алфавитном порядке
  if (!orderedFiles.length){
    orderedFiles = Object.keys(zip.files)
      .filter(k => /\.(x?html|htm)$/i.test(k) && !zip.files[k].dir)
      .sort();
  }

  // Шаг 3: извлекаем текст из каждого файла в правильном порядке
  let text = '';
  for (const key of orderedFiles){
    const f = zip.file(key);
    if (!f) continue;
    const html = await f.async('string');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Чистим служебные теги
    doc.querySelectorAll('script,style,nav,header,footer').forEach(el => el.remove());
    // Превращаем блочные элементы в абзацы с разделением \n\n
    const blocks = doc.body?.querySelectorAll('p,h1,h2,h3,h4,h5,h6,div,blockquote,li') || [];
    if (blocks.length){
      blocks.forEach(b => {
        const t = b.textContent.trim();
        if (t.length > 1) text += t + '\n\n';
      });
    } else {
      // если структуры нет — берём как есть
      const body = doc.body?.textContent.trim() || '';
      if (body.length > 50) text += body + '\n\n';
    }
  }

  if (!text || text.trim().length < 50){
    throw new Error('EPUB прочитан, но текст не извлёкся (возможно, защищён DRM)');
  }
  return text;
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
