<?php
declare(strict_types=1);
// Preserved SMTP implementation. Copy only outside public_html; never commit config.php.
return [
    'backend' => 'smtp_legacy', 'enabled' => false,
    'site_origin' => 'https://matveyyb.beget.tech', 'rate_secret' => '', 'rate_limit' => 5,
    'runtime_dir' => __DIR__ . '/runtime',
    'smtp' => ['host' => '', 'port' => 465, 'encryption' => 'smtps',
        'username' => '', 'password' => '', 'from' => '', 'to' => ''],
];
