<?php
declare(strict_types=1);

require_once __DIR__ . '/../server/app.php';
require_once __DIR__ . '/../server/mailer.php';

$checks = 0;
function expect(bool $condition, string $description): void
{
    global $checks;
    if (!$condition) throw new RuntimeException($description);
    $checks++;
}
function id(int $n): string
{
    return '00000000-0000-4000-8000-' . sprintf('%012d', $n);
}
function lead(int $n = 1): array
{
    return ['name' => 'Тестовый Заявитель', 'contact' => '@recase_test',
        'type' => 'participant', 'consent' => true, 'requestId' => id($n)];
}
function request(array $data = [], array $changes = []): array
{
    return array_merge([
        'method' => 'POST', 'contentType' => 'application/json; charset=utf-8',
        'declaredLength' => 0, 'body' => json_encode($data ?: lead(), JSON_UNESCAPED_UNICODE),
        'https' => true, 'origin' => 'https://recase.example.invalid',
        'fetchSite' => 'same-origin', 'remoteAddress' => '192.0.2.10',
    ], $changes);
}

$runtime = __DIR__ . '/../server/runtime/test-' . bin2hex(random_bytes(8));
mkdir($runtime, 0700, true);
$config = [
    'enabled' => true, 'site_origin' => 'https://recase.example.invalid',
    'rate_secret' => str_repeat('test-only-key-', 4), 'rate_limit' => 2, 'runtime_dir' => $runtime,
    'smtp' => ['host' => 'smtp.example.invalid', 'port' => 465, 'encryption' => 'smtps',
        'username' => 'no-reply@example.invalid', 'password' => 'test-only-not-a-secret',
        'from' => 'no-reply@example.invalid', 'to' => 'organizer@example.invalid'],
];
$now = 1700000000;
$sent = 0;
$send = static function (array $message, array $smtp) use (&$sent): bool {
    $sent++;
    expect(count(explode("\n", trim($message['body']))) === 4, 'Mail body must have exactly four fields');
    expect(!str_contains($message['body'], '192.0.2.'), 'Do not add IP to mail');
    return true;
};
try {
    foreach (['+7 (999) 123-45-67', '89991234567', '@recase_test', 'https://t.me/recase_test', 't.me/recase_test'] as $contact) {
        expect(isset(\Recase\validateLead(array_merge(lead(), ['contact' => $contact]))['lead']), 'Valid choice of contact');
    }
    foreach ([
        ['name' => ''], ['name' => str_repeat('А', 121)], ['name' => "Name\r\nBcc: attacker@example.invalid"],
        ['name' => '<script>alert(1)</script>'], ['name' => ['nested']], ['name' => 'User123'],
        ['contact' => '123'], ['contact' => '@a'], ['contact' => '<b>+79991234567</b>'],
        ['contact' => "+79991234567\r\nX: bad"], ['contact' => 'user@example.invalid'],
        ['contact' => false], ['type' => 'company'], ['consent' => false], ['consent' => 'true'],
        ['consent' => 1], ['requestId' => 'bad'], ['extra' => 'unsupported'],
    ] as $changes) {
        expect(isset(\Recase\validateLead(array_merge(lead(), $changes))['errors']), 'Reject invalid field');
    }
    foreach ([
        [['method' => 'GET'], 405], [['declaredLength' => 4097], 413],
        [['body' => str_repeat('a', 4097)], 413], [['contentType' => 'text/plain'], 415],
        [['https' => false], 403], [['origin' => 'https://attacker.invalid'], 403],
        [['fetchSite' => 'same-site'], 403], [['origin' => ''], 403],
        [['body' => '{broken'], 400], [['body' => '[]'], 400], [['body' => 'null'], 400],
        [['body' => "\xff"], 400],
    ] as [$changes, $http]) {
        expect(\Recase\handleLead(request([], $changes), $config, $send, $now)['http'] === $http, 'HTTP validation status');
    }
    expect(\Recase\handleLead(request(), array_merge($config, ['enabled' => false]), $send, $now)['http'] === 503, 'Disabled server fails closed');
    expect(\Recase\handleLead(request(), array_merge($config, ['rate_secret' => 'short']), $send, $now)['http'] === 503, 'Missing configuration fails closed');
    expect(\Recase\handleLead(request(array_merge(lead(), ['consent' => false])), $config, $send, $now)['http'] === 422, 'Consent is mandatory on server');
    expect($sent === 0, 'Validation never sends');

    $first = \Recase\handleLead(request(), $config, $send, $now);
    expect($first['http'] === 200 && $first['body']['status'] === 'accepted', 'SMTP callback acceptance succeeds');
    expect(\Recase\handleLead(request(), $config, $send, $now + 1)['http'] === 200, 'Accepted retry uses receipt');
    expect($sent === 1, 'Accepted retry does not duplicate mail');
    expect(\Recase\handleLead(request(array_merge(lead(), ['name' => 'Другое Имя'])), $config, $send, $now + 2)['http'] === 409, 'Request ID is bound to original input');
    expect(\Recase\handleLead(request(array_merge(lead(2), ['type' => 'partner'])), $config, $send, $now + 3)['http'] === 200, 'Partner submission works');
    $limited = \Recase\handleLead(request(lead(3)), $config, $send, $now + 4);
    expect($limited['http'] === 429 && $limited['body']['retryAfter'] > 0, 'Rate limit blocks repeated new requests');
    expect($sent === 2, 'Rate limit prevents SMTP call');
    expect(\Recase\handleLead(request(lead(3)), $config, $send, $now + 601)['http'] === 200, 'Rate window expires');

    $failure = static function (): bool { throw new RuntimeException('private SMTP error and password must not leak'); };
    $failedRequest = request(lead(4), ['remoteAddress' => '192.0.2.11']);
    $failed = \Recase\handleLead($failedRequest, $config, $failure, $now);
    expect($failed['http'] === 502 && !str_contains(json_encode($failed), 'private SMTP'), 'SMTP errors are sanitized');
    expect(\Recase\handleLead($failedRequest, $config, $send, $now + 1)['http'] === 409, 'Uncertain SMTP result blocks unsafe resend');
    $falseSender = static fn () => false;
    expect(\Recase\handleLead(request(lead(5), ['remoteAddress' => '192.0.2.12']), $config, $falseSender, $now)['http'] === 502, 'False SMTP acceptance cannot show success');

    $pendingRequest = request(lead(6), ['remoteAddress' => '192.0.2.13']);
    $duringSend = static function () use ($pendingRequest, $config, $send, $now): bool {
        expect(\Recase\handleLead($pendingRequest, $config, $send, $now)['http'] === 409, 'Pending reservation prevents concurrent duplicate');
        return true;
    };
    expect(\Recase\handleLead($pendingRequest, $config, $duringSend, $now)['http'] === 200, 'Reservation completes after SMTP acceptance');

    $state = file_get_contents($runtime . '/lead-state.json');
    expect(!str_contains($state, 'Тестовый') && !str_contains($state, '@recase_test') && !str_contains($state, '192.0.2.'), 'State contains no raw names, contacts or IP');
    $content = \Recase\emailContent(lead(), $now);
    $mail = \Recase\createLeadMailer($content, $config['smtp']);
    expect($mail->SMTPDebug === 0 && $mail->SMTPAuth && $mail->Mailer === 'smtp', 'PHPMailer uses authenticated SMTP without debug logs');
    expect($mail->ContentType === 'text/plain' && $mail->From === $config['smtp']['from'], 'Plain text and fixed sender');
    expect($mail->SMTPSecure === 'ssl' && $mail->getToAddresses()[0][0] === $config['smtp']['to'], 'TLS and configured recipient');
    expect($mail->Subject === $content['subject'] && $mail->Body === $content['body'], 'PHPMailer receives exactly the intended message');
    expect($mail->preSend() === true, 'PHPMailer generates a valid MIME message without sending');
    expect(\Recase\emailContent(array_merge(lead(), ['type' => 'partner']), $now)['subject'] !== $content['subject'], 'Subjects distinguish request types');
    expect(\Recase\handleLead(request(lead(10)), $config, $send, $now + 86401)['http'] === 200, 'Expired state is pruned');
    $expired = json_decode(file_get_contents($runtime . '/lead-state.json'), true);
    expect(count($expired) === 1, 'Expired IP buckets are removed');
    $beforeFailure = $sent;
    $held = fopen($runtime . '/lead-state.json', 'c+');
    flock($held, LOCK_EX);
    expect(\Recase\handleLead(request(lead(21)), $config, $send, $now + 86402)['http'] === 503, 'Busy state fails closed before SMTP');
    flock($held, LOCK_UN);
    fclose($held);
    file_put_contents($runtime . '/lead-state.json', 'broken-json');
    expect(\Recase\handleLead(request(lead(22)), $config, $send, $now + 86403)['http'] === 503, 'Corrupt state fails closed');
    expect($sent === $beforeFailure, 'State failures never call SMTP');
    echo "PASS: {$checks} PHP checks; no SMTP connection or real personal data used.\n";
} finally {
    foreach (glob($runtime . '/*') ?: [] as $file) unlink($file);
    rmdir($runtime);
}
