'use strict';

/**
 * Переводчик через LLM API. Поддерживаем два провайдера —
 * Mistral и DeepSeek. Оба совместимы с OpenAI-форматом /v1/chat/completions.
 */

function getApiCfg(){
  const m = S.settings.apiModel || 'mistral';
  if (m === 'deepseek'){
    return {
      url:'https://api.deepseek.com/v1/chat/completions',
      model:'deepseek-chat',
      key:S.settings.apiKey
    };
  }
  return {
    url:'https://api.mistral.ai/v1/chat/completions',
    model:'mistral-small-latest',
    key:S.settings.apiKey
  };
}

/**
 * Авто-определение языковой пары. Кириллица в слове → ru→en, иначе en→ru.
 */
function detectLangPair(word){
  const hasCyr = /[А-Яа-яЁё]/.test(word);
  const hasLat = /[A-Za-z]/.test(word);
  if (hasCyr && !hasLat) return {src:'русского', tgt:'английский'};
  return {src:'английского', tgt:'русский'};
}

function buildWordPrompt(word){
  const {src, tgt} = detectLangPair(word);
  return `Ты профессиональный лингвист. Переведи слово "${word}" с ${src} на ${tgt}.
Верни ТОЛЬКО валидный JSON без markdown:
{"word":"оригинал","transcription":"МФА или транслит","meanings":[{"pos":"часть речи","translation":"перевод","definition":"определение","example_original":"пример на исходном языке","example_translated":"пример на целевом языке"}],"synonyms":["s1"],"antonyms":["a1"]}
synonyms/antonyms — [] если нет.`;
}

async function callLLM(prompt){
  const cfg = getApiCfg();
  if (!cfg.key) throw new Error('API ключ не задан — зайди в Настройки');

  const res = await fetch(cfg.url, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer ' + cfg.key
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 1200,
      messages:[{role:'user', content:prompt}]
    })
  });

  const data = await res.json();
  if (!res.ok || data.error){
    throw new Error(data.error?.message || data.message || ('HTTP ' + res.status));
  }

  const raw = data.choices?.[0]?.message?.content || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}
