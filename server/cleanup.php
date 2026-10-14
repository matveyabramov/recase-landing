<?php
declare(strict_types=1);

// CLI/cron only. Prunes expired technical receipts, never applicants' email data.
if (PHP_SAPI !== 'cli') exit(1);
ini_set('display_errors', '0');
ini_set('log_errors', '0');
require_once __DIR__ . '/app.php';
try {
    $config = require __DIR__ . '/config.php';
    if (($config['backend'] ?? 'smtp_legacy') === 'mysql_telegram') {
        require_once __DIR__ . '/cli.php';
        $config = \Recase\cliConfig();
        $store = new \Recase\MysqlLeadStore(\Recase\mysqlConnection($config));
        echo json_encode($store->prune($config, time()), JSON_THROW_ON_ERROR) . "\n";
        exit;
    }
    if (($config['backend'] ?? 'smtp_legacy') !== 'smtp_legacy') throw new RuntimeException('unknown_backend');
    \Recase\stateTransaction($config['runtime_dir'], function (array &$state): array {
        $now = time();
        foreach ($state as $key => &$bucket) {
            $bucket['attempts'] = array_values(array_filter($bucket['attempts'], static fn ($at) => $at > $now - \Recase\RATE_WINDOW));
            $bucket['receipts'] = array_filter($bucket['receipts'], static fn ($item) => $item['at'] > $now - \Recase\RECEIPT_TTL);
            if (!$bucket['attempts'] && !$bucket['receipts']) unset($state[$key]);
        }
        unset($bucket);
        return [];
    });
    echo "Expired technical receipts removed.\n";
} catch (Throwable $error) {
    fwrite(STDERR, "Cleanup unavailable. Check private configuration.\n");
    exit(1);
}
