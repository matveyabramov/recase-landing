<?php
declare(strict_types=1);
namespace Recase;

function telegramPayload(array $lead, array $config): array
{
    $full = ($config['personal_data_enabled'] ?? false) === true && $lead['notification_mode'] === 'full';
    $text = 'RE:CASE: новая заявка сохранена. Подробности доступны организаторам в защищённом хранилище.';
    if ($full) {
        $type = $lead['lead_type'] === 'participant' ? 'Участник' : 'Партнёр';
        $text = "RE:CASE — новая заявка\nТип: {$type}\nИмя: {$lead['name']}\nКонтакт: {$lead['contact']}\nПолучена: "
            . gmdate('Y-m-d H:i:s', (int) $lead['received_at']) . ' UTC';
    }
    return ['chat_id' => $config['chat_id'], 'text' => $text,
        'protect_content' => true, 'allow_paid_broadcast' => false,
        'link_preview_options' => ['is_disabled' => true]]; // Plain text: no parse_mode.
}

function telegramCurlOptions(string $body): array
{
    return [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8, CURLOPT_VERBOSE => false];
}

function telegramTransport(string $token, array $payload): array
{
    $curl = curl_init('https://api.telegram.org/bot' . $token . '/sendMessage');
    if ($curl === false) return ['errno' => 2, 'http' => 0, 'body' => '', 'uploaded' => 0];
    $response = '';
    try {
        curl_setopt_array($curl, telegramCurlOptions(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)));
        curl_setopt($curl, CURLOPT_WRITEFUNCTION, static function ($handle, string $chunk) use (&$response): int {
            if (strlen($response) + strlen($chunk) > 32768) return 0;
            $response .= $chunk; return strlen($chunk);
        });
        curl_exec($curl);
        return ['errno' => curl_errno($curl), 'http' => (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE),
            'uploaded' => (int) curl_getinfo($curl, CURLINFO_SIZE_UPLOAD_T), 'body' => $response];
    } finally { curl_close($curl); }
}

function classifyTelegram(array $response): array
{
    $errno = (int) ($response['errno'] ?? 0);
    if ($errno !== 0) {
        // Only proven pre-send failures are retryable. Timeouts always remain uncertain.
        $safe = in_array($errno, [2, 5, 6, 7, 35, 60, 77], true) && (int) ($response['uploaded'] ?? -1) === 0;
        return ['status' => $safe ? 'failed' : 'uncertain', 'errorCode' => $safe ? 'telegram_preconnect_failed' : 'telegram_transport_uncertain'];
    }
    $http = (int) ($response['http'] ?? 0);
    try { $data = json_decode($response['body'] ?? '', true, 16, JSON_THROW_ON_ERROR); }
    catch (\Throwable $error) { $data = null; }
    if ($http === 200 && is_array($data) && ($data['ok'] ?? null) === true
        && is_int($data['result']['message_id'] ?? null) && $data['result']['message_id'] > 0) {
        return ['status' => 'sent', 'messageId' => $data['result']['message_id']];
    }
    if (in_array($http, [400, 401, 403, 404, 429], true) && is_array($data)
        && ($data['ok'] ?? null) === false && ($data['error_code'] ?? null) === $http) {
        $after = $data['parameters']['retry_after'] ?? 0;
        return ['status' => 'failed', 'errorCode' => 'telegram_rejected_' . $http,
            'retryAfter' => is_int($after) && $after >= 0 ? $after : 0];
    }
    // 5xx, malformed JSON and lost success receipts must not cause blind resend.
    return ['status' => 'uncertain', 'errorCode' => 'telegram_response_uncertain'];
}

function sendTelegram(array $lead, array $config, ?callable $transport = null): array
{
    if (!is_string($config['token'] ?? null)
        || !preg_match('/\A[0-9]{5,20}:[a-zA-Z0-9_\-]{20,200}\z/D', $config['token'])
        || !is_string($config['chat_id'] ?? null) || !preg_match('/\A-?[0-9]{1,20}\z/D', $config['chat_id'])
        || ($transport === null && !extension_loaded('curl'))) {
        return ['status' => 'failed', 'errorCode' => 'telegram_configuration_invalid'];
    }
    try { return classifyTelegram(($transport ?? __NAMESPACE__ . '\\telegramTransport')($config['token'], telegramPayload($lead, $config))); }
    catch (\Throwable $error) { return ['status' => 'uncertain', 'errorCode' => 'telegram_transport_exception']; }
}
