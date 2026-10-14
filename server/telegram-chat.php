<?php
declare(strict_types=1);
require_once __DIR__ . '/cli.php';
if ($argc !== 2 || !in_array($argv[1], ['--discover', '--verify'], true)) {
    fwrite(STDERR, "Usage: php telegram-chat.php --discover|--verify\n"
        . "Read-only HTTPS: no sendMessage, no raw updates or member identities printed.\n"); exit(2);
}
try {
    $config = \Recase\cliConfig();
    $telegram = $config['telegram'];
    if (!is_string($telegram['token'] ?? null)
        || !preg_match('/\A[0-9]{5,20}:[a-zA-Z0-9_\-]{20,200}\z/D', $telegram['token'])) throw new RuntimeException('invalid_token');
    $method = $argv[1] === '--discover' ? 'getUpdates' : 'getChat';
    $payload = $method === 'getUpdates' ? ['timeout' => 0, 'limit' => 100]
        : ['chat_id' => $telegram['chat_id']];
    $curl = curl_init('https://api.telegram.org/bot' . $telegram['token'] . '/' . $method);
    $body = '';
    try {
        curl_setopt_array($curl, \Recase\telegramCurlOptions(json_encode($payload, JSON_THROW_ON_ERROR)));
        curl_setopt($curl, CURLOPT_WRITEFUNCTION, static function ($handle, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > 1048576) return 0;
            $body .= $chunk; return strlen($chunk);
        });
        curl_exec($curl);
        if (curl_errno($curl) !== 0 || curl_getinfo($curl, CURLINFO_RESPONSE_CODE) !== 200) throw new RuntimeException('transport_unavailable');
    } finally { curl_close($curl); }
    $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
    if (($data['ok'] ?? null) !== true) throw new RuntimeException('api_unavailable');
    if ($method === 'getUpdates') {
        $ids = [];
        foreach ($data['result'] as $update) {
            $chat = $update['message']['chat'] ?? $update['my_chat_member']['chat'] ?? [];
            if (in_array($chat['type'] ?? '', ['group', 'supergroup'], true) && empty($chat['username'])) {
                $ids[(string) $chat['id']] = true;
            }
        }
        // Sensitive organizer chat IDs: view privately; never redirect to a public log or Git.
        echo json_encode(['private_group_ids' => array_keys($ids)], JSON_THROW_ON_ERROR) . "\n";
    } else {
        $chat = $data['result'];
        $private = in_array($chat['type'] ?? '', ['group', 'supergroup'], true) && empty($chat['username']);
        echo json_encode(['configured_private_group' => $private], JSON_THROW_ON_ERROR) . "\n";
        if (!$private) exit(1);
    }
} catch (Throwable $error) { \Recase\cliFailure('Telegram chat setup'); }
