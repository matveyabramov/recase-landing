<?php
declare(strict_types=1);
namespace Recase;
require_once __DIR__ . '/app.php';
require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/mysql.php';
require_once __DIR__ . '/telegram.php';

function dispatchNotification(MysqlLeadStore $store, string $id, array $config, int $now, ?callable $transport = null): string
{
    if (($config['telegram']['enabled'] ?? false) !== true) return 'pending';
    $claim = $store->claim($id, $config, $now);
    if ($claim === null) return 'skipped';
    $outcome = sendTelegram($claim, $config['telegram'], $transport);
    try { $store->complete($claim, $outcome, $now); }
    catch (\Throwable $error) { return 'uncertain'; } // Reserved sending row blocks another sender.
    return $outcome['status'];
}

function handleMysqlLead(array $request, array $config, ?MysqlLeadStore $store = null, ?callable $transport = null, ?int $now = null): array
{
    $cors = leadCors($request, $config);
    $result = $cors['response'] ?? processMysqlLead($request, $config, $store, $transport, $now);
    $result['headers'] = $cors['headers'];
    return $result;
}

function processMysqlLead(array $request, array $config, ?MysqlLeadStore $store, ?callable $transport, ?int $now): array
{
    $now ??= time();
    if (($request['method'] ?? '') !== 'POST') return response(405, 'method_not_allowed', 'Используйте POST для отправки заявки.');
    if (($request['declaredLength'] ?? 0) > MAX_BODY_BYTES || strlen($request['body'] ?? '') > MAX_BODY_BYTES) return response(413, 'request_too_large', 'Запрос слишком большой.');
    if (strtolower(trim(explode(';', $request['contentType'] ?? '')[0])) !== 'application/json') return response(415, 'unsupported_media_type', 'Используйте JSON для отправки заявки.');
    if (($config['enabled'] ?? false) !== true || !validMysqlConfig($config)) return unavailable();
    $ip = $request['remoteAddress'] ?? '';
    if (!filter_var($ip, FILTER_VALIDATE_IP) || $now >= retentionDeadline($config)) return unavailable();
    try { $input = json_decode($request['body'] ?? '', false, 8, JSON_THROW_ON_ERROR); }
    catch (\JsonException $error) { return response(400, 'invalid_json', 'Не удалось прочитать запрос.'); }
    if (!$input instanceof \stdClass) return response(400, 'invalid_json', 'Ожидается объект JSON.');
    $validated = validateLead((array) $input);
    if (isset($validated['errors'])) return response(422, 'validation_error', 'Проверьте заполнение формы.', ['fields' => $validated['errors']]);
    $lead = $validated['lead'];
    try {
        $store ??= new MysqlLeadStore(mysqlConnection($config));
        $saved = $store->save($lead, $config, $ip, $now);
    } catch (\Throwable $error) { return unavailable(); } // Never log SQL, input, DSN or credentials.
    if ($saved['status'] === 'conflict') return response(409, 'request_conflict', 'Обновите страницу перед отправкой изменённой заявки.');
    if ($saved['status'] === 'limited') return response(429, 'rate_limited', 'Слишком много попыток. Попробуйте позже.', ['retryAfter' => $saved['retryAfter']]);
    if ($saved['status'] !== 'accepted') return unavailable();
    // COMMIT has succeeded before any Telegram side effect. Retries never send directly.
    if ($saved['created']) {
        try { dispatchNotification($store, $lead['requestId'], $config, $now, $transport); }
        catch (\Throwable $error) { /* Persisted job remains for CLI/cron. */ }
    }
    return response(200, 'accepted', 'Заявка сохранена.');
}
