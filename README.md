# LinguaRead — PWA + TWA

Билингвальное приложение для чтения книг с переводчиком и интервальным повторением.

## Что это и почему так

Это твой существующий `linguaread.html`, упакованный в:
- **PWA** (Progressive Web App) — устанавливается как иконка на телефон, работает офлайн, обновляется автоматически
- **TWA** (Trusted Web Activity) — обёртка, которая превращает PWA в настоящий APK для Android

Один код — два способа использовать.

## Структура проекта

```
linguaread/
├── index.html                     ← твой код (с добавленными PWA-тегами)
├── manifest.webmanifest           ← описание PWA: имя, иконки, цвета
├── service-worker.js              ← кэш для офлайн-работы
├── icons/                         ← иконки приложения
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-192.png
│   └── icon-maskable-512.png
├── .well-known/
│   └── assetlinks.json            ← подтверждение для TWA (заполнится позже)
├── .github/workflows/
│   └── deploy.yml                 ← автодеплой на GitHub Pages
├── generate_icons.py              ← скрипт пересборки иконок (если нужно)
└── README.md
```

## Шаг 1: Залить на GitHub

```bash
cd linguaread
git init
git add .
git commit -m "PWA initial setup"
git branch -M main
git remote add origin https://github.com/<твой-логин>/linguaread.git
git push -u origin main
```

## Шаг 2: Включить GitHub Pages

1. На странице репозитория → **Settings** → **Pages**
2. **Source**: выбрать `GitHub Actions`
3. После первого пуша автоматически запустится workflow `Deploy to GitHub Pages`
4. Через 1-2 минуты сайт будет доступен по адресу:
   `https://<твой-логин>.github.io/linguaread/`

## Шаг 3: Установить как PWA на телефон

### Android (Chrome)
1. Открыть ссылку сайта
2. Меню (три точки) → **Установить приложение** / **Add to Home Screen**
3. Иконка появится на главном экране, запуск — как у обычного приложения

### iOS (Safari)
1. Открыть ссылку
2. Кнопка **Поделиться** → **На экран «Домой»**
3. Работает с ограничениями (нет push-уведомлений), но основной функционал в порядке

После установки приложение работает офлайн, кроме переводов (для них нужен интернет).

## Шаг 4: Собрать APK через Bubblewrap (TWA)

Bubblewrap — официальный CLI от Google для упаковки PWA в Android-приложение.

### Требования
- Node.js 18+
- JDK 17 (скачается автоматически при первом запуске)

### Установка и сборка

```bash
npm install -g @bubblewrap/cli

bubblewrap init --manifest=https://<твой-логин>.github.io/linguaread/manifest.webmanifest

bubblewrap build
```

При первом `init` Bubblewrap задаст вопросы:
- **Application ID**: `app.linguaread.twa` (или любой свой обратный домен)
- **Display name**: `LinguaRead`
- **Splash screen color**: `#0e0e0f`
- **Status bar color**: `#0e0e0f`
- **Signing key**: создать новый (запомни пароль!)

На выходе получишь:
- `app-release-signed.apk` — установить на телефон
- `app-release-bundle.aab` — для Google Play, если решишь публиковать

### Перенос APK на телефон

```bash
adb install app-release-signed.apk
```

или просто скинуть APK файл в Telegram себе и открыть на телефоне (надо включить "установка из неизвестных источников").

## Шаг 5: Активировать полноэкранный режим TWA

Чтобы при запуске APK не показывалась адресная строка, нужно подтвердить, что сайт и приложение принадлежат тебе.

1. После `bubblewrap build` посмотри SHA-256 fingerprint:
   ```bash
   bubblewrap fingerprint
   ```
2. Открой `.well-known/assetlinks.json`
3. Замени `REPLACE_WITH_YOUR_SHA256_FINGERPRINT_AFTER_GENERATING_KEYSTORE` на свой fingerprint
4. Замени `app.vercel.linguaread.twa` на свой `Application ID` из шага 4
5. Закоммить, пуш — GitHub Pages раздаст обновлённый файл
6. Переустанови APK — адресная строка исчезнет

## Известные ограничения и нюансы

### API ключ Mistral
Ключ хранится в `localStorage` браузера — он виден через DevTools. Это нормально для личного использования, но **не раздавай этот APK другим людям с твоим ключом внутри** — они увидят его и сожгут баланс.

Если когда-то захочешь сделать публичную версию — нужен бэкенд-прокси, который скрывает ключ. До тех пор — только для себя.

### Лимит localStorage
Браузеры дают 5-10 МБ под `localStorage`. Если набьёшь много книг — упрёшься. Тогда нужна миграция на IndexedDB (отдельная задача).

### iOS PWA
- Нет фоновой синхронизации
- localStorage может быть очищен через 7 дней неактивности (Safari)
- Для надёжного хранения на iOS придётся подключать IndexedDB

### Обновления
При деплое на GitHub Pages новая версия попадает к пользователям при следующем запуске PWA (Service Worker сам подтянет). В TWA версия сайта обновится автоматически, но если меняешь иконку или manifest — нужен новый APK.

Чтобы пользователи получили обновление быстрее, при каждом релизе меняй `VERSION` в `service-worker.js` (например, `v1.0.1`).

## Локальная проверка перед пушем

Service Worker требует HTTPS, но `localhost` — исключение. Запусти любой локальный сервер:

```bash
python3 -m http.server 8000
```

Открой `http://localhost:8000` в Chrome → DevTools → **Application** → **Manifest** (проверь, что всё заполнено) → **Service Workers** (должен быть активен).

## Если что-то пошло не так

| Проблема | Решение |
|----------|---------|
| Service Worker не регистрируется | Проверь, что ходишь по `https://` или `localhost`, не `file://` |
| Иконки кривые на телефоне | Проверь `purpose: "maskable"` в manifest и обнови иконки |
| После обновления остаётся старая версия | Очисти кэш браузера или обнови `VERSION` в `service-worker.js` |
| TWA показывает адресную строку | Проверь `.well-known/assetlinks.json` — должен быть твой fingerprint |
