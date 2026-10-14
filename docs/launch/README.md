# RE — Layero Frontend + Beget PHP API

Актуальный отчёт, 14 октября 2026. Этот этап выполнен локально: без deploy,
создания облачных ресурсов, SQL на Beget, push и реальных заявок.
Архитектура: Layero Free (Vite static) → HTTPS Beget API → существующая
`matveyyb_recase` → существующий `@recase_appl_bot`, группа `-5275551751`.
Smoke-проект не используется для production. База/бот и применённая v1 сохранены.

## Изменения этого этапа

- `server/cors.php` — точный HTTPS Origin из приватного `site_origin`, запрет
  wildcard/посторонних origin, preflight POST JSON, Vary, без credentials.
- `server/mysql-app.php`, `server/mysql.php` — CORS перед обработкой, проверка
  конфигурации; MySQL/Telegram транзакции, rate limit и доставка сохранены.
- `api/lead.php` — чтение preflight headers, CORS response headers, OPTIONS 204.
- `server/config.example.php` — origin пустой до подтверждения, intake false.
- `src/lead-api-config.js`, `src/config.js` — публичные Vite settings, отдельный
  production-mode `layero`, API URL/origin и явное включение.
- `src/lead-form.js` — новый URL, runtime origin gate, запрет localhost/Pages,
  credentials omit, CORS, отказ от redirects и передачи Referer.
  Поля, тексты, чекбоксы, markup, стили, modal и анимации этого этапа не менялись.
  Благодарность по прежнему контракту accepted после сохранения; ошибки сохраняют
  введённое и согласие, повтор тех же данных сохраняет UUID.
- `.env.layero.example`, `package.json` — пример публичных переменных,
  `build:layero`, `test:cors`, `test:frontend`.
- `.github/workflows/deploy.yml` — явное выключение API и очистка URL/origin
  при Pages build; обычный production mode тоже запрещает отправку.
- `scripts/prepare-beget.mjs`, `.gitignore` — отдельный backend-only
  `beget-api-package/`, без frontend/config.php/SQL/migration runner.
  Старый `beget-package/` оставлен как прежний артефакт, не использовать.
- `tests/cors-test.php`, `tests/frontend-api.test.mjs`,
  `tests/mysql-telegram-test.php`, `tests/run-mysql-tests.mjs` — целевые проверки,
  CGI CORS, fictional cross-site origin и диагностика локального harness.
- `vite.config.js` — только уточнение комментария.
- `README.md`, `docs/beget-deploy.md`, `docs/layero-deploy.md`, этот отчёт и
  `docs/launch/layero-beget-qa.json` — независимые деплои и результаты.

## Проверки

- PHP legacy: **72 PASS**, без SMTP.
- CORS: **32 PASS** — точный origin, foreign/null/missing/HTTP/Pages/smoke,
  отсутствие wildcard/credentials, preflight и fail closed.
- MySQL/Telegram: **169 PASS** на PHP 8.3.35 / MySQL 8.4.11. Только disposable
  локальная БД через Unix socket, TCP отключён; после тестов удалена.
  Production config/база не используются, Telegram transport — mock.
- CGI проверяет реальные headers публичного bootstrap: OPTIONS 204 с пустым
  телом, разрешённый/запрещённый origin, JSON POST, 400/403/405/422/503,
  дедуп и private/config permissions. Ошибки имеют CORS для разрешённого origin.
- Браузер: **16/16 PASS** — participant (390px), partner (1512px), благодарность,
  network/503/HTML/422/409/429 ошибки, сохранность полей/consent, UUID на повторе
  и новый UUID после изменения, отсутствие отправки без согласия, на Pages,
  localhost, другом origin, ordinary preview и закрытой Layero-сборке.
- Синтаксис: **20 PHP файлов PASS**.
- Сборки `build`, `build:layero`, Pages base `/recase-landing/` проходят.
- Проверен backend-only пакет: единственный public файл — `api/lead.php`,
  CORS-модуль в private, config.php/SQL/migrate.php отсутствуют, defaults закрыты.
- В static output нет PHP/SQL. Подставленные вымышленные MySQL/Telegram
  secret-маркеры отсутствуют во всех собранных файлах.

Браузерные тесты запускаются через `npm run test:frontend`. Нужен установленный
Playwright; при использовании desktop runtime передать `RECASE_TEST_NODE_MODULES`
(путь к node_modules) и при необходимости `RECASE_TEST_BROWSER` (путь к Chrome).
Тесты строят временные артефакты и перехватывают **все** браузерные запросы.
Фактическое соединение с Beget/Telegram не выполняется. Успех/сбой API в браузере
моделируется; это не production E2E.

Свежий HEAD к HTTPS API без тела заявки завершился curl 35 /
`SSL_ERROR_SYSCALL`, HTTP 000. Из этой среды доступность/сертификат Beget
не подтверждены; это не доказывает ошибку сертификата. Серверные проверки
и реальные E2E остаются обязательными после разрешения на размещение.

## Что подтверждено в backend

Сохранение и задание уведомления commit-ятся до Telegram. Типы participant/partner
раздельные; UUID/fingerprint предотвращают повтор и конфликт payload, HMAC IP
обеспечивает атомарный скользящий лимит. Невалидные поля/consent отвергаются.
Логи приложения/CLI не содержат имени, контакта, raw IP, SQL или секретов.
Это не гарантия отсутствия IP в собственных access logs хостинга: их доступы и
retention настраивает владелец. Cookies и credentials для формы не нужны.

Ошибка Telegram не отменяет сохранённую заявку. Definite failures повторяются
через private CLI с backoff и лимитом; uncertain не повторяется автоматически.
`retry-notifications.php`, `resolve-notification.php`, `status.php`, `cleanup.php`
сохранены. TLS peer/hostname и HTTPS проверки не ослаблены.
Секреты только вне public_html; config с закрытыми правами 0600.

## Действия владельца после разрешения

1. [Layero](../layero-deploy.md): проверить Free/квоту проектов, создать основной
   проект с желаемым именем `recase`, получить фактический адрес. Free подходит
   статическому Vite без Node runtime; платформа сохраняет плашку/noindex.
2. [Beget](../beget-deploy.md): загрузить новый API-пакет, создать/обновить private
   config (сохранить существующий rate_secret), подключить существующую БД/бота,
   задать **полученный** Layero origin. SQL повторно не применять.
3. Проверить PHP для web/cron, PDO/cURL, HTTPS сертификат и HTTP→HTTPS, закрытость
   private на всех доменах, доступ к MySQL/Telegram, задания retry/cleanup/status.
4. Согласовать обработку данных/документы/версию согласия/удаление и доступы;
   отдельно разрешить две синтетические E2E заявки, проверить строки, сообщение,
   благодарность и повторы. Затем отдельно разрешить реальные заявки.

До этого frontend и server intake выключены; origin не угадан, секреты не заданы.
Готовый `dist/` — Layero-сборка с выключенной отправкой. Деплой не выполнен.
[Машинный отчёт](layero-beget-qa.json).
