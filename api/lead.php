<?php
declare(strict_types=1);

// Public bootstrap only. All configuration, dependencies and state are private.
ini_set('display_errors', '0');
ini_set('log_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Vary: Origin');

function emitLeadResponse(array $result): void
{
    http_response_code($result['http']);
    foreach ($result['headers'] ?? [] as $name => $value) header($name . ': ' . $value);
    if ($result['http'] === 405) header('Allow: POST, OPTIONS');
    if ($result['http'] === 204) return;
    if (isset($result['body']['retryAfter'])) header('Retry-After: ' . (int) $result['body']['retryAfter']);
    echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

// A missing config always fails closed. No fallback mail() or alternate recipient.
$result = ['http' => 503, 'body' => ['ok' => false, 'status' => 'unavailable',
    'message' => 'Приём заявок временно недоступен. Попробуйте позже.']];
ob_start();
try {
    $serverDir = realpath(getenv('RECASE_SERVER_DIR') ?: dirname(__DIR__, 2) . '/private/recase-server');
    $documentRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__));
    if ($serverDir === false || $documentRoot === false
        || $serverDir === $documentRoot || str_starts_with($serverDir, $documentRoot . DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('private_directory_required');
    }
    if (!is_file($serverDir . '/config.php') || !is_file($serverDir . '/app.php')) {
        throw new RuntimeException('server_not_configured');
    }
    $configPath = realpath($serverDir . '/config.php');
    if ($configPath === false || $configPath === $documentRoot
        || str_starts_with($configPath, $documentRoot . DIRECTORY_SEPARATOR)) throw new RuntimeException('private_config_required');
    $mode = fileperms($serverDir . '/config.php');
    if ($mode === false || ($mode & 0077) !== 0) throw new RuntimeException('private_permissions_required');
    require_once $serverDir . '/app.php';
    $config = require $serverDir . '/config.php';
    if (!is_array($config)) throw new RuntimeException('invalid_configuration');
    $backend = $config['backend'] ?? 'smtp_legacy'; // Previous private SMTP config remains compatible.
    if ($backend === 'mysql_telegram') {
        if (PHP_VERSION_ID < 80300 || !extension_loaded('pdo_mysql') || !extension_loaded('curl')) throw new RuntimeException('runtime_required');
        require_once $serverDir . '/mysql-app.php';
    } elseif ($backend === 'smtp_legacy') {
        foreach (['PHPMailer.php', 'SMTP.php', 'Exception.php'] as $dependency) {
            if (!is_file($serverDir . '/vendor/phpmailer/phpmailer/src/' . $dependency)) throw new RuntimeException('mailer_not_installed');
        }
        require_once $serverDir . '/mailer.php';
        $runtime = realpath($config['runtime_dir'] ?? '');
        if ($runtime === false || $runtime === $documentRoot || str_starts_with($runtime, $documentRoot . DIRECTORY_SEPARATOR)) throw new RuntimeException('private_runtime_required');
        $config['runtime_dir'] = $runtime;
    } else {
        throw new RuntimeException('unknown_backend');
    }
    if (!extension_loaded('openssl')) throw new RuntimeException('tls_required');
    $input = fopen('php://input', 'rb');
    $body = $input === false ? false : stream_get_contents($input, \Recase\MAX_BODY_BYTES + 1);
    if (is_resource($input)) fclose($input);
    if ($body === false) throw new RuntimeException('input_unavailable');
    $request = [
        'method' => $_SERVER['REQUEST_METHOD'] ?? '',
        'contentType' => $_SERVER['CONTENT_TYPE'] ?? '',
        'declaredLength' => (int) ($_SERVER['CONTENT_LENGTH'] ?? 0),
        'body' => $body,
        'origin' => $_SERVER['HTTP_ORIGIN'] ?? '',
        'fetchSite' => $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '',
        'requestMethod' => $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'] ?? '',
        'requestHeaders' => $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? '',
        // Do not trust arbitrary X-Forwarded-* headers from clients.
        'https' => (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
            || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443,
        'remoteAddress' => $_SERVER['REMOTE_ADDR'] ?? '',
    ];
    $result = $backend === 'mysql_telegram'
        ? \Recase\handleMysqlLead($request, $config)
        : \Recase\handleLead($request, $config, '\\Recase\\sendLeadMail');
} catch (Throwable $error) {
    // Deliberately do not log request bodies, PHPMailer errors or configuration.
}
ob_end_clean();
emitLeadResponse($result);
