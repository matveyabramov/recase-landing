<?php
declare(strict_types=1);

// Copy to config.php only ON THE SERVER outside public_html. No real secrets here.
return [
    'backend' => 'mysql_telegram',
    'enabled' => false, // Enable on the server when configured and launch is approved.
    'site_origin' => '', // Exact confirmed Layero production origin, HTTPS, no trailing slash.
    'rate_secret' => '', // Stable random secret, at least 32 characters; do not rotate casually.
    'rate_limit' => 5, // New leads per IP / rolling 10 minutes; consider campus NAT.
    'consent_version' => '', // Version of actually approved/published consent, e.g. YYYY-MM-DD.v1.
    // Nov 15 supplied by the user; year inferred from the current 2026 event, end of day UTC+2.
    'hackathon_end_at' => '2026-11-15T23:59:59+02:00',
    // Retention: ONE CALENDAR MONTH, until Dec 15, 2026 end of day UTC+2.
    'mysql' => ['host' => 'localhost', 'port' => 3306, 'unix_socket' => '',
        'database' => '', 'username' => '', 'password' => ''],
    'telegram' => [
        'enabled' => true,
        'personal_data_enabled' => true, // Full text requested by the user; legal conditions documented separately.
        'token' => '',
        'chat_id' => '', // String: private organizer group/supergroup ID, usually negative.
        'max_attempts' => 5, // Only definite failures retry automatically; uncertain never do.
    ],
];
