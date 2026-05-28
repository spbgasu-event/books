'use strict';

/**
 * Глобальное состояние приложения.
 * S — данные пользователя (книги, слова, настройки).
 * R — состояние читалки в текущем сеансе.
 */
const S = {
  books: [],
  words: [],
  settings: { apiKey:'', apiModel:'mistral', readerFontSize:18 }
};

const R = {
  bookId:null,
  lang:'en',
  chapIdx:0,
  pageIdx:0,
  pages:[],          // массив сверстанных страниц текущей главы+языка
  totalParas:1,      // абзацев в главе
  jumpStack:[],      // история «умных переходов»: куда возвращаться по кнопке ←
  highlightParaIdx: null  // индекс абзаца для подсветки после умного поиска
};

// Хелперы для общего использования

function escapeHtml(s){
  if (!s) return '';
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function closeOverlay(id){
  document.getElementById(id).classList.remove('open');
}

// Закрытие модалок по клику на затемнение
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('overlay')){
    e.target.classList.remove('open');
  }
});
