<?php
declare(strict_types=1);
require_once __DIR__ . '/../server/mysql-app.php';
$checks = 0;
function check(bool $condition, string $description): void {
    global $checks;
    if (!$condition) throw new RuntimeException($description);
    $checks++;
}
function uuid(int $n): string { return '00000000-0000-4000-8000-' . sprintf('%012d', $n); }
function sample(int $n = 1): array {
    return ['requestId' => uuid($n), 'name' => 'Вымышленный Участник',
        'contact' => '@fictional_test', 'type' => 'participant', 'consent' => true];
}
function req(array $lead, string $ip = '192.0.2.1'): array {
    return ['method' => 'POST', 'contentType' => 'application/json', 'declaredLength' => 0,
        'body' => json_encode($lead, JSON_THROW_ON_ERROR), 'https' => true,
        'origin' => 'https://production.layero.example', 'fetchSite' => 'cross-site', 'remoteAddress' => $ip];
}
function success(): array { return ['errno' => 0, 'http' => 200, 'body' => '{"ok":true,"result":{"message_id":123}}']; }
function connection(array $config): PDO { return \Recase\mysqlConnection($config); }
function row(PDO $pdo, int $n = 1): array {
    $query = $pdo->prepare('SELECT * FROM recase_leads WHERE request_id=?');
    $query->execute([uuid($n)]); return $query->fetch(PDO::FETCH_ASSOC) ?: [];
}
function resetDb(PDO $pdo): void {
    $pdo->exec('DELETE FROM recase_leads'); $pdo->exec('DELETE FROM recase_rate_buckets');
}
$socket = getenv('RECASE_TEST_SOCKET');
if (!$socket || !str_contains($socket, 'recase-mysql-test-')) {
    fwrite(STDERR, "Run via the disposable MySQL harness. Production databases are not supported.\n"); exit(2);
}
$config = require __DIR__ . '/../server/config.example.php';
$config['enabled'] = true;
$config['site_origin'] = 'https://production.layero.example'; // Fictional, never an approved production host.
$config['rate_secret'] = str_repeat('fictional-test-key-', 3);
$config['consent_version'] = 'fictional.2026.v1';
$config['rate_limit'] = 2;
$config['mysql'] = ['unix_socket' => $socket, 'database' => 'recase_test', 'username' => 'root', 'password' => ''];
$config['telegram']['token'] = '123456:' . str_repeat('FAKE_TEST_', 4);
$config['telegram']['chat_id'] = '-123456789';
$now = strtotime('2026-10-14T12:00:00+02:00');
if (($argv[1] ?? '') === '--worker') {
    [$unused, $flag, $kind, $number, $ip, $at, $barrier] = $argv;
    $store = new \Recase\MysqlLeadStore(connection($config));
    $deadline = microtime(true) + 10;
    while (!is_file($barrier) && microtime(true) < $deadline) usleep(5000);
    if (!is_file($barrier)) exit(3);
    $mock = static function (): array { usleep(60000); return success(); };
    echo $kind === 'submit'
        ? \Recase\handleMysqlLead(req(sample((int) $number), $ip), $config, $store, $mock, (int) $at)['http']
        : \Recase\dispatchNotification($store, uuid((int) $number), $config, (int) $at, $mock);
    exit;
}
function parallel(string $kind, array $numbers, array $ips, int $at): array {
    $barrier = getenv('RECASE_TEST_BARRIER_DIR') . '/barrier-' . bin2hex(random_bytes(4));
    $children = [];
    foreach ($numbers as $index => $number) {
        $pipes = [];
        $process = proc_open([PHP_BINARY, __FILE__, '--worker', $kind, (string) $number,
            $ips[$index], (string) $at, $barrier], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('worker_start_failed');
        fclose($pipes[0]); $children[] = [$process, $pipes];
    }
    usleep(100000); touch($barrier);
    $results = [];
    foreach ($children as [$process, $pipes]) {
        $results[] = trim(stream_get_contents($pipes[1]));
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        if (proc_close($process) !== 0 || $error !== '') throw new RuntimeException('concurrent_worker_failed');
    }
    unlink($barrier); return $results;
}
try {
    $admin = new PDO('mysql:unix_socket=' . $socket, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $admin->exec('CREATE DATABASE recase_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $pdo = connection($config);
    foreach (explode(';', file_get_contents(__DIR__ . '/../server/migrations/001_mysql_telegram.sql')) as $sql) {
        if (trim($sql) !== '') $pdo->exec($sql);
    }
    $store = new \Recase\MysqlLeadStore($pdo);
    check(\Recase\validMysqlConfig($config), 'Valid config');
    check(!\Recase\validMysqlConfig(array_replace($config, ['site_origin' => 'https://user@matveyyb.beget.tech'])), 'No userinfo in origin');
    check(!\Recase\validMysqlConfig(array_replace($config, ['hackathon_end_at' => '2026-02-30T00:00:00+02:00'])), 'Invalid date');
    check(gmdate('c', \Recase\retentionDeadline($config)) === '2026-12-15T21:59:59+00:00', 'User month retention');
    foreach ([2027 => '2027-02-28', 2028 => '2028-02-29'] as $year => $date) {
        check(gmdate('Y-m-d', \Recase\retentionDeadline(['hackathon_end_at' => $year . '-01-31T12:00:00+00:00'])) === $date, 'Calendar month clamps day');
    }
    $sends = 0;
    $send = static function ($token, $payload) use (&$sends, $config): array {
        $sends++;
        check((int) connection($config)->query('SELECT COUNT(*) FROM recase_leads')->fetchColumn() > 0, 'Committed before sending');
        check(str_contains($payload['text'], 'Вымышленный Участник') && str_contains($payload['text'], '@fictional_test')
            && str_contains($payload['text'], 'Получена:'), 'Full notification by user request');
        check($payload['protect_content'] && !$payload['allow_paid_broadcast'] && !isset($payload['parse_mode']), 'Plain text, paid sending off');
        return success();
    };
    $accepted = \Recase\handleMysqlLead(req(sample()), $config, $store, $send, $now);
    check($accepted['http'] === 200 && $accepted['body']['ok'] && $accepted['body']['status'] === 'accepted', 'Frontend contract');
    $lead = row($pdo);
    check($lead['delivery_status'] === 'sent' && (int) $lead['telegram_message_id'] === 123, 'Delivery persisted');
    check($lead['name'] === sample()['name'] && $lead['contact'] === sample()['contact'], 'Application fields');
    check((int) $lead['consent_given'] === 1 && $lead['consent_version'] === $config['consent_version'], 'Consent/version');
    check((int) $lead['received_at'] === $now && (int) $lead['expires_at'] === \Recase\retentionDeadline($config), 'Receipt and expiry');
    check(\Recase\handleMysqlLead(req(sample(), '192.0.2.99'), $config, $store, $send, $now + 1)['http'] === 200 && $sends === 1, 'Global UUID dedup');
    check(\Recase\handleMysqlLead(req(array_replace(sample(), ['name' => 'Иное Имя'])), $config, $store, $send, $now + 2)['http'] === 409, 'Changed duplicate conflict');
    check(\Recase\handleMysqlLead(req(array_replace(sample(2), ['type' => 'partner', 'contact' => '+70000000000'])), $config, $store, static fn () => success(), $now + 3)['http'] === 200, 'Partner and phone');
    check(row($pdo, 2)['lead_type'] === 'partner', 'Partner persisted');
    check(\Recase\handleMysqlLead(req(sample(3)), $config, $store, $send, $now + 4)['http'] === 429, 'Persistent rate limit');
    check((int) $pdo->query('SELECT COUNT(*) FROM recase_rate_events')->fetchColumn() === 2, 'Duplicate consumes no quota');
    check(\Recase\handleMysqlLead(req(sample(3)), $config, $store, $send, $now + 601)['http'] === 200, 'Rolling window');
    $rate = json_encode($pdo->query('SELECT * FROM recase_rate_buckets')->fetchAll(PDO::FETCH_ASSOC));
    check(!str_contains($rate, '192.0.2.') && !str_contains($rate, 'fictional_test'), 'HMAC rate state');
    check(!str_contains(json_encode($accepted), 'fictional_test') && !str_contains(json_encode($accepted), $config['telegram']['token']), 'No PII/secrets in response');
    foreach ([['method' => 'GET'], ['https' => false], ['origin' => 'https://evil.invalid'],
        ['fetchSite' => 'none'], ['contentType' => 'text/plain'], ['body' => '[]'], ['declaredLength' => 4097]] as $bad) {
        check(\Recase\handleMysqlLead(array_replace(req(sample(9)), $bad), $config, $store, $send, $now)['http'] !== 200, 'Request protection');
    }
    check(\Recase\handleMysqlLead(req(array_replace(sample(9), ['consent' => false])), $config, $store, $send, $now)['http'] === 422, 'Strict consent');
    $badConfig = $config; $badConfig['mysql']['database'] = 'missing_database';
    $error = \Recase\handleMysqlLead(req(sample(9)), $badConfig, null, $send, $now);
    check($error['http'] === 503 && $sends === 2 && !str_contains(json_encode($error), 'missing_database'), 'DB failure generic, no send');
    resetDb($pdo);
    $pdo->exec("CREATE TRIGGER test_rate_failure BEFORE INSERT ON recase_rate_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fictional_db_failure'");
    check(\Recase\handleMysqlLead(req(sample()), $config, $store, $send, $now)['http'] === 503, 'Transaction fails request');
    check((int) $pdo->query('SELECT COUNT(*) FROM recase_leads')->fetchColumn() === 0 && $sends === 2, 'Partial save rolled back');
    $pdo->exec('DROP TRIGGER test_rate_failure');
    foreach ([400, 401, 403, 404, 429] as $status) {
        $out = \Recase\classifyTelegram(['errno' => 0, 'http' => $status,
            'body' => json_encode(['ok' => false, 'error_code' => $status, 'description' => 'private-token-hidden', 'parameters' => ['retry_after' => 300]])]);
        check($out['status'] === 'failed' && $out['retryAfter'] === 300 && !str_contains(json_encode($out), 'private-token-hidden'), 'Explicit rejection safe/sanitized');
    }
    foreach ([['errno' => 28, 'uploaded' => 0], ['errno' => 28, 'uploaded' => 100],
        ['errno' => 0, 'http' => 503, 'body' => '{"ok":false,"error_code":503}'],
        ['errno' => 0, 'http' => 200, 'body' => 'broken'], ['errno' => 0, 'http' => 200, 'body' => '{"ok":true}']] as $response) {
        check(\Recase\classifyTelegram($response)['status'] === 'uncertain', 'Uncertain never auto retry');
    }
    foreach ([2, 5, 6, 7, 35, 60, 77] as $errno) {
        check(\Recase\classifyTelegram(['errno' => $errno, 'uploaded' => 0])['status'] === 'failed', 'Preconnect failure retryable');
    }
    $options = \Recase\telegramCurlOptions('{}');
    check($options[CURLOPT_SSL_VERIFYPEER] && $options[CURLOPT_SSL_VERIFYHOST] === 2
        && !$options[CURLOPT_FOLLOWLOCATION] && $options[CURLOPT_TIMEOUT] === 8, 'TLS and timeout');
    $failed = static fn () => ['errno' => 0, 'http' => 429, 'body' => '{"ok":false,"error_code":429,"parameters":{"retry_after":300}}'];
    check(\Recase\handleMysqlLead(req(sample()), $config, $store, $failed, $now)['http'] === 200, 'Saved even if Telegram fails');
    check(row($pdo)['delivery_status'] === 'failed' && (int) row($pdo)['next_attempt_at'] === $now + 300, 'Backoff persisted');
    check(\Recase\dispatchNotification($store, uuid(1), $config, $now + 60, $send) === 'skipped', 'Respect backoff');
    check(\Recase\dispatchNotification($store, uuid(1), $config, $now + 300, $send) === 'sent' && (int) row($pdo)['delivery_attempts'] === 2, 'Safe retry');
    resetDb($pdo);
    \Recase\handleMysqlLead(req(sample()), $config, $store, static fn () => ['errno' => 28, 'uploaded' => 100], $now);
    check(row($pdo)['delivery_status'] === 'uncertain', 'Uncertain persisted');
    check(\Recase\handleMysqlLead(req(sample()), $config, $store, $send, $now + 1)['http'] === 200, 'User retry returns saved receipt');
    check(\Recase\dispatchNotification($store, uuid(1), $config, $now + 900, $send) === 'skipped' && $store->due($now + 900) === [], 'Uncertain excluded from cron');
    check($store->resolve(uuid(1), 'not-sent', $now + 900), 'Explicit operator resolution');
    check(\Recase\dispatchNotification($store, uuid(1), $config, $now + 900, $send) === 'sent', 'Authorized retry');
    resetDb($pdo);
    $disabled = $config; $disabled['telegram']['enabled'] = false;
    \Recase\handleMysqlLead(req(sample()), $disabled, $store, $send, $now);
    check(row($pdo)['delivery_status'] === 'pending' && (int) row($pdo)['delivery_attempts'] === 0, 'Durable disabled pending');
    $claim = $store->claim(uuid(1), $config, $now);
    check($claim !== null && $store->claim(uuid(1), $config, $now + 1) === null, 'One atomic claim');
    check($store->claim(uuid(1), $config, $now + 600) === null && row($pdo)['delivery_status'] === 'uncertain', 'Interrupted worker blocks retry');
    check($store->resolve(uuid(1), 'sent', $now + 601), 'Manual sent decision');
    try { $store->complete($claim, ['status' => 'sent'], $now + 602); check(false, 'Old claim must fail'); }
    catch (RuntimeException $e) { check($e->getMessage() === 'claim_lost', 'Stale claim cannot overwrite'); }
    resetDb($pdo);
    $afterCommitFailure = static function () use ($pdo): array {
        $pdo->exec("CREATE TRIGGER test_finalize_failure BEFORE UPDATE ON recase_leads FOR EACH ROW BEGIN IF NEW.delivery_status='sent' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fictional_finalize_failure'; END IF; END");
        return success();
    };
    check(\Recase\handleMysqlLead(req(sample()), $config, $store, $afterCommitFailure, $now)['http'] === 200, 'Finalize failure preserves acceptance');
    check(row($pdo)['delivery_status'] === 'sending', 'No false sent receipt');
    $pdo->exec('DROP TRIGGER test_finalize_failure');
    check(\Recase\dispatchNotification($store, uuid(1), $config, $now + 600, $send) === 'skipped'
        && row($pdo)['delivery_status'] === 'uncertain', 'Finalize failure no blind retry');
    resetDb($pdo);
    $anon = $disabled; $anon['telegram']['personal_data_enabled'] = false;
    \Recase\handleMysqlLead(req(sample()), $anon, $store, $send, $now);
    check(row($pdo)['notification_mode'] === 'anonymous', 'Mode snapshot');
    $payload = \Recase\telegramPayload(row($pdo), $config['telegram']);
    check(!str_contains($payload['text'], sample()['name']) && !str_contains($payload['text'], sample()['contact']), 'Anonymous queue not upgraded');
    $full = row($pdo); $full['notification_mode'] = 'full';
    check(!str_contains(\Recase\telegramPayload($full, $anon['telegram'])['text'], sample()['contact']), 'Switch off protects queued full leads');
    resetDb($pdo); \Recase\handleMysqlLead(req(sample()), $disabled, $store, $send, $now);
    $pdo->exec("UPDATE recase_leads SET delivery_status='failed',delivery_attempts=5");
    \Recase\handleMysqlLead(req(sample(2)), $disabled, $store, $send, $now + 1);
    check($store->due($now + 900, 1, 5) === [uuid(2)], 'Exhausted jobs do not starve queue');
    check(\Recase\dispatchNotification($store, uuid(1), $config, $now + 900, $send) === 'skipped', 'Attempt cap');
    resetDb($pdo);
    check(parallel('submit', [1, 1, 1, 1], ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'], $now)
        === ['200', '200', '200', '200'], 'Parallel same UUID');
    check((int) $pdo->query('SELECT COUNT(*) FROM recase_leads')->fetchColumn() === 1
        && (int) row($pdo)['delivery_attempts'] === 1, 'One row and send concurrently');
    resetDb($pdo);
    $rates = parallel('submit', [1, 2, 3, 4], array_fill(0, 4, '192.0.2.1'), $now); sort($rates);
    check($rates === ['200', '200', '429', '429'], 'Atomic parallel IP limit');
    check((int) $pdo->query('SELECT COUNT(*) FROM recase_leads')->fetchColumn() === 2, 'Only permitted concurrent leads saved');
    resetDb($pdo);
    \Recase\handleMysqlLead(req(sample()), $disabled, $store, $send, $now);
    $workers = parallel('notify', [1, 1, 1, 1], array_fill(0, 4, '192.0.2.1'), $now); sort($workers);
    check($workers === ['sent', 'skipped', 'skipped', 'skipped'], 'Parallel cron sends once');
    $expiry = \Recase\retentionDeadline($config);
    check(\Recase\handleMysqlLead(req(sample(3)), $config, $store, $send, $expiry)['http'] === 503, 'Intake expiry cutoff');
    check($store->claim(uuid(1), $config, $expiry) === null, 'Expired sends blocked');
    check($store->prune($config, $expiry)['deletedLeads'] === 1, 'Expiry purge');
    check((int) $pdo->query('SELECT COUNT(*) FROM recase_rate_buckets')->fetchColumn() === 0, 'Rate cleanup');
    \Recase\handleMysqlLead(req(sample()), $disabled, $store, $send, $now);
    $pdo->exec('UPDATE recase_leads SET expires_at=expires_at+86400');
    check($store->prune($config, $expiry)['deletedLeads'] === 1, 'Restore cannot extend retention');
    // Execute the actual public bootstrap as CGI, not only its handler function.
    $cgi = dirname(PHP_BINARY) . '/php-cgi';
    if (!is_executable($cgi)) throw new RuntimeException('php_cgi_required_for_bootstrap_tests');
    $private = getenv('RECASE_TEST_BARRIER_DIR') . '/private';
    mkdir($private, 0700);
    foreach (['app.php', 'cors.php', 'mysql.php', 'mysql-app.php', 'telegram.php', 'cli.php', 'migrate.php',
        'check-runtime.php', 'retry-notifications.php', 'resolve-notification.php', 'cleanup.php', 'status.php'] as $file) {
        copy(__DIR__ . '/../server/' . $file, $private . '/' . $file);
    }
    file_put_contents($private . '/config.php', '<?php return ' . var_export($disabled, true) . ';');
    chmod($private . '/config.php', 0600);
    mkdir($private . '/migrations', 0700);
    copy(__DIR__ . '/../server/migrations/001_mysql_telegram.sql', $private . '/migrations/001_mysql_telegram.sql');
    foreach ([
        ['GET', '', $config['site_origin'], '405', 'private'],
        ['OPTIONS', '', $config['site_origin'], '204', 'private'],
        ['OPTIONS', '', 'https://foreign.example', '403', 'private'],
        ['POST', '{}', 'https://foreign.example', '403', 'private'],
        ['POST', '{}', '', '403', 'private'],
        ['POST', '{"name":"Вымышленный"}', $config['site_origin'], '422', 'private'],
        ['POST', '{broken', $config['site_origin'], '400', 'private'],
        ['POST', json_encode(sample(20)), $config['site_origin'], '200', 'private'],
        ['POST', json_encode(sample(20)), $config['site_origin'], '200', 'private'],
        ['GET', '', '', '503', 'public'],
        ['GET', '', '', '503', 'world_readable'],
    ] as [$method, $input, $origin, $status, $placement]) {
        $pipes = [];
        chmod($private . '/config.php', $placement === 'world_readable' ? 0644 : 0600);
        $environment = array_merge(getenv(), ['REDIRECT_STATUS' => '200', 'GATEWAY_INTERFACE' => 'CGI/1.1',
            'SCRIPT_FILENAME' => realpath(__DIR__ . '/../api/lead.php'),
            'DOCUMENT_ROOT' => realpath(__DIR__ . '/..'),
            'RECASE_SERVER_DIR' => $placement === 'public' ? realpath(__DIR__ . '/..') : $private,
            'REQUEST_METHOD' => $method, 'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => (string) strlen($input), 'HTTP_ORIGIN' => $origin,
            'HTTP_SEC_FETCH_SITE' => 'cross-site',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'content-type',
            'HTTPS' => 'on', 'SERVER_PORT' => '443', 'REMOTE_ADDR' => '198.51.100.25']);
        $process = proc_open([$cgi, '-d', 'cgi.force_redirect=0'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $environment);
        fwrite($pipes[0], $input); fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]); $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        check(proc_close($process) === 0 && $stderr === '', 'Bootstrap no private diagnostics');
        [$headers, $body] = preg_split('/\r?\n\r?\n/', $output, 2);
        $http = preg_match('/Status: ([0-9]{3})/', $headers, $match) ? $match[1] : '200';
        check($http === $status && ($status === '204' ? $body === '' : is_array(json_decode($body, true))), 'Public CGI JSON/status contract');
        check(str_contains($headers, 'Vary: Origin'), 'CGI varies by browser origin');
        $allowed = $placement === 'private' && $origin === $config['site_origin'];
        check($allowed === str_contains($headers, 'Access-Control-Allow-Origin: ' . $config['site_origin']), 'CGI exact CORS allowlist on success/errors');
        check(!str_contains($headers, 'Access-Control-Allow-Credentials') && !str_contains($headers, 'Access-Control-Allow-Origin: *'), 'CGI no credentials/wildcard');
        if ($status === '204') check(str_contains($headers, 'Access-Control-Allow-Methods: POST')
            && str_contains($headers, 'Access-Control-Allow-Headers: Content-Type'), 'CGI preflight POST JSON');
        check(str_contains($headers, 'Cache-Control: no-store') && !str_contains($output, $socket)
            && !str_contains($output, $config['telegram']['token']), 'Bootstrap no secrets');
    }
    chmod($private . '/config.php', 0600);
    check(row($pdo, 20)['delivery_status'] === 'pending' && (int) row($pdo, 20)['delivery_attempts'] === 0, 'CGI dedup with Telegram disabled');
    foreach ([['migrate.php', '--apply'], ['check-runtime.php', '--db'],
        ['retry-notifications.php', '--limit=20'], ['status.php']] as $command) {
        $pipes = [];
        $process = proc_open(array_merge([PHP_BINARY, $private . '/' . array_shift($command)], $command),
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        fclose($pipes[0]); $output = stream_get_contents($pipes[1]); $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        check(proc_close($process) === 0 && $stderr === '' && $output !== '', 'Private CLI preflight/migration/disabled worker/status');
        check(!str_contains($output, sample()['name']) && !str_contains($output, $config['telegram']['token'])
            && !str_contains($output, $socket), 'CLI has no secrets or application data');
    }
    echo "PASS: $checks MySQL/Telegram checks on PHP " . PHP_VERSION . "; MySQL "
        . $pdo->getAttribute(PDO::ATTR_SERVER_VERSION) . "; fictional data, no Telegram network calls.\n";
} catch (Throwable $error) {
    fwrite(STDERR, "FAIL: " . $error->getMessage() . "\n"); exit(1);
}
