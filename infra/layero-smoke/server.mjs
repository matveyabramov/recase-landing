import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runProbes } from './smtp-probe.mjs';
import { runHttpsProbes } from './https-probe.mjs';

export function createSmokeServer({ probe = runProbes, httpsProbe = runHttpsProbes } = {}) {
  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let sequence = 0;
  let probePromise;
  let probeInFlight = false;
  let httpsProbePromise;
  let httpsProbeInFlight = false;
  function send(response, code, body, extra = {}) {
    response.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      ...extra,
    });
    response.end(JSON.stringify(body));
  }
  return http.createServer({ requestTimeout: 5000, headersTimeout: 5000 }, async (request, response) => {
    let url;
    try { url = new URL(request.url, 'http://smoke.invalid'); }
    catch { send(response, 400, { ok: false, status: 'invalid_url' }); return; }
    const context = () => ({ instanceId, startedAt, uptimeMs: Math.round(performance.now() - started),
      sequence: ++sequence, responseId: randomUUID() });
    if (url.search) { send(response, 400, { ok: false, status: 'parameters_not_allowed' }); return; }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/api/health')) {
      send(response, 200, { ok: true, application: 're-layero-free-smoke',
        runtime: process.version, ...context() });
      return;
    }
    if (url.pathname === '/api/https-probe') {
      if (request.method !== 'POST') {
        send(response, 405, { ok: false, status: 'post_required' }, { Allow: 'POST' }); return;
      }
      if (request.headers['x-smoke-probe'] !== 'https-only'
          || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) {
        send(response, 403, { ok: false, status: 'explicit_probe_required' }); return;
      }
      if (request.headers['transfer-encoding']
          || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
        send(response, 400, { ok: false, status: 'empty_body_required' }); return;
      }
      if (httpsProbeInFlight) {
        send(response, 429, { ok: false, status: 'probe_in_progress' }, { 'Retry-After': '30' }); return;
      }
      const cached = Boolean(httpsProbePromise);
      httpsProbeInFlight = true;
      try {
        httpsProbePromise ??= Promise.resolve().then(httpsProbe).then(results => ({
          checkedAt: new Date().toISOString(), results,
        }));
        send(response, 200, { ok: true, ...context(), ...await httpsProbePromise, cached,
          authenticationTested: false, deliveryTested: false });
      } catch {
        send(response, 503, { ok: false, status: 'probe_unavailable', ...context() });
      } finally { httpsProbeInFlight = false; }
      return;
    }
    if (url.pathname === '/api/smtp-probe') {
      if (request.method !== 'POST') {
        send(response, 405, { ok: false, status: 'post_required' }, { Allow: 'POST' }); return;
      }
      // A browser cannot trigger this via a simple cross-origin request. No CORS.
      if (request.headers['x-smoke-probe'] !== 'tcp-tls-only'
          || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) {
        send(response, 403, { ok: false, status: 'explicit_probe_required' }); return;
      }
      if (request.headers['transfer-encoding']
          || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
        send(response, 400, { ok: false, status: 'empty_body_required' }); return;
      }
      if (probeInFlight) {
        send(response, 429, { ok: false, status: 'probe_in_progress' }, { 'Retry-After': '40' }); return;
      }
      const cached = Boolean(probePromise);
      probeInFlight = true;
      try {
        // One probe batch per process. This is an abuse bound, not durable idempotency.
        probePromise ??= Promise.resolve().then(probe).then(results => ({
          checkedAt: new Date().toISOString(), results,
        }));
        const report = await probePromise;
        send(response, 200, { ok: true, ...context(), ...report, cached,
          authenticationTested: false, deliveryTested: false });
      } catch {
        send(response, 503, { ok: false, status: 'probe_unavailable', ...context() });
      } finally { probeInFlight = false; }
      return;
    }
    send(response, 404, { ok: false, status: 'not_found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
  createSmokeServer().listen(port, '0.0.0.0');
}
