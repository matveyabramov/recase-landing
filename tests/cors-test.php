<?php
declare(strict_types=1);
require_once __DIR__ . '/../server/mysql-app.php';
$checks = 0;
function check(bool $ok, string $message): void {
    global $checks;
    if (!$ok) throw new RuntimeException($message);
    $checks++;
}
$config = ['site_origin' => 'https://production.layero.example', 'enabled' => false];
$request = ['method' => 'POST', 'https' => true, 'origin' => $config['site_origin'], 'fetchSite' => 'cross-site'];
$allowed = \Recase\leadCors($request, $config);
check($allowed['response'] === null, 'Explicit Layero origin accepted cross-site');
check($allowed['headers']['Access-Control-Allow-Origin'] === $config['site_origin'], 'Exact allow origin');
check($allowed['headers']['Access-Control-Allow-Methods'] === 'POST', 'POST only');
check($allowed['headers']['Access-Control-Allow-Headers'] === 'Content-Type', 'JSON header');
check($allowed['headers']['Vary'] === 'Origin', 'Vary origin');
check(!isset($allowed['headers']['Access-Control-Allow-Credentials']), 'No cookies/credentials');
foreach (['https://foreign.example', 'null', '', 'https://production.layero.example.evil.test',
    'http://production.layero.example', $config['site_origin'] . '/', 'https://matveyyb.beget.tech',
    'https://preview.github.io', 'https://re-layero-free-smoke.layero.app'] as $origin) {
    $result = \Recase\handleMysqlLead(array_replace($request, ['origin' => $origin]), $config);
    check($result['http'] === 403 && !isset($result['headers']['Access-Control-Allow-Origin']), 'Foreign/missing origin rejected before storage');
}
check(\Recase\handleMysqlLead(array_replace($request, ['https' => false]), $config)['http'] === 403, 'HTTPS remains mandatory');
check(\Recase\handleMysqlLead(array_replace($request, ['fetchSite' => 'none']), $config)['http'] === 403, 'Inconsistent fetch metadata rejected');
foreach (['', '*', 'https://*.layero.app', "https://ok.test\r\nX-Test: true", 'https://u:p@ok.test', 'https://ok.test/path', 'http://ok.test'] as $origin) {
    check(!\Recase\validCorsOrigin($origin), 'Unsafe configuration rejected');
}
$preflight = array_replace($request, ['method' => 'OPTIONS', 'requestMethod' => 'POST', 'requestHeaders' => 'Content-Type']);
$result = \Recase\handleMysqlLead($preflight, $config);
check($result['http'] === 204 && $result['body'] === null, 'Preflight succeeds even while intake disabled, without DB');
foreach ([['requestMethod' => 'DELETE'], ['requestMethod' => ''], ['requestHeaders' => 'Content-Type, Authorization'], ['origin' => 'https://foreign.example'], ['https' => false]] as $change) {
    check(\Recase\handleMysqlLead(array_replace($preflight, $change), $config)['http'] === 403, 'Disallowed preflight rejected');
}
$result = \Recase\handleMysqlLead(array_replace($request, ['contentType' => 'application/json', 'body' => '{}']), $config);
check($result['http'] === 503 && $result['headers']['Access-Control-Allow-Origin'] === $config['site_origin'], 'Disabled intake has CORS-readable error');
check(\Recase\handleMysqlLead($preflight, ['site_origin' => ''])['http'] === 503, 'Unconfirmed config fails closed');
echo "PASS: $checks CORS checks; no network or database calls.\n";
