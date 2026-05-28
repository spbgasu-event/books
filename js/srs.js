'use strict';

/**
 * SRS — модифицированный SM-2 с двумя направлениями (forward / backward).
 *
 * Карточка хранится в слове (word) внутри объекта cards:
 *   word.cards = {
 *     forward:  {state, interval, ef, dueDate, lapses, reps}  // EN→RU
 *     backward: {state, interval, ef, dueDate, lapses, reps}  // RU→EN
 *   }
 *
 * Direction говорит модели слова что показывать на лицевой стороне:
 *   - forward: контекст с выделенным EN-словом → вспомни RU перевод
 *   - backward: RU перевод → вспомни EN слово (без контекста, чтоб не палить)
 *
 * Изменения от старого SM-2:
 *   - «Снова» НЕ сбрасывает interval в 1 день. Уменьшает в 4 раза, минимум 1 день.
 *     Это мягче — не убивает накопленный прогресс за одну ошибку.
 *   - Состояние learning/review для разных шагов начального обучения
 *   - Easy bonus 1.3x вместо мгновенного перехода на 4 дня
 */

function initCard(){
  return {
    state: 'new',    // new | learning | review
    interval: 0,     // в днях (0 для new и learning)
    ef: 2.5,         // easiness factor
    dueDate: Date.now(),
    lapses: 0,
    reps: 0
  };
}

// Шаги для learning state — минут до следующего показа
const LEARNING_STEPS = [1, 10, 60 * 24]; // 1 мин, 10 мин, 1 день

/**
 * Применяет оценку к карточке.
 *
 * @param {Object} card — текущее состояние SRS
 * @param {number} grade — 0=again, 1=hard, 2=good, 3=easy
 * @returns {Object} новое состояние
 */
function applyGrade(card, grade){
  const c = {...card};
  const now = Date.now();

  if (c.state === 'new' || c.state === 'learning'){
    if (grade === 0){
      // Снова — возвращаемся на первый шаг
      c.state = 'learning';
      c.reps = 0;
      c.dueDate = now + LEARNING_STEPS[0] * 60_000;
    } else if (grade === 1){
      // Сложно — текущий шаг
      c.state = 'learning';
      const step = Math.min(c.reps, LEARNING_STEPS.length - 1);
      c.dueDate = now + LEARNING_STEPS[step] * 60_000;
    } else if (grade === 2){
      // Хорошо — следующий шаг или выход в review
      c.reps = (c.reps || 0) + 1;
      if (c.reps >= LEARNING_STEPS.length){
        c.state = 'review';
        c.interval = 1;
        c.dueDate = now + 86_400_000;
      } else {
        c.state = 'learning';
        c.dueDate = now + LEARNING_STEPS[c.reps] * 60_000;
      }
    } else if (grade === 3){
      // Легко — сразу в review с интервалом 4 дня
      c.state = 'review';
      c.interval = 4;
      c.dueDate = now + 4 * 86_400_000;
      c.reps = (c.reps || 0) + 1;
    }
    return c;
  }

  // state === 'review'
  if (grade === 0){
    // Мягкое «снова»: уменьшаем интервал в 4 раза, но не меньше 1 дня
    c.lapses = (c.lapses || 0) + 1;
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.interval = Math.max(1, Math.round(c.interval / 4));
    c.dueDate = now + c.interval * 86_400_000;
    // Состояние оставляем review — не возвращаем в learning
  } else if (grade === 1){
    // Сложно — интервал растёт, но медленнее
    c.ef = Math.max(1.3, c.ef - 0.15);
    c.interval = Math.round(c.interval * 1.2);
    c.dueDate = now + c.interval * 86_400_000;
    c.reps += 1;
  } else if (grade === 2){
    // Хорошо — обычный рост
    c.interval = Math.round(c.interval * c.ef);
    c.dueDate = now + c.interval * 86_400_000;
    c.reps += 1;
  } else if (grade === 3){
    // Легко — ускоренный рост
    c.ef = c.ef + 0.15;
    c.interval = Math.round(c.interval * c.ef * 1.3);
    c.dueDate = now + c.interval * 86_400_000;
    c.reps += 1;
  }

  return c;
}

/**
 * Превращает оценку в человекочитаемый интервал — для подсказки на кнопке.
 */
function intervalLabel(card, grade){
  const r = applyGrade(card, grade);
  if (r.state === 'learning'){
    const minutes = Math.round((r.dueDate - Date.now()) / 60_000);
    if (minutes < 60) return minutes + 'мин';
    if (minutes < 60 * 24) return Math.round(minutes / 60) + 'ч';
    return Math.round(minutes / (60 * 24)) + 'д';
  }
  const d = r.interval;
  if (d < 1) return '<1д';
  if (d === 1) return '1д';
  if (d < 30) return d + 'д';
  return Math.round(d / 30) + 'мес';
}

/**
 * Собирает очередь карточек к повторению из всех слов.
 * Каждая карточка — это пара {word, direction}.
 */
function getDueCards(){
  const now = Date.now();
  const queue = [];
  for (const w of S.words){
    if (!w.cards){
      // Миграция старого формата: было w.srs одно поле — конвертируем в forward
      if (w.srs){
        w.cards = {
          forward: convertOldSrs(w.srs),
          backward: initCard()
        };
      } else {
        w.cards = { forward: initCard(), backward: initCard() };
      }
    }
    if (w.cards.forward && w.cards.forward.dueDate <= now){
      queue.push({word: w, direction: 'forward'});
    }
    if (w.cards.backward && w.cards.backward.dueDate <= now){
      queue.push({word: w, direction: 'backward'});
    }
  }
  // Сортируем по dueDate (самые просроченные первыми)
  queue.sort((a, b) => a.word.cards[a.direction].dueDate - b.word.cards[b.direction].dueDate);
  return queue;
}

// Совместимость со старой моделью — старый srs.interval/ef/dueDate
function convertOldSrs(oldSrs){
  return {
    state: oldSrs.interval > 1 ? 'review' : 'learning',
    interval: oldSrs.interval || 1,
    ef: oldSrs.ef || 2.5,
    dueDate: oldSrs.dueDate || Date.now(),
    lapses: oldSrs.lapses || 0,
    reps: oldSrs.interval > 1 ? 3 : 0
  };
}

/* Старая функция для совместимости (используется в карточке книги) */
function initSRS(){ return initCard(); }
function getDueWords(){
  // Возвращает уникальные слова где хоть одна карточка к повторению
  const seen = new Set();
  const result = [];
  for (const item of getDueCards()){
    if (seen.has(item.word.id)) continue;
    seen.add(item.word.id);
    result.push(item.word);
  }
  return result;
}
