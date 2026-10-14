<?php
declare(strict_types=1);
namespace Recase;
require_once __DIR__ . '/cors.php';

function retentionDeadline(array $config): int
{
    $value = $config['hackathon_end_at'] ?? '';
    if (!is_string($value) || !preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\z/D', $value)) {
        throw new \RuntimeException('retention_not_configured');
    }
    $end = \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:sP', $value);
    if (!$end || $end->format('Y-m-d\TH:i:sP') !== $value) throw new \RuntimeException('retention_invalid');
    // Calendar month, clamping Jan 31 to Feb 28/29 instead of overflowing to March.
    $month = $end->modify('first day of next month');
    $day = min((int) $end->format('d'), (int) $month->format('t'));
    return $month->setDate((int) $month->format('Y'), (int) $month->format('m'), $day)->getTimestamp();
}

function validMysqlConfig(array $config): bool
{
    try { retentionDeadline($config); } catch (\Throwable $e) { return false; }
    if (!validCorsOrigin($config['site_origin'] ?? null)) return false;
    $db = $config['mysql'] ?? [];
    if (!is_array($db) || !is_string($db['database'] ?? null)
        || !preg_match('/\A[a-zA-Z0-9_]{1,64}\z/D', $db['database'])
        || !is_string($db['username'] ?? null) || $db['username'] === ''
        || !is_string($db['password'] ?? null)) return false;
    if (!empty($db['unix_socket'])) {
        if (!is_string($db['unix_socket']) || !str_starts_with($db['unix_socket'], '/')
            || str_contains($db['unix_socket'], ';')) return false;
    } elseif (!is_string($db['host'] ?? null) || !preg_match('/\A[a-zA-Z0-9.\-]+\z/D', $db['host'])
        || !is_int($db['port'] ?? null) || $db['port'] < 1 || $db['port'] > 65535) return false;
    $telegram = $config['telegram'] ?? [];
    if (!is_array($telegram) || !is_int($telegram['max_attempts'] ?? null)
        || $telegram['max_attempts'] < 1 || $telegram['max_attempts'] > 20) return false;
    return is_string($config['rate_secret'] ?? null) && strlen($config['rate_secret']) >= 32
        && is_int($config['rate_limit'] ?? null) && $config['rate_limit'] >= 1 && $config['rate_limit'] <= 100
        && is_string($config['consent_version'] ?? null)
        && preg_match('/\A[a-zA-Z0-9._-]{1,64}\z/D', $config['consent_version']) === 1;
}

function mysqlConnection(array $config): \PDO
{
    $db = $config['mysql'];
    $location = !empty($db['unix_socket']) ? 'unix_socket=' . $db['unix_socket']
        : 'host=' . $db['host'] . ';port=' . $db['port'];
    return new \PDO('mysql:' . $location . ';dbname=' . $db['database'] . ';charset=utf8mb4',
        $db['username'], $db['password'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_PERSISTENT => false,
            \PDO::ATTR_TIMEOUT => 5,
        ]);
}

final class MysqlLeadStore
{
    public function __construct(private \PDO $pdo)
    {
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(\PDO::ATTR_EMULATE_PREPARES, false);
        $pdo->exec("SET time_zone = '+00:00'");
        $pdo->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        $pdo->exec('SET SESSION innodb_lock_wait_timeout = 5');
    }

    private function query(string $sql, array $values = []): \PDOStatement
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($values);
        return $statement;
    }

    private function transaction(callable $work): mixed
    {
        for ($attempt = 0; ; $attempt++) {
            try {
                $this->pdo->beginTransaction();
                $result = $work();
                $this->pdo->commit();
                return $result;
            } catch (\Throwable $error) {
                if ($this->pdo->inTransaction()) $this->pdo->rollBack();
                $code = $error instanceof \PDOException ? (int) ($error->errorInfo[1] ?? 0) : 0;
                // No external side effects in this transaction; bounded retry is safe.
                if ($attempt < 2 && in_array($code, [1062, 1205, 1213], true)) {
                    usleep(20000 * ($attempt + 1)); continue;
                }
                throw $error;
            }
        }
    }

    public function save(array $lead, array $config, string $ip, int $now): array
    {
        $expiry = retentionDeadline($config);
        if ($now >= $expiry) return ['status' => 'expired'];
        $key = hash_hmac('sha256', $ip, $config['rate_secret']);
        $fingerprint = hash_hmac('sha256', json_encode([
            $lead['name'], $lead['contact'], $lead['type'], $lead['consent'],
        ], JSON_THROW_ON_ERROR), $config['rate_secret']);
        return $this->transaction(function () use ($lead, $config, $key, $fingerprint, $now, $expiry): array {
            // This row is the per-IP mutex. Rolling count + insertion happen under it.
            $this->query('INSERT INTO recase_rate_buckets(ip_key,touched_at) VALUES (?,?)
                ON DUPLICATE KEY UPDATE touched_at = VALUES(touched_at)', [$key, $now]);
            $existing = $this->query('SELECT fingerprint,expires_at FROM recase_leads
                WHERE request_id = ? FOR UPDATE', [$lead['requestId']])->fetch(\PDO::FETCH_ASSOC);
            if ($existing) {
                if ((int) $existing['expires_at'] <= $now) return ['status' => 'expired'];
                return ['status' => hash_equals($existing['fingerprint'], $fingerprint) ? 'accepted' : 'conflict', 'created' => false];
            }
            $this->query('DELETE FROM recase_rate_events WHERE ip_key = ? AND received_at <= ?', [$key, $now - RATE_WINDOW]);
            $rate = $this->query('SELECT COUNT(*) AS total, MIN(received_at) AS oldest
                FROM recase_rate_events WHERE ip_key = ?', [$key])->fetch(\PDO::FETCH_ASSOC);
            if ((int) $rate['total'] >= $config['rate_limit']) {
                return ['status' => 'limited', 'retryAfter' => max(1, (int) $rate['oldest'] + RATE_WINDOW - $now)];
            }
            $mode = ($config['telegram']['personal_data_enabled'] ?? false) === true ? 'full' : 'anonymous';
            $this->query('INSERT INTO recase_leads
                (request_id,fingerprint,name,contact,lead_type,received_at,consent_given,consent_version,
                 expires_at,notification_mode,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
                $lead['requestId'], $fingerprint, $lead['name'], $lead['contact'], $lead['type'],
                $now, 1, $config['consent_version'], $expiry, $mode, $now,
            ]);
            $this->query('INSERT INTO recase_rate_events(ip_key,received_at) VALUES (?,?)', [$key, $now]);
            return ['status' => 'accepted', 'created' => true];
        });
    }

    public function claim(string $id, array $config, int $now): ?array
    {
        if ($now >= retentionDeadline($config)) return null;
        return $this->transaction(function () use ($id, $config, $now): ?array {
            $row = $this->query('SELECT * FROM recase_leads WHERE request_id = ? FOR UPDATE', [$id])->fetch(\PDO::FETCH_ASSOC);
            if (!$row || (int) $row['expires_at'] <= $now) return null;
            if ($row['delivery_status'] === 'sending') {
                if ((int) $row['delivery_started_at'] <= $now - 600) {
                    $this->query("UPDATE recase_leads SET delivery_status='uncertain',claim_token=NULL,
                        last_error_code='worker_interrupted' WHERE request_id=?", [$id]);
                }
                return null; // Never automatically reclaim an interrupted send.
            }
            if (!in_array($row['delivery_status'], ['pending', 'failed'], true)
                || (int) $row['next_attempt_at'] > $now
                || (int) $row['delivery_attempts'] >= ($config['telegram']['max_attempts'] ?? 5)) return null;
            $token = bin2hex(random_bytes(16));
            $this->query("UPDATE recase_leads SET delivery_status='sending',delivery_attempts=delivery_attempts+1,
                delivery_started_at=?,claim_token=? WHERE request_id=?", [$now, $token, $id]);
            $row['claim_token'] = $token;
            $row['delivery_attempts'] = (int) $row['delivery_attempts'] + 1;
            return $row;
        });
    }

    public function complete(array $claim, array $outcome, int $now): void
    {
        $delay = max((int) ($outcome['retryAfter'] ?? 0), min(3600, 60 * (2 ** min(5, $claim['delivery_attempts'] - 1))));
        $updated = $this->query("UPDATE recase_leads SET delivery_status=?,next_attempt_at=?,
            last_error_code=?,telegram_message_id=?,claim_token=NULL WHERE request_id=?
            AND delivery_status='sending' AND claim_token=?", [
            $outcome['status'], $now + $delay, $outcome['errorCode'] ?? null,
            $outcome['messageId'] ?? null, $claim['request_id'], $claim['claim_token'],
        ])->rowCount();
        if ($updated !== 1) throw new \RuntimeException('claim_lost');
    }

    public function due(int $now, int $limit = 20, int $maxAttempts = 5): array
    {
        // Bound integer, not input interpolation. Works without SKIP LOCKED (MySQL 5.7).
        $limit = max(1, min(100, $limit));
        return $this->query("SELECT request_id FROM recase_leads WHERE expires_at > ? AND
            ((delivery_status IN ('pending','failed') AND next_attempt_at <= ? AND delivery_attempts < ?)
             OR (delivery_status='sending' AND delivery_started_at <= ?))
            ORDER BY received_at,request_id LIMIT $limit", [$now, $now, $maxAttempts, $now - 600])->fetchAll(\PDO::FETCH_COLUMN);
    }

    public function resolve(string $id, string $decision, int $now): bool
    {
        if (!in_array($decision, ['sent', 'not-sent'], true)) throw new \RuntimeException('invalid_resolution');
        return $this->query("UPDATE recase_leads SET delivery_status=?,next_attempt_at=?,
            last_error_code='operator_resolution',claim_token=NULL
            WHERE request_id=? AND delivery_status='uncertain' AND expires_at > ?", [
            $decision === 'sent' ? 'sent' : 'failed', $now, $id, $now,
        ])->rowCount() === 1;
    }

    public function prune(array $config, int $now): array
    {
        return $this->transaction(function () use ($config, $now): array {
            $leads = $this->query('DELETE FROM recase_leads WHERE expires_at <= ? OR ? >= ?', [
                $now, $now, retentionDeadline($config),
            ])->rowCount();
            $this->query('DELETE FROM recase_rate_events WHERE received_at <= ?', [$now - RATE_WINDOW]);
            $this->query('DELETE FROM recase_rate_buckets WHERE touched_at <= ?', [$now - RATE_WINDOW]);
            return ['deletedLeads' => $leads];
        });
    }
}
