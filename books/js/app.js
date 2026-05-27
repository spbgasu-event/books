'use strict';

/**
 * Главный модуль — инициализация, навигация, регистрация Service Worker.
 * Грузится последним, когда все остальные определены.
 */

function switchPage(name){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById('page' + name[0].toUpperCase() + name.slice(1)).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${name}"]`).classList.add('active');

  // Плавающая кнопка только на главной библиотеке
  document.getElementById('fabAdd').style.display = (name === 'library') ? 'flex' : 'none';

  if (name === 'review') renderReview();
  if (name === 'words') renderWordsList();
  if (name === 'settings') loadSettingsUI();
}

function updateNavBadges(){
  const due = getDueWords().length;
  const badge = document.getElementById('navBadgeReview');
  if (due > 0){
    badge.textContent = due > 99 ? '99+' : due;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// При повороте экрана или resize — репагинируем читалку
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!document.getElementById('readerPage').classList.contains('active')) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const paraIdx = currentAnchor();
    paginateCurrentChapter();
    R.pageIdx = paraIdxToPageIndex(paraIdx);
    renderCurrentPage();
  }, 200);
});

// Bootstrap
(async function init(){
  try {
    await openDB();
    await migrateFromLocalStorage();
    await loadFromDB();
  } catch(e){
    console.error('DB init failed', e);
    showToast('Ошибка хранилища');
  }
  renderLibrary();
  updateNavBadges();
  setupReaderGestures();
  document.getElementById('fabAdd').style.display = 'flex';
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('[PWA] SW зарегистрирован', reg.scope))
      .catch(err => console.warn('[PWA] SW ошибка', err));
  });
}
