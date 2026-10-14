# RE:CASE — лендинг студенческого хакатона

Минимальный проект на Vite, HTML5, CSS3 и Vanilla JavaScript (ES Modules).
Реализован Desktop по исходному макету Figma через Figma MCP.
Добавлена плавная коррекция масштаба для десктопных ширин 1024–1920 px:
контейнер 1200 px, компактная типографика и исправленная геометрия pixel UI.
Завершён Desktop Polish: внутренние отступы четырёх секций, обновлённые
иконки Figma и общие hover/press/focus-состояния с поддержкой reduced motion.
Реализован адаптив всей страницы до 320 px: планшеты 1024/768/744 px и телефоны
390/320 px. Ниже 1024 px включается компактное меню, ниже 600 px — мобильные
композиции. Desktop 1512 px сохраняется. Лента экспертов прокручивается по
горизонтали без видимого scrollbar; карточки, этапы, CTA и попапы заявок
адаптируются к экрану. Tablet/Mobile сверены с Figma: hero объединяет компьютер
и CTA в один слой, статистика и эффекты идут вертикально. Партнёрский баннер
на Tablet оставлен горизонтальным по продуктовому уточнению.

## Запуск

Требования Vite: Node.js 20.19+ в ветке 20.x либо Node.js 22.12+ и npm.
Рекомендуется совместимая LTS-версия Node.js.

```sh
npm ci
npm run dev
```

Для локальной проверки Яндекс Форм скопируйте `.env.development.example` в
`.env.development.local` и перезапустите Vite. Это публичные URL, без токенов.
Откройте локальный адрес, который Vite выведет в терминале.

## Сборка и проверка

```sh
npm run build
npm run preview
```

Готовая сборка находится в `dist/`. Для статического хостинга загрузите
содержимое этой папки. По умолчанию Vite использует `base: './'`: такая сборка
подходит для статического preview с отключёнными формами. Production frontend:
Layero; заявки — через iframe Яндекс Форм. Beget сохранён как резерв. Переменная `VITE_BASE_PATH`
позволяет задать другой путь публикации, не меняя конфигурацию.

## GitHub Pages

Репозиторий: `matveyabramov/recase-landing`.
Адрес сайта: https://matveyabramov.github.io/recase-landing/.

1. В репозитории откройте **Settings → Pages → Build and deployment**.
2. В поле **Source** выберите **GitHub Actions**.
3. Сделайте commit и push изменений в `main`. Workflow `Deploy to GitHub Pages`
   установит зависимости через `npm ci`, выполнит сборку и опубликует только `dist/`.
4. Дождитесь успешного выполнения build и deploy во вкладке **Actions**,
   затем откройте адрес сайта. Workflow также можно запустить через **Run workflow**.

Путь берётся из `actions/configure-pages`: для этого репозитория
`VITE_BASE_PATH=/recase-landing/`. При подключении собственного домена Pages
сборка получит `/`. HTML, CSS, JS, изображения и локальные шрифты проходят
через production build Vite; публиковать исходный `index.html` и `src/` напрямую
не нужно. `dist/` исключён из Git и передаётся как Pages artifact.

Локальная проверка сборки с тем же путём, что у GitHub Pages:

```sh
VITE_BASE_PATH=/recase-landing/ npm run build
VITE_BASE_PATH=/recase-landing/ npm run preview
```

Откройте `http://localhost:4173/recase-landing/` (либо порт из вывода Vite).
Для Beget выполните `npm run prepare:beget`: он создаёт отдельный пакет с API,
не заменяя статический `dist/`. См. [инструкцию деплоя](docs/beget-deploy.md).

## Структура

- `index.html` — семантическая разметка лендинга и метаданные.
- `src/main.js` — точка входа JavaScript и подключение CSS.
- `src/navigation.js` — компактное меню, закрытие и сброс при смене ширины.
- `src/config.js` — URL и содержимое двух вариантов модального окна.
- `src/modal.js` — общее окно, focus, scroll lock и подключение CTA.
- `src/yandex-form.js` — iframe, однократная загрузка embed.js, загрузка и fallback.
- `src/yandex-form-config.js` — проверка публичных URL и режимов включения.
- `src/lead-form.js` — резервная реализация PHP API, не импортируется сайтом.
- `src/styles/tokens.css` — палитра и шрифты Figma, токены оптической коррекции.
- `src/styles/global.css` — шрифты, общие стили и базовые элементы.
- `src/styles/desktop.css` — композиция Desktop 1512 px.
- `src/styles/decorations.css` — объединённая векторная геометрия декора.
- `src/styles/pixel-ui.css` — общая геометрия pixel-outline и статичные particles.
- `src/styles/responsive.css` — fluid-размеры, планшетные и мобильные композиции.
- `src/styles/interactions.css` — состояния UI, keyboard focus и reduced motion.
- `src/styles/modal.css` — адаптивная оболочка модального окна.
- `public/assets/images/`, `icons/`, `fonts/` — локальные ресурсы дизайна.
- Роадмап использует исходные SVG через `border-image`: контуры краёв сохраняют
  пропорции, центральная область растёт с текстом.
- `docs/desktop-design.md` — анализ исходного макета и принятые решения.
- `docs/assets.json` — соответствие локальных ассетов исходным узлам Figma.
- `docs/desktop-polish.md` — актуальные отступы, иконки, состояния UI и финальный QA.
- `docs/comprehensive-refinement.md` — масштаб и исправления геометрии предыдущего этапа.
- `docs/responsive-refinement.md` — отчёт предыдущего этапа.
- `vite.config.js` — конфигурация Vite.
- `api/lead.php` — публичный PHP-bootstrap API.
- `server/` — приватная валидация, MySQL/Telegram, SQL, CLI/cron и сохранённый SMTP backend.
- `scripts/prepare-beget.mjs` — отдельная production-сборка с PHP и зависимостями.
- `tests/lead-test.php` — сохранённые проверки PHP/SMTP без соединения.
- `tests/mysql-telegram-test.php` — MySQL, параллельные запросы и Telegram mock.
- `tests/run-mysql-tests.mjs` — одноразовая локальная MySQL без TCP.

## Заявки и юридические документы

Три CTA «Участвовать» и две «Стать партнёром» открывают общий dialog
с соответствующим iframe Яндекс Формы. Все поля, согласие, отправка и успешное
состояние находятся внутри Яндекс Форм. Старые поля и кастомная благодарность
не отображаются, запросы к Beget из активного frontend удалены.

Публичные URL задаются через `VITE_YANDEX_PARTICIPANT_FORM_URL` и
`VITE_YANDEX_PARTNER_FORM_URL`. Локальный `npm run dev` использует
`.env.development.local`. Обычный `npm run build` и GitHub Pages отключают формы.
Будущая сборка `npm run build:layero` включает обе формы только при явном
`VITE_YANDEX_FORMS_ENABLED=true` и настроенных URL. В `.env.layero.example`
включение оставлено `false`. Ни сборка, ни локальная проверка не публикуют сайт.

Ширина iframe — 100%; официальный `embed.js` подключается один раз и меняет
высоту по сообщениям Яндекса. При недоступности скрипта остаются исходная
высота 800 px и штатная прокрутка iframe.
Кнопка закрытия остаётся видимой при прокрутке. На закрытии iframe удаляется;
при повторном открытии загружается новая форма. Черновик может быть потерян.
DOM сторонней формы сайт не читает, события load не трактуются как отправка.

Настройки Telegram остаются исключительно на стороне Яндекс Форм.
Backend Beget, миграции, прежний модуль формы и документация физически сохранены
как резерв, но не подключены к рабочему сценарию. Старые инструкции API ниже
и в документации Beget относятся к этому резерву.

Подробности интеграции, проверки и ограничения:
[docs/yandex-forms-integration.md](docs/yandex-forms-integration.md).

`privacy-policy.html` основана на реально полученном тексте генератора Tilda.
`personal-data-consent.html` — отдельный документ. Указаны оператор Спиридонова
Диана Романовна (физическое лицо), `dinrinx@mail.ru`, 18+ и хранение не более
месяца после окончания хакатона. Оставшиеся сведения отмечены TODO; документы
требуют утверждения оператором. Адрес получателя заявок задаётся в приватной
серверной конфигурации и не выводится из email для обращений.

Подготовка пакета: `npm run prepare:beget`. Настройки MySQL/Telegram и `enabled` задаются
на Beget в `private/recase-server/config.php` вне `public_html`. Реального config,
паролей, токена, chat_id и данных в пакете нет. Node.js нужен для сборки, не для backend.
По указанию владельца выбран полный текст Telegram; сам приём пока выключен.
Дата окончания в примере — 15 ноября 2026, удаление через календарный месяц.
Юридические страницы требуют отдельного согласования под эту новую схему;
они не изменялись на этапе MySQL/Telegram. Прежний PHP/SMTP backend сохранён.
Локальные проверки: `npm run test:php`, `npm run test:cors`, `npm run test:mysql`,
`npm run test:frontend`.
Полная инструкция и checklist: [docs/beget-deploy.md](docs/beget-deploy.md).

Vite собирает три HTML entry points. Production-настройки Яндекс Форм:
`.env.layero.example`; перед релизом используйте новый checklist интеграции.
[Резервная инструкция Layero/Beget](docs/layero-deploy.md).
Исторический исходник Tilda: [docs/legal/README.md](docs/legal/README.md).
Текущие проверки и ограничения: [docs/launch/README.md](docs/launch/README.md).

Текст набран локальными Ermilov Bold 700 и Onest Variable 100–900 (WOFF2).
Пиксельные номера и подписи сохранены в SVG с текстом в кривых.
Имена партнёров и экспертов пока повторяют заглушки из Figma.

Дизайн, тексты, цвета и ресурсы добавляются только на основе Figma.
Сайт подключает официальный скрипт и iframe Яндекс Форм; внешние запросы
внутри iframe контролирует Яндекс. Собственная аналитика сайта не добавлена.
Зависимости, сборка, `.env` и локальные секреты исключены из Git через `.gitignore`.
