'use strict';

/**
 * Экран словаря — все сохранённые слова с поиском.
 */

function renderWordsList(filter = ''){
  const c = document.getElementById('wordsList');
  document.getElementById('wcFull').textContent = S.words.length + ' слов';

  const now = Date.now();
  const items = filter
    ? S.words.filter(w =>
        (w.word||'').toLowerCase().includes(filter.toLowerCase()) ||
        (w.translation||'').toLowerCase().includes(filter.toLowerCase())
      )
    : S.words;

  if (!items.length){
    c.innerHTML = `<div class="empty">
      <div class="empty-icon">📝</div>
      <h3>${filter ? 'Ничего не найдено' : 'Словарь пуст'}</h3>
      <p>${filter ? 'Попробуй другой запрос' : 'Сохраняй слова при чтении'}</p>
    </div>`;
    return;
  }

  c.innerHTML = items.map(w => {
    const srs = w.srs;
    const due = !srs || (srs.dueDate <= now);
    const daysLeft = srs ? Math.ceil((srs.dueDate - now) / 86400000) : 0;
    const dueLabel = due
      ? 'К повторению'
      : (daysLeft <= 1 ? 'Завтра' : daysLeft + 'д');

    return `<div class="wi">
      <div class="wi-main">
        <div class="wi-word">${escapeHtml(w.word)}</div>
        ${w.translation ? `<div class="wi-tr">${escapeHtml(w.translation)}</div>` : ''}
        ${w.context ? `<div class="wi-ctx">"${escapeHtml(w.context.substring(0,140))}${w.context.length>140?'...':''}"</div>` : ''}
        <div class="wi-meta">
          <span>${escapeHtml(w.bookTitle || '')} · гл.${(w.chapIdx||0)+1}</span>
          <span class="wi-due ${due?'soon':''}">${dueLabel}</span>
        </div>
      </div>
      <button class="wi-del" onclick="deleteWord('${w.id}')">✕</button>
    </div>`;
  }).join('');
}

function filterWords(v){ renderWordsList(v); }

async function deleteWord(id){
  S.words = S.words.filter(w => w.id !== id);
  await dbDel('words', id);
  renderWordsList();
  updateNavBadges();
}
