<?php
declare(strict_types=1);
require_once __DIR__ . '/cli.php';
$limit = 20;
if ($argc > 2 || ($argc === 2 && !preg_match('/\A--limit=([1-9][0-9]?)\z/D', $argv[1], $match))) {
    fwrite(STDERR, "Usage: php retry-notifications.php [--limit=20]\n"); exit(2);
}
if ($argc === 2) $limit = (int) $match[1];
try {
    $config = \Recase\cliConfig();
    if (($config['telegram']['enabled'] ?? false) !== true) {
        echo "Notifications disabled; pending rows preserved.\n"; exit;
    }
    $store = new \Recase\MysqlLeadStore(\Recase\mysqlConnection($config));
    $totals = ['sent' => 0, 'failed' => 0, 'uncertain' => 0, 'skipped' => 0];
    foreach ($store->due(time(), $limit, $config['telegram']['max_attempts']) as $id) {
        $status = \Recase\dispatchNotification($store, $id, $config, time());
        $totals[$status] = ($totals[$status] ?? 0) + 1;
    }
    // Counts only; no request identifiers, names, contacts or Telegram response bodies.
    echo json_encode($totals, JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) { \Recase\cliFailure('Notification worker'); }
