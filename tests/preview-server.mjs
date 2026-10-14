// Local frontend QA fixture only. Never included in the Beget package or used as a production backend.
// Accepts only explicit synthetic test data and never connects to SMTP.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(process.argv[2] || 'beget-package/public_html');
const port = Number(process.argv[3] || 4181);
let requests = 0;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (path === '/__qa__/count') return json(200, { requests });
  if (path === '/api/lead.php') {
    if (req.method !== 'POST') return json(405, { ok: false, status: 'method_not_allowed' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 4096) return json(413, { ok: false, status: 'request_too_large' });
    }
    let data;
    try { data = JSON.parse(body); } catch { return json(400, { ok: false, status: 'invalid_json' }); }
    if (data.name !== 'Тестовый QA' || !['@success_test', '@slow_test', '@validation_test', '@unavailable_test', '@badstatus_test', '@network_test', '@unconfirmed_test'].includes(data.contact)) {
      return json(422, { ok: false, status: 'validation_error', fields: { name: 'Only synthetic QA data is accepted.' } });
    }
    requests++;
    await new Promise(done => setTimeout(done, data.contact === '@slow_test' ? 2500 : 400));
    if (!data.consent) return json(422, { ok: false, status: 'validation_error' });
    if (data.contact === '@network_test') return req.socket.destroy();
    if (data.contact === '@unavailable_test') return json(503, { ok: false, status: 'unavailable' });
    if (data.contact === '@validation_test') return json(422, { ok: false, status: 'validation_error', fields: { contact: 'Тестовая ошибка проверки контакта.' } });
    if (data.contact === '@badstatus_test') return json(500, { ok: true, status: 'accepted' });
    if (data.contact === '@unconfirmed_test') return json(502, { ok: false, status: 'submission_unconfirmed' });
    return json(200, { ok: true, status: 'accepted' });
  }
  if (extname(path) === '.php') return json(403, { ok: false, status: 'forbidden' });
  try {
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) return json(403, { ok: false });
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic frontend QA fixture: http://127.0.0.1:${port}`));
