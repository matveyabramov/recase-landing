<?php
declare(strict_types=1);
namespace Recase;

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('display_errors', '0');
ini_set('log_errors', '0');
require_once __DIR__ . '/mysql-app.php';

function cliConfig(): array
{
    $private = realpath(__DIR__);
    $public = realpath(getenv('RECASE_PUBLIC_ROOT') ?: dirname(__DIR__, 2) . '/public_html');
    if ($public && ($private === $public || str_starts_with($private, $public . DIRECTORY_SEPARATOR))) {
        throw new \RuntimeException('private_directory_required');
    }
    if (PHP_VERSION_ID < 80300 || !extension_loaded('pdo_mysql') || !extension_loaded('curl')
        || !is_file(__DIR__ . '/config.php')) throw new \RuntimeException('runtime_or_config_missing');
    $configPath = realpath(__DIR__ . '/config.php');
    if ($public && ($configPath === $public || str_starts_with($configPath, $public . DIRECTORY_SEPARATOR))) {
        throw new \RuntimeException('private_config_required');
    }
    $mode = fileperms(__DIR__ . '/config.php');
    if ($mode === false || ($mode & 0077) !== 0) throw new \RuntimeException('private_permissions_required');
    $config = require __DIR__ . '/config.php';
    if (!is_array($config) || ($config['backend'] ?? '') !== 'mysql_telegram'
        || !validMysqlConfig($config)) throw new \RuntimeException('invalid_configuration');
    return $config;
}

function cliFailure(string $operation): never
{
    // No exception messages, SQL, identities, token URLs or private settings in output.
    fwrite(STDERR, $operation . " unavailable. Check private configuration and server prerequisites.\n");
    exit(1);
}
