<?php
declare(strict_types=1);
require_once __DIR__ . '/cli.php';
if ($argc !== 2 || $argv[1] !== '--apply') {
    fwrite(STDERR, "Usage: php migrate.php --apply (private CLI only)\n"); exit(2);
}
try {
    $config = \Recase\cliConfig();
    $pdo = \Recase\mysqlConnection($config);
    // Fixed, versioned, additive schema; no user SQL, no DROP, safe to re-run.
    $sql = file_get_contents(__DIR__ . '/migrations/001_mysql_telegram.sql');
    if ($sql === false) throw new RuntimeException('migration_missing');
    foreach (explode(';', $sql) as $statement) {
        if (trim($statement) !== '') $pdo->exec($statement);
    }
    echo "Schema 1 ready. No applications sent.\n";
} catch (Throwable $error) { \Recase\cliFailure('Migration'); }
