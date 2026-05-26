'use strict';

/**
 * Алгоритм SRS — пока упрощённый SM-2.
 * Поведение карточек переделаем во второй итерации (двусторонние карточки,
 * контекст с выделением, более мягкое поведение при «снова»).
 *
 * Сейчас оценки: 0=again, 1=hard, 2=good, 3=easy
 */

function initSRS(){
  return {
    interval: 1,
    ef: 2.5,
    dueDate: Date.now(),
    lapses: 0
  };
}

function applyGrade(srs, grade){
  let { interval, ef, lapses } = srs;

  if (grade === 0){
    lapses++;
    interval = 1;
    ef = Math.max(1.3, ef - 0.2);
  } else {
    const q = grade === 1 ? 3 : grade === 2 ? 4 : 5;
    ef = Math.max(1.3, ef + 0.1 - (5 - q) * 0.08 + (5 - q) * 0.02);

    if (interval === 1){
      interval = grade === 3 ? 4 : 1;
    } else if (interval <= 4){
      interval = grade === 3 ? 9 : 6;
    } else {
      interval = Math.round(interval * ef);
    }
  }

  return {
    interval,
    ef,
    dueDate: Date.now() + interval * 86400000,
    lapses
  };
}

/**
 * Превращает оценку в человекочитаемый интервал — для подсказки на кнопке.
 */
function intervalLabel(srs, grade){
  const r = applyGrade({...srs}, grade);
  const d = r.interval;
  if (d < 1) return '<1д';
  if (d === 1) return '1д';
  if (d < 30) return d + 'д';
  return Math.round(d/30) + 'мес';
}

function getDueWords(){
  const now = Date.now();
  return S.words.filter(w => !w.srs || w.srs.dueDate <= now);
}
