<?php
declare(strict_types=1);
require_once __DIR__ . '/cli.php';
foreach (array_slice($argv, 1) as $flag) {
    if (!in_array($flag, ['--db', '--network'], true)) {
        fwrite(STDERR, "Usage: php check-runtime.php [--db] [--network]\n"); exit(2);
    }
}
try {
    $config = \Recase\cliConfig();
    $result = ['php' => PHP_VERSION, 'pdo_mysql' => true, 'curl' => true,
        'private_configuration' => true, 'intake_enabled' => ($config['enabled'] ?? false) === true,
        'retention_until_utc' => gmdate('c', \Recase\retentionDeadline($config))];
    if (in_array('--db', $argv, true)) {
        $pdo = \Recase\mysqlConnection($config);
        $result['mysql'] = (int) $pdo->query('SELECT 1')->fetchColumn() === 1;
        $result['mysql_version'] = $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
        $result['schema_1'] = (int) $pdo->query('SELECT version FROM recase_schema WHERE version=1')->fetchColumn() === 1;
        // Checks the application columns as well, without reading any applicant data.
        $pdo->query('SELECT request_id,fingerprint,name,contact,lead_type,received_at,consent_given,consent_version,
            expires_at,notification_mode,delivery_status,delivery_attempts,next_attempt_at,
            delivery_started_at,claim_token,last_error_code,telegram_message_id FROM recase_leads LIMIT 0');
        if (!$result['mysql'] || !$result['schema_1']) throw new RuntimeException('schema_missing');
        $engines = $pdo->query("SELECT engine FROM information_schema.tables WHERE table_schema=DATABASE()
            AND table_name IN ('recase_leads','recase_rate_buckets','recase_rate_events')")->fetchAll(PDO::FETCH_COLUMN);
        $result['innodb'] = count($engines) === 3 && count(array_filter($engines, static fn ($engine) => $engine !== 'InnoDB')) === 0;
        if (!$result['innodb']) throw new RuntimeException('transactional_engine_required');
    }
    if (in_array('--network', $argv, true)) {
        $curl = curl_init('https://api.telegram.org/');
        curl_setopt_array($curl, [CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8,
            CURLOPT_WRITEFUNCTION => static fn ($handle, string $chunk): int => strlen($chunk)]);
        curl_exec($curl);
        $result['telegram_https'] = ['errno' => curl_errno($curl),
            'http' => (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE)];
        curl_close($curl);
        $result['telegram_https']['reachable'] = $result['telegram_https']['errno'] === 0
            && $result['telegram_https']['http'] >= 200 && $result['telegram_https']['http'] < 600;
        if (!$result['telegram_https']['reachable']) {
            echo json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n"; exit(1);
        }
    }
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) { \Recase\cliFailure('Preflight'); }
