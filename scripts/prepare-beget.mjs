import { cp, mkdir, mkdtemp, rename, access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMailer } from './install-mailer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'beget-api-package');
try {
  await access(output);
  throw new Error('beget-api-package already exists. Move it away before preparing a new package.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await installMailer();
// Backend-only package. Layero builds and serves the independent frontend.
const stage = await mkdtemp(resolve(root, '.beget-stage-'));
const publicRoot = resolve(stage, 'public_html');
await mkdir(resolve(publicRoot, 'api'), { recursive: true });
await cp(resolve(root, 'api/lead.php'), resolve(publicRoot, 'api/lead.php'));
const privateRoot = resolve(stage, 'private/recase-server');
await mkdir(privateRoot, { recursive: true });
// Allowlist prevents config.php, runtime records, tests or other files entering a release.
for (const file of ['app.php', 'mailer.php', 'cleanup.php', 'config.example.php', 'config.smtp-legacy.example.php',
  'mysql.php', 'mysql-app.php', 'cors.php', 'telegram.php', 'cli.php', 'retry-notifications.php',
  'resolve-notification.php', 'check-runtime.php', 'telegram-chat.php', 'status.php', 'phpmailer.lock.json']) {
  await cp(resolve(root, 'server', file), resolve(privateRoot, file));
}
const lock = JSON.parse(await readFile(resolve(root, 'server/phpmailer.lock.json'), 'utf8'));
for (const file of Object.keys(lock.files)) {
  const target = resolve(privateRoot, 'vendor/phpmailer/phpmailer', file);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(root, 'server/vendor/phpmailer/phpmailer', file), target);
}
await mkdir(resolve(privateRoot, 'runtime'), { recursive: true, mode: 0o700 });
await writeFile(resolve(privateRoot, 'runtime/.gitkeep'), '');
await writeFile(resolve(stage, 'DEPLOY.md'), await readFile(resolve(root, 'docs/beget-deploy.md')));
await rename(stage, output);
console.log('Beget API package ready: beget-api-package/public_html + beget-api-package/private/recase-server');
console.log('Backend only; no config.php, secrets, migration runner or SQL. Existing MySQL schema is retained.');
