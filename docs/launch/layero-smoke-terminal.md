# Layero Smoke Test — запуск из терминала Mac

14 октября 2026: единственная согласованная повторная загрузка CLI в окружении
агента завершилась ECONNRESET. Дальнейшие загрузки агент не предпринимает.
Эти команды предназначены для обычного терминала владельца на том же Mac.
Разрешено ровно одно создание проекта и один деплой. PHP и основной RE не менять.

Выполнять шаги последовательно. При любой ошибке остановиться: не запускать
deploy повторно, не менять тариф, не вводить карту и не включать платные услуги.
Не запускать команды из корня RE: загружается только infra/layero-smoke.

## 1. Официальный CLI и device-flow

```sh
cd /Users/matveyabramov/Documents/GitHub/recase-landing/infra/layero-smoke
npx --yes --registry=https://registry.npmjs.org --fetch-timeout=30000 --fetch-retries=0 layero@latest login --json
```

CLI выдаст `auth_required` с `url` и `user_code`: открыть именно полученную
официальную ссылку, войти в нужный аккаунт и подтвердить доступ. Оставить
терминал работающим до `authorized` и завершения команды. Если появляется
требование оплаты — остановиться. Не использовать `--claim`: это не runtime.

Команды ниже используют npm-кэш (`--offline` относится только к npm), поэтому
CLI повторно не скачивается. Сетевые вызовы самого Layero CLI работают обычно.
Если npm сообщает, что пакета нет в кэше, остановиться и сообщить ошибку.

## 2. Проверить отсутствие проекта и план, без публикации

```sh
npx --offline --yes --registry=https://registry.npmjs.org layero@latest projects list --json
npx --offline --yes --registry=https://registry.npmjs.org layero@latest deploy --dry-run --json
```

Если проект `re-layero-free-smoke` уже существует или план сообщает, что папка
связана с другим проектом, не выполнять шаг 3: предоставить вывод для проверки,
чтобы не создать второй проект и не заменить чужое приложение.
У плана должны быть `confident: true` и `runtime_kind: node_web`.
Не изменять глобальный npm registry/proxy. Проверка тарифа отменена владельцем.

## 3. Единственное создание проекта и единственный деплой

Только если авторизация, список проектов и dry-run завершились успешно:

```sh
npx --offline --yes --registry=https://registry.npmjs.org layero@latest deploy --name re-layero-free-smoke --yes --json
```

Команда создаёт проект и загружает только текущую тестовую папку.
Не запускать `project_create` отдельно и не повторять deploy. GitHub не подключается,
git push отсутствует, конфигурация Node runtime уже подготовлена.
При ошибке сохранить события `project_created`, `deploy_started`, `error`,
если они были. Не считать отсутствие `ready` разрешением повторить команду:
проект/деплой могли уже создаться. `plan_limit`/HTTP 402 — остановка без оплаты.

При успехе сохранить JSON-событие `ready`, включая `url` и состояние `edge_ready`.
Адрес брать только из `ready.url`, не составлять из имени проекта.

## 4. HTTPS, health и SMTP без письма

Заменить `PASTE_READY_URL_HERE` точным адресом `ready.url` из шага 3:

```sh
RE_SMOKE_URL='PASTE_READY_URL_HERE'
RE_SMOKE_QA=$(mktemp -d /tmp/re-layero-smoke.XXXXXX)
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 65 \
  -H 'Cache-Control: no-cache' \
  -D "$RE_SMOKE_QA/health-before.headers" \
  -o "$RE_SMOKE_QA/health-before.json" \
  "${RE_SMOKE_URL%/}/api/health"
cat "$RE_SMOKE_QA/health-before.json"
```

HTTPS проверяется обычной проверкой сертификата curl: не добавлять `-k`.
В заголовках нужен HTTP 200, в JSON — `ok: true`,
`application: re-layero-free-smoke` и фактическая версия Node в `runtime`.
Если это страница платформы, HTML или ошибка — SMTP не запускать, сохранить ответ.

Только после успешного health выполнить один пустой POST:

```sh
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 65 \
  -X POST -H 'X-Smoke-Probe: tcp-tls-only' -H 'Content-Length: 0' \
  -D "$RE_SMOKE_QA/smtp.headers" -o "$RE_SMOKE_QA/smtp.json" \
  "${RE_SMOKE_URL%/}/api/smtp-probe"
cat "$RE_SMOKE_QA/smtp.json"
```

Проверяются smtp.beget.com и smtp.yandex.ru на 465/587. Имена/контакты,
SMTP-пароли и AUTH/MAIL FROM/RCPT TO/DATA не передаются. `results[].ok`,
`tcpConnected`, `tlsVerified`, `smtpGreeting` определяют результат каждой цели;
верхнее `ok` означает выполнение диагностики, а не успех всех соединений.
Успех TCP/TLS/220 не доказывает авторизацию или доставку. На Beget порт 587
не документирован, поэтому его отказ не доказывает блокировку Layero.

## 5. Наблюдение после простоя — без второго деплоя

После SMTP записать baseline:

```sh
date -u > "$RE_SMOKE_QA/baseline-time.txt"
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 65 \
  -H 'Cache-Control: no-cache' -o "$RE_SMOKE_QA/health-baseline.json" \
  -w 'total_seconds=%{time_total}\n' "${RE_SMOKE_URL%/}/api/health"
cat "$RE_SMOKE_QA/health-baseline.json"
```

Затем не обращаться к приложению 10 минут, закрыть вкладку и не запускать
мониторинг/опрос. После паузы выполнить:

```sh
date -u > "$RE_SMOKE_QA/after-idle-time.txt"
curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 65 \
  -H 'Cache-Control: no-cache' -o "$RE_SMOKE_QA/health-after-idle.json" \
  -w 'total_seconds=%{time_total}\n' "${RE_SMOKE_URL%/}/api/health"
cat "$RE_SMOKE_QA/health-after-idle.json"
```

Изменённый `instanceId`, новое `startedAt` и малый `uptimeMs` — свидетельство
нового процесса после простоя. Та же instanceId — холодный запуск не подтверждён,
возможна разморозка. Изменившийся responseId показывает новый ответ вместо
повторного кешированного JSON. Одна задержка не доказывает холодный запуск;
смена инстанса при балансировке также не доказывает удаление старого контейнера.

## 6. Что предоставить для итогового отчёта

Событие `ready`, точный URL, файлы health/SMTP и времена/задержки после простоя
из `$RE_SMOKE_QA`. Не передавать ~/.layero/config.json, токены, cookies,
платёжные или почтовые данные. Если команда упала — только код ошибки и
публичные идентификаторы проекта/деплоя, если они успели появиться.

Запуск PHP → Node миграции не разрешён. Даже успешный SMTP-тест не решает
потерю квитанций и rate limit при рестарте: постоянного хранилища здесь нет.
При обязательном сохранении нынешних гарантий использовать готовый Beget-пакет.

Проверенные официальные команды:
[CLI](https://docs.layero.ru/cli/commands/),
[JSON-события и device-flow](https://docs.layero.ru/en/cli/json-events/).
