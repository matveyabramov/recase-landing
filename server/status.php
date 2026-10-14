<?php
declare(strict_types=1);
require_once __DIR__ . '/cli.php';
if ($argc !== 1) { fwrite(STDERR, "Usage: php status.php\n"); exit(2); }
try {
    $config = \Recase\cliConfig();
    $pdo = \Recase\mysqlConnection($config);
    $counts = $pdo->query('SELECT delivery_status,COUNT(*) AS total FROM recase_leads GROUP BY delivery_status')->fetchAll(PDO::FETCH_KEY_PAIR);
    $statement = $pdo->prepare("SELECT COUNT(*) FROM recase_leads WHERE delivery_status='failed' AND delivery_attempts>=?");
    $statement->execute([$config['telegram']['max_attempts']]);
    echo json_encode(['delivery_counts' => $counts, 'attempts_exhausted' => (int) $statement->fetchColumn()],
        JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) { \Recase\cliFailure('Status'); }
