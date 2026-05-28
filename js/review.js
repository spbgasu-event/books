'use strict';

/**
 * Экран карточек.
 *
 * Карточка forward: контекст с выделенным словом → угадай перевод
 * Карточка backward: перевод → угадай оригинальное слово (без контекста)
 *
 * Очередь формируется из всех слов где хоть одна сторона due.
 * Каждое слово в очереди появляется столько раз, сколько у него сторон due.
 */

let revQueue = [];
let revIdx = 0;
let revFlipped = false;
let revStats = {};

function renderReview(){
  revQueue = getDueCards();
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

  const item = revQueue[revIdx];
  const w = item.word;
  const direction = item.direction;
  const card = w.cards[direction];

  const isForward = direction === 'forward';
  const directionLabel = isForward ? `${w.lang === 'en' ? 'EN' : 'RU'} → ${w.lang === 'en' ? 'RU' : 'EN'}` : `${w.lang === 'en' ? 'RU' : 'EN'} → ${w.lang === 'en' ? 'EN' : 'RU'}`;

  // Готовим лицевую сторону
  let frontHtml;
  if (isForward){
    // Контекст с выделенным словом
    const ctx = w.context || w.word;
    const ctxHl = ctx.replace(
      new RegExp(`\\b(${escapeRegex(w.word)})\\b`, 'i'),
      '<span class="target-word">$1</span>'
    );
    frontHtml = `
      <div class="fc-direction">${directionLabel} · Вспомни перевод</div>
      <div class="fc-context">${ctxHl}</div>
    `;
  } else {
    // Только перевод, без контекста
    frontHtml = `
      <div class="fc-direction">${directionLabel} · Вспомни слово на ${w.lang === 'en' ? 'английском' : 'русском'}</div>
      <div class="fc-translation-front">${escapeHtml(w.translation || '—')}</div>
    `;
  }

  // Готовим оборотную сторону
  let backHtml = '';
  if (isForward){
    backHtml = `
      ${w.fullResult?.transcription ? `<div class="fc-transcription">${escapeHtml(w.fullResult.transcription)}</div>` : ''}
      <div class="fc-translation"><strong>${escapeHtml(w.translation || '')}</strong></div>
      ${w.fullResult?.meanings?.[0]?.example_original ? `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:8px;">${escapeHtml(w.fullResult.meanings[0].example_original)}</div>` : ''}
    `;
  } else {
    backHtml = `
      <div class="fc-word-big">${escapeHtml(w.word)}</div>
      ${w.fullResult?.transcription ? `<div class="fc-transcription">${escapeHtml(w.fullResult.transcription)}</div>` : ''}
      ${w.context ? `<div class="fc-context" style="font-size:13px;color:var(--muted);margin-top:8px;">${escapeHtml(w.context.slice(0, 200))}${w.context.length > 200 ? '...' : ''}</div>` : ''}
    `;
  }

  cont.innerHTML = `
    <div class="review-stats">
      <span class="rs">${revIdx+1} / ${revQueue.length}</span>
    </div>
    <div class="fc-card" id="fcCard" onclick="flipCard()">
      ${frontHtml}
      <div class="fc-hint">Из «${escapeHtml(w.bookTitle || '')}»</div>
      <div id="fcAnswer" style="display:none;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;width:100%;">
        ${backHtml}
      </div>
    </div>
    <button class="review-flip-btn" id="revFlipBtn" onclick="flipCard()">Показать ответ</button>
    <div class="review-btns" id="revBtns" style="margin-top:12px;">
      <button class="rb rb-again" onclick="gradeCard(0)"><span>Снова</span><span class="rb-interval">${intervalLabel(card,0)}</span></button>
      <button class="rb rb-hard"  onclick="gradeCard(1)"><span>Сложно</span><span class="rb-interval">${intervalLabel(card,1)}</span></button>
      <button class="rb rb-good"  onclick="gradeCard(2)"><span>Хорошо</span><span class="rb-interval">${intervalLabel(card,2)}</span></button>
      <button class="rb rb-easy"  onclick="gradeCard(3)"><span>Легко</span><span class="rb-interval">${intervalLabel(card,3)}</span></button>
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
  const item = revQueue[revIdx];
  const w = item.word;
  const dir = item.direction;

  w.cards[dir] = applyGrade(w.cards[dir], grade);

  // Синхронизируем с S.words
  const idx = S.words.findIndex(x => x.id === w.id);
  if (idx >= 0) S.words[idx] = w;

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

function escapeRegex(s){
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
