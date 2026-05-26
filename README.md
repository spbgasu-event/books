# LinguaRead

Билингвальное приложение для чтения книг с переводчиком и интервальным повторением.

## Что внутри

- 📚 **Постраничное чтение** EN/RU с переключением одним тапом — позиция сохраняется при смене языка через якоря (доля прочитанной главы)
- 🔍 **Переводчик** через Mistral или DeepSeek API — словарная статья с транскрипцией, примерами, синонимами
- 🃏 **SRS-карточки** для запоминания слов (упрощённый SM-2, переделаем во второй итерации)
- 📝 **Словарь** с поиском и контекстом из книги
- 💾 **Локальное хранилище** через IndexedDB — приложение работает оффлайн (кроме переводов)
- 📱 **PWA** — устанавливается на телефон как обычное приложение

## Структура файлов

```
books/
├── index.html                 ← разметка
├── manifest.webmanifest       ← метаданные PWA
├── service-worker.js          ← офлайн-кэш
├── styles/                    ← CSS, разделённый по экранам
│   ├── main.css
│   ├── library.css
│   ├── reader.css
│   ├── review.css
│   ├── words.css
│   ├── settings.css
│   └── modal.css
├── js/                        ← модули JavaScript
│   ├── state.js               ← глобальное состояние
│   ├── db.js                  ← IndexedDB
│   ├── file-parsers.js        ← TXT/EPUB/FB2
│   ├── translator.js          ← Mistral/DeepSeek API
│   ├── srs.js                 ← алгоритм SM-2
│   ├── word-popup.js          ← попап перевода
│   ├── reader.js              ← постраничная читалка
│   ├── library.js             ← список книг
│   ├── review.js              ← карточки
│   ├── words.js               ← словарь
│   ├── settings.js            ← настройки
│   └── app.js                 ← инициализация
├── icons/                     ← PWA иконки
└── .github/workflows/         ← автодеплой на GitHub Pages
```

## Установка

### 1. Залить в репозиторий

```bash
git clone https://github.com/spbgasu-event/books.git
cd books
# распаковать архив сюда
git add .
git commit -m "v0.2 — modular structure"
git push
```

Или через веб-интерфейс GitHub: **Add file → Upload files** → перетащить всю папку.

### 2. Включить GitHub Pages

Settings → Pages → Source: **GitHub Actions**

Через 1-2 минуты сайт доступен на:
**https://spbgasu-event.github.io/books/**

### 3. Установить на iPhone

1. Открыть ссылку в **Safari** (не Chrome — Chrome на iOS не умеет в PWA)
2. Кнопка **«Поделиться»** → **«На экран Домой»**
3. Запускать с главного экрана — будет полноэкранно без панели Safari

### 4. Настроить API ключ

Открыть приложение → Настройки → Переводчик → вставить ключ Mistral.
Получить ключ: https://console.mistral.ai/api-keys

## Известные ограничения

- **iOS Safari** ограничивает PWA: данные могут быть удалены через 7 дней неактивности. Делай экспорт словаря периодически.
- **API-ключ** хранится локально, но виден в DevTools. Для личного использования это ок; не раздавай APK с твоим ключом другим людям.

## Дальнейшая разработка

**Итерация 2 (следующая):**
- Двусторонние карточки (EN→RU и RU→EN)
- Карточка показывает контекст с выделенным словом (а не отдельное слово)
- Подсветка прогресса слов прямо в тексте при чтении
- Более мягкий SRS — без сброса в 1 день при «снова»

**Итерация 3:**
- Озвучка через Web Speech API
- Книжная полка с обложками
- Статистика по книге

**Итерация 4:**
- Сборка APK через Bubblewrap (TWA)

## Сборка APK позже (TWA через Bubblewrap)

Когда PWA отлажена — можно одной командой сделать настоящий APK:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://spbgasu-event.github.io/books/manifest.webmanifest
bubblewrap build
```

Получишь `app-release-signed.apk` для установки на телефон.
