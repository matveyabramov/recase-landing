import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function installMailer() {
  const lock = JSON.parse(await readFile(resolve(root, 'server/phpmailer.lock.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(lock.reference)) throw new Error('Invalid PHPMailer reference');
  for (const [path, hash] of Object.entries(lock.files)) {
    if (!['src/PHPMailer.php', 'src/SMTP.php', 'src/Exception.php', 'LICENSE'].includes(path)) {
      throw new Error('Unexpected PHPMailer file');
    }
    const output = resolve(root, 'server/vendor/phpmailer/phpmailer', path);
    let bytes;
    try { bytes = await readFile(output); } catch { /* Download the locked release below. */ }
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== hash) {
      const response = await fetch(`https://raw.githubusercontent.com/PHPMailer/PHPMailer/${lock.reference}/${path}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error('PHPMailer download failed');
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('PHPMailer checksum mismatch');
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }
  }
  console.log(`PHPMailer ${lock.version}: checksums verified`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await installMailer();
