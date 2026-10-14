// Disposable socket-only MySQL. Never reads production config or credentials.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
const php = process.env.RECASE_TEST_PHP || 'php';
const mysqld = process.env.RECASE_TEST_MYSQLD || 'mysqld';
const root = await mkdtemp(join(tmpdir(), 'recase-mysql-test-'));
const data = join(root, 'data');
const socket = join(root, 'mysql.sock');
await mkdir(data, { mode: 0o700 });
let server;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  const init = spawnSync(mysqld, ['--no-defaults', '--initialize-insecure', '--datadir=' + data],
    { encoding: 'utf8', timeout: 60000 });
  if (init.status !== 0) throw new Error('Disposable MySQL initialization failed: ' + (init.error?.message || init.stderr));
  server = spawn(mysqld, ['--no-defaults', '--datadir=' + data, '--socket=' + socket,
    '--skip-networking', '--mysqlx=0', '--pid-file=' + join(root, 'mysql.pid'),
    '--log-error=' + join(root, 'mysql.log')], { stdio: 'ignore' });
  let startupError;
  server.on('error', (error) => { startupError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || server.exitCode !== null) break;
    const check = spawnSync(php, ['-r',
      'try { new PDO("mysql:unix_socket=".$argv[1], "root", ""); } catch (Throwable $e) { exit(1); }', socket],
      { stdio: 'ignore', timeout: 2000 });
    if (check.status === 0) { ready = true; break; }
    await pause(100);
  }
  if (!ready) throw new Error('Disposable MySQL did not start; no production connection attempted.');
  const run = spawnSync(php, [resolve('tests/mysql-telegram-test.php')], {
    env: { ...process.env, RECASE_TEST_SOCKET: socket, RECASE_TEST_BARRIER_DIR: root },
    stdio: 'inherit', timeout: 90000,
  });
  if (run.error || run.status !== 0) throw new Error('MySQL/Telegram test suite failed.');
} finally {
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await Promise.race([stopped, pause(10000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await stopped; }
  }
  await rm(root, { recursive: true, force: true });
}
