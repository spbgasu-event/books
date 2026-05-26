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
        const xml = new DOMParser().parseFromString(ev.target.result, 'text/xml');
        const bodies = xml.querySelectorAll('body');
        let text = '';
        bodies.forEach(body => {
          body.querySelectorAll('title,p,poem,stanza,v').forEach(el => {
            const t = el.textContent.trim();
            if (t) text += t + '\n\n';
          });
        });
        if (!text) throw new Error('Пустой FB2');
        res(text);
      } catch(e){ rej(e); }
    };
    fr.onerror = rej;
    fr.readAsText(file, 'UTF-8');
  });
}

async function readEpub(file){
  const buf = await file.arrayBuffer();
  const zip = await unzipBuffer(buf);
  const htmlFiles = Object.keys(zip)
    .filter(k => /\.(html|xhtml|htm)$/i.test(k))
    .sort();
  let text = '';
  for (const key of htmlFiles){
    const html = zip[key] || '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,nav').forEach(el => el.remove());
    const body = doc.body?.textContent || '';
    if (body.trim().length > 50) text += body.trim() + '\n\n';
  }
  if (!text) throw new Error('Не удалось извлечь текст из EPUB');
  return text;
}

/**
 * Минимальный распаковщик ZIP — используем нативный DecompressionStream браузера.
 * Поддерживает только метод 0 (без сжатия) и метод 8 (deflate). Этого достаточно для EPUB.
 */
async function unzipBuffer(buf){
  const view = new DataView(buf);
  const files = {};
  let eocd = -1;

  for (let i = buf.byteLength - 22; i >= 0; i--){
    if (view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Не ZIP файл');

  const cdOffset = view.getUint32(eocd + 16, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const td = new TextDecoder('utf-8');
  let pos = cdOffset;

  while (pos < cdOffset + cdSize){
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const fnLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const fname = td.decode(new Uint8Array(buf, pos + 46, fnLen));
    pos += 46 + fnLen + extraLen + commentLen;

    const lfnLen = view.getUint16(localOffset + 26, true);
    const lextraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lfnLen + lextraLen;
    const compData = new Uint8Array(buf, dataStart, compSize);

    if (method === 0){
      files[fname] = td.decode(compData);
    } else if (method === 8){
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compData); writer.close();
        const chunks = [];
        const reader = ds.readable.getReader();
        while(true){
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const ch of chunks){ out.set(ch, off); off += ch.length; }
        files[fname] = td.decode(out);
      } catch(e){
        files[fname] = '';
      }
    }
  }
  return files;
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
