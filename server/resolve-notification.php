<?php
declare(strict_types=1);
require_once __DIR__ . '/cli.php';
if ($argc !== 4 || !preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D', $argv[1])
    || !in_array($argv[2], ['sent', 'not-sent'], true) || $argv[3] !== '--confirm') {
    fwrite(STDERR, "Usage: php resolve-notification.php UUID sent|not-sent --confirm\n"
        . "Manual resolution only after investigating the uncertain result. Absence in chat alone is not proof.\n"); exit(2);
}
try {
    $config = \Recase\cliConfig();
    if (time() >= \Recase\retentionDeadline($config)) throw new RuntimeException('expired');
    $store = new \Recase\MysqlLeadStore(\Recase\mysqlConnection($config));
    if (!$store->resolve($argv[1], $argv[2], time())) throw new RuntimeException('not_resolved');
    echo "Uncertain status resolved. No message sent by this command.\n";
} catch (Throwable $error) { \Recase\cliFailure('Resolution'); }
