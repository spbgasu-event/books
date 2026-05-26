'use strict';

/**
 * Экран карточек. Очередь формируется из слов, у которых dueDate <= now.
 * Пока используем простой вариант "слово→перевод"; во второй итерации
 * переделаем на "контекст с выделенным словом" + обратные карточки RU→EN.
 */

let revQueue = [];
let revIdx = 0;
let revFlipped = false;
let revStats = {};

function renderReview(){
  revQueue = getDueWords().sort((a, b) => (a.srs?.dueDate||0) - (b.srs?.dueDate||0));
  revIdx = 0;
  revFlipped = false;
  revStats = {again:0, hard:0, good:0, easy:0};
  renderReviewContent();
}

function renderReviewContent(){
  const cont = document.getElementById('reviewPage');

  if (!revQueue.length){
    cont.innerHTML = `<div class="review-empty">
      <div class="empty-icon">🎉</div>
      <h3 style="font-family:'Playfair Display',serif;margin-bottom:8px;">Сейчас нет карточек</h3>
      <p style="color:var(--muted);font-size:13px;">Сохраняй слова при чтении — они появятся здесь.</p>
    </div>`;
    return;
  }

  if (revIdx >= revQueue.length){
    cont.innerHTML = `<div class="review-empty">
      <div class="empty-icon">✓</div>
      <h3 style="font-family:'Playfair Display',serif;margin-bottom:8px;">Сессия завершена</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:18px;">
        Снова: ${revStats.again} · Сложно: ${revStats.hard} · Хорошо: ${revStats.good} · Легко: ${revStats.easy}
      </p>
      <button class="btn-primary" onclick="renderReview()">Ещё раз</button>
    </div>`;
    return;
  }

  const w = revQueue[revIdx];
  const srs = w.srs || initSRS();
  const ctx = w.context || w.word;

  // Выделяем целевое слово в контексте
  const ctxHl = ctx.replace(
    new RegExp(`\\b(${w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i'),
    '<span class="target-word">$1</span>'
  );

  cont.innerHTML = `
    <div class="review-stats">
      <span class="rs">${revIdx+1} / ${revQueue.length}</span>
    </div>
    <div class="fc-card" id="fcCard" onclick="flipCard()">
      <div class="fc-direction">Вспомни перевод</div>
      <div class="fc-context">${ctxHl}</div>
      <div class="fc-hint">Из «${escapeHtml(w.bookTitle || '')}»</div>
      <div id="fcAnswer" style="display:none;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;width:100%;">
        ${w.fullResult?.transcription ? `<div class="fc-transcription">${escapeHtml(w.fullResult.transcription)}</div>` : ''}
        <div class="fc-translation"><strong>${escapeHtml(w.translation || '')}</strong></div>
        ${w.fullResult?.meanings?.[0]?.example_original ? `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:8px;">${escapeHtml(w.fullResult.meanings[0].example_original)}</div>` : ''}
      </div>
    </div>
    <button class="review-flip-btn" id="revFlipBtn" onclick="flipCard()">Показать ответ</button>
    <div class="review-btns" id="revBtns" style="margin-top:12px;">
      <button class="rb rb-again" onclick="gradeCard(0)"><span>Снова</span><span class="rb-interval">${intervalLabel(srs,0)}</span></button>
      <button class="rb rb-hard"  onclick="gradeCard(1)"><span>Сложно</span><span class="rb-interval">${intervalLabel(srs,1)}</span></button>
      <button class="rb rb-good"  onclick="gradeCard(2)"><span>Хорошо</span><span class="rb-interval">${intervalLabel(srs,2)}</span></button>
      <button class="rb rb-easy"  onclick="gradeCard(3)"><span>Легко</span><span class="rb-interval">${intervalLabel(srs,3)}</span></button>
    </div>
  `;
}

function flipCard(){
  if (revFlipped) return;
  revFlipped = true;
  document.getElementById('fcAnswer').style.display = 'block';
  document.getElementById('revFlipBtn').style.display = 'none';
  document.getElementById('revBtns').classList.add('show');
}

async function gradeCard(grade){
  const w = revQueue[revIdx];
  w.srs = applyGrade(w.srs || initSRS(), grade);

  // Синхронизируем с S.words по id
  const idx = S.words.findIndex(x => x.id === w.id);
  if (idx >= 0) S.words[idx].srs = w.srs;

  await saveWord(w);

  if (grade === 0) revStats.again++;
  else if (grade === 1) revStats.hard++;
  else if (grade === 2) revStats.good++;
  else revStats.easy++;

  revIdx++;
  revFlipped = false;
  renderReviewContent();
  updateNavBadges();
}
