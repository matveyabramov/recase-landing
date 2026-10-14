<?php
declare(strict_types=1);

namespace Recase;

const MAX_BODY_BYTES = 4096;
const RECEIPT_TTL = 86400;
const RATE_WINDOW = 600;
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function response(int $http, string $status, string $message, array $extra = []): array
{
    return ['http' => $http, 'body' => array_merge([
        'ok' => $http === 200,
        'status' => $status,
        'message' => $message,
    ], $extra)];
}

function unavailable(): array
{
    return response(503, 'unavailable', 'Приём заявок временно недоступен. Попробуйте позже.');
}

function unicodeLength(string $value): int
{
    $count = preg_match_all('/./us', $value);
    return $count === false ? PHP_INT_MAX : $count;
}

function validateLead(array $input): array
{
    $fields = [];
    $allowed = ['name', 'contact', 'type', 'consent', 'requestId'];
    if (array_diff(array_keys($input), $allowed)) {
        $fields['form'] = 'В запросе есть неподдерживаемые поля.';
    }
    $name = is_string($input['name'] ?? null) ? trim($input['name']) : '';
    $contact = is_string($input['contact'] ?? null) ? trim($input['contact']) : '';
    $type = $input['type'] ?? null;
    $id = $input['requestId'] ?? null;
    if ($name === '' || unicodeLength($name) > 120
        || !preg_match("/\A\p{L}[\p{L}\p{M} .’'\-]*\z/u", $name)) {
        $fields['name'] = 'Укажите имя длиной до 120 символов без цифр и служебных символов.';
    }
    $phone = preg_match('/\A\+?[0-9 ()\-]+\z/D', $contact)
        && preg_match('/\A[0-9]{7,15}\z/D', preg_replace('/[^0-9]/', '', $contact));
    $telegram = preg_match('~\A(?:@|(?:https://)?t\.me/)[a-zA-Z][a-zA-Z0-9_]{4,31}\z~D', $contact);
    if ($contact === '' || unicodeLength($contact) > 160 || (!$phone && !$telegram)) {
        $fields['contact'] = 'Укажите один контакт: телефон (7–15 цифр) или Telegram @username.';
    }
    if (!in_array($type, ['participant', 'partner'], true)) {
        $fields['type'] = 'Неизвестный тип заявки.';
    }
    if (($input['consent'] ?? null) !== true) {
        $fields['consent'] = 'Необходимо согласие на обработку персональных данных.';
    }
    if (!is_string($id) || !preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/iD', $id)) {
        $fields['requestId'] = 'Обновите страницу и попробуйте снова.';
    }
    return $fields ? ['errors' => $fields] : ['lead' => [
        'name' => $name, 'contact' => $contact, 'type' => $type,
        'consent' => true, 'requestId' => strtolower($id),
    ]];
}

function validConfig(array $config): bool
{
    $origin = $config['site_origin'] ?? '';
    $parts = is_string($origin) ? parse_url($origin) : false;
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['path'])
        || isset($parts['query']) || isset($parts['fragment'])) {
        return false;
    }
    $smtp = $config['smtp'] ?? [];
    if (!is_array($smtp)) return false;
    foreach (['username', 'password', 'from', 'to', 'host'] as $key) {
        if (!is_string($smtp[$key] ?? null) || $smtp[$key] === '' || preg_match('/[\x00-\x1f\x7f]/', $smtp[$key])) return false;
    }
    if (!filter_var($smtp['from'], FILTER_VALIDATE_EMAIL) || !filter_var($smtp['to'], FILTER_VALIDATE_EMAIL)
        || !preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9.\-]*\z/D', $smtp['host'])
        || !in_array($smtp['encryption'] ?? null, ['smtps', 'starttls'], true)
        || !is_int($smtp['port'] ?? null) || $smtp['port'] < 1 || $smtp['port'] > 65535) {
        return false;
    }
    return is_string($config['rate_secret'] ?? null) && strlen($config['rate_secret']) >= 32
        && is_string($config['runtime_dir'] ?? null) && is_dir($config['runtime_dir'])
        && is_writable($config['runtime_dir'])
        && is_int($config['rate_limit'] ?? null) && $config['rate_limit'] >= 1 && $config['rate_limit'] <= 100;
}

// State has only keyed hashes, timestamps and statuses, never raw names/contacts/IPs.
// A single short flock transaction makes reservations atomic across PHP workers.
function stateTransaction(string $dir, callable $operation): array
{
    $file = $dir . '/lead-state.json';
    $handle = @fopen($file, 'c+');
    if ($handle === false) throw new \RuntimeException('state_unavailable');
    try {
        @chmod($file, 0600);
        if (!flock($handle, LOCK_EX | LOCK_NB)) throw new \RuntimeException('state_busy');
        $size = fstat($handle)['size'] ?? MAX_STATE_BYTES + 1;
        if ($size > MAX_STATE_BYTES) throw new \RuntimeException('state_limit');
        $raw = stream_get_contents($handle);
        if ($raw === false) throw new \RuntimeException('state_read');
        $state = $raw === '' ? [] : json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($state)) throw new \RuntimeException('state_invalid');
        $result = $operation($state);
        $encoded = json_encode($state, JSON_THROW_ON_ERROR);
        if (strlen($encoded) > MAX_STATE_BYTES) throw new \RuntimeException('state_limit');
        rewind($handle);
        if (!ftruncate($handle, 0) || fwrite($handle, $encoded) !== strlen($encoded) || !fflush($handle)) {
            throw new \RuntimeException('state_write');
        }
        return $result;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function reserve(array $config, string $ipKey, string $requestKey, string $fingerprint, int $now): array
{
    return stateTransaction($config['runtime_dir'], function (array &$state) use ($config, $ipKey, $requestKey, $fingerprint, $now): array {
        foreach ($state as $key => &$bucket) {
            $bucket['attempts'] = array_values(array_filter($bucket['attempts'], static fn ($at) => $at > $now - RATE_WINDOW));
            $bucket['receipts'] = array_filter($bucket['receipts'], static fn ($item) => $item['at'] > $now - RECEIPT_TTL);
            if (!$bucket['attempts'] && !$bucket['receipts']) unset($state[$key]);
        }
        unset($bucket);
        $bucket = $state[$ipKey] ?? ['attempts' => [], 'receipts' => []];
        $receipt = $bucket['receipts'][$requestKey] ?? null;
        if ($receipt !== null) {
            if (!hash_equals($receipt['fingerprint'], $fingerprint)) return ['status' => 'conflict'];
            return ['status' => $receipt['status']];
        }
        if (count($state) >= 2048 && !isset($state[$ipKey])) return ['status' => 'limited', 'retryAfter' => RATE_WINDOW];
        if (count($bucket['receipts']) >= 256) return ['status' => 'limited', 'retryAfter' => RECEIPT_TTL];
        if (count($bucket['attempts']) >= $config['rate_limit']) {
            return ['status' => 'limited', 'retryAfter' => max(1, min($bucket['attempts']) + RATE_WINDOW - $now)];
        }
        $bucket['attempts'][] = $now;
        $bucket['receipts'][$requestKey] = ['at' => $now, 'status' => 'pending', 'fingerprint' => $fingerprint];
        $state[$ipKey] = $bucket;
        return ['status' => 'reserved'];
    });
}

function finish(array $config, string $ipKey, string $requestKey, string $status): void
{
    stateTransaction($config['runtime_dir'], function (array &$state) use ($ipKey, $requestKey, $status): array {
        if (!isset($state[$ipKey]['receipts'][$requestKey])) throw new \RuntimeException('reservation_lost');
        $state[$ipKey]['receipts'][$requestKey]['status'] = $status;
        return [];
    });
}

function emailContent(array $lead, int $now): array
{
    $type = $lead['type'] === 'participant' ? 'Участник' : 'Партнёр';
    return [
        'subject' => $lead['type'] === 'participant' ? 'RE:CASE — заявка участника' : 'RE:CASE — заявка партнёра',
        'body' => "Тип заявки: {$type}\nИмя: {$lead['name']}\nКонтакт: {$lead['contact']}\nВремя поступления: " . gmdate('Y-m-d H:i:s', $now) . " UTC\n",
    ];
}

function handleLead(array $request, array $config, callable $send, ?int $now = null): array
{
    $now = $now ?? time();
    if (($request['method'] ?? '') !== 'POST') return response(405, 'method_not_allowed', 'Используйте POST для отправки заявки.');
    if (($request['declaredLength'] ?? 0) > MAX_BODY_BYTES || strlen($request['body'] ?? '') > MAX_BODY_BYTES) {
        return response(413, 'request_too_large', 'Запрос слишком большой.');
    }
    if (strtolower(trim(explode(';', $request['contentType'] ?? '')[0])) !== 'application/json') {
        return response(415, 'unsupported_media_type', 'Используйте JSON для отправки заявки.');
    }
    if (($config['enabled'] ?? false) !== true || !validConfig($config)) return unavailable();
    if (($request['https'] ?? false) !== true
        || !hash_equals($config['site_origin'], $request['origin'] ?? '')
        || !in_array($request['fetchSite'] ?? '', ['', 'same-origin'], true)) {
        return response(403, 'forbidden', 'Отправляйте заявку с сайта RE:CASE по HTTPS.');
    }
    $ip = $request['remoteAddress'] ?? '';
    if (!filter_var($ip, FILTER_VALIDATE_IP)) return unavailable();
    try {
        $object = json_decode($request['body'] ?? '', false, 8, JSON_THROW_ON_ERROR);
    } catch (\JsonException $e) {
        return response(400, 'invalid_json', 'Не удалось прочитать запрос.');
    }
    if (!$object instanceof \stdClass) return response(400, 'invalid_json', 'Ожидается объект JSON.');
    $validated = validateLead((array) $object);
    if (isset($validated['errors'])) return response(422, 'validation_error', 'Проверьте заполнение формы.', ['fields' => $validated['errors']]);
    $lead = $validated['lead'];
    $ipKey = hash_hmac('sha256', $ip, $config['rate_secret']);
    $requestKey = hash_hmac('sha256', $lead['requestId'], $config['rate_secret']);
    $fingerprint = hash_hmac('sha256', json_encode([$lead['type'], $lead['name'], $lead['contact']], JSON_THROW_ON_ERROR), $config['rate_secret']);
    $reserved = false;
    try {
        $reservation = reserve($config, $ipKey, $requestKey, $fingerprint, $now);
        if ($reservation['status'] === 'accepted') return response(200, 'accepted', 'Заявка передана почтовому серверу.');
        if ($reservation['status'] === 'limited') {
            return response(429, 'rate_limited', 'Слишком много попыток. Попробуйте позже.', ['retryAfter' => $reservation['retryAfter']]);
        }
        if (in_array($reservation['status'], ['pending', 'uncertain'], true)) {
            return response(409, 'submission_unconfirmed', 'Статус предыдущей отправки уточняется. Не отправляйте заявку повторно; обратитесь к организаторам.');
        }
        if ($reservation['status'] === 'conflict') return response(409, 'request_conflict', 'Обновите страницу перед отправкой изменённой заявки.');
        $reserved = true;
        if ($send(emailContent($lead, $now), $config['smtp']) !== true) {
            throw new \RuntimeException('smtp_not_accepted');
        }
        finish($config, $ipKey, $requestKey, 'accepted');
        return response(200, 'accepted', 'Заявка передана почтовому серверу.');
    } catch (\Throwable $e) {
        // Do not log SMTP ErrorInfo, input, credentials, addresses or stack traces.
        // Retain uncertainty: an SMTP error after DATA can occur after acceptance.
        if (!$reserved) return unavailable();
        try {
            finish($config, $ipKey, $requestKey, 'uncertain');
        } catch (\Throwable $ignored) {
            // A pending reservation also blocks an unsafe automatic resend.
        }
        return response(502, 'submission_unconfirmed', 'Не удалось подтвердить отправку. Не отправляйте заявку повторно; обратитесь к организаторам.');
    }
}
