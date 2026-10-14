<?php
declare(strict_types=1);
namespace Recase;

// A single, explicit browser origin from private config. No inferred host or wildcard.
function validCorsOrigin(mixed $origin): bool
{
    return is_string($origin)
        && preg_match('~\Ahttps://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?\z~D', $origin) === 1
        && filter_var($origin, FILTER_VALIDATE_URL) !== false;
}

function leadCors(array $request, array $config): array
{
    $headers = ['Vary' => 'Origin'];
    $deny = static fn () => response(403, 'forbidden', 'Отправляйте заявку с сайта RE:CASE по HTTPS.');
    if (!validCorsOrigin($config['site_origin'] ?? null)) {
        return ['headers' => $headers, 'response' => unavailable()];
    }
    if (($request['https'] ?? false) !== true
        || !hash_equals($config['site_origin'], $request['origin'] ?? '')
        || !in_array($request['fetchSite'] ?? '', ['', 'same-origin', 'same-site', 'cross-site'], true)) {
        return ['headers' => $headers, 'response' => $deny()];
    }
    $headers['Access-Control-Allow-Origin'] = $config['site_origin'];
    $headers['Access-Control-Allow-Methods'] = 'POST';
    $headers['Access-Control-Allow-Headers'] = 'Content-Type';
    if (($request['method'] ?? '') === 'OPTIONS') {
        $headers['Vary'] .= ', Access-Control-Request-Method, Access-Control-Request-Headers';
        $requested = array_filter(array_map('trim', explode(',', strtolower($request['requestHeaders'] ?? ''))));
        if (($request['requestMethod'] ?? '') !== 'POST' || array_diff($requested, ['content-type'])) {
            return ['headers' => $headers, 'response' => $deny()];
        }
        // Preflight never accesses MySQL, sends notifications or enables intake.
        return ['headers' => $headers, 'response' => ['http' => 204, 'body' => null]];
    }
    return ['headers' => $headers, 'response' => null];
}
