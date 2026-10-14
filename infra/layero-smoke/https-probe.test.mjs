import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeHttpsTarget, HTTPS_TARGETS } from './https-probe.mjs';
import { createSmokeServer } from './server.mjs';

let dir, key, cert;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 're-https-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  key = readFileSync(join(dir, 'key.pem')); cert = readFileSync(join(dir, 'cert.pem'));
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
async function listen(server, t) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    sockets.forEach(socket => socket.destroy()); server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}
const target = { id: 'synthetic', url: 'https://localhost/v2/email/configuration-sets' };
function local(port, extra = {}) {
  return {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    connect: () => net.connect({ host: '127.0.0.1', port }),
    upgrade: options => tls.connect({ ...options, ca: cert }), ...extra,
  };
}

test('200, 401, 403 and redirects prove transport; bodies/headers are omitted and redirects not followed', async t => {
  for (const status of [200, 401, 403, 302]) {
    let requests = 0;
    let incoming = '';
    const server = tls.createServer({ key, cert, ALPNProtocols: ['http/1.1'] }, socket => {
      socket.on('error', () => {});
      socket.on('data', chunk => {
        incoming += chunk.toString();
        if (!incoming.includes('\r\n\r\n')) return;
        requests++;
        socket.write(`HTTP/1.1 ${status} Synthetic\r\nSet-Cookie: PRIVATE_COOKIE\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 12\r\nConnection: close\r\n\r\nPRIVATE_BODY`);
      });
    });
    const port = await listen(server, t);
    const result = await probeHttpsTarget(target, local(port));
    assert.equal(result.transportAccessible, true);
    assert.equal(result.httpStatus, status);
    assert.equal(result.dnsResolved, true);
    assert.equal(result.tcpConnected, true);
    assert.equal(result.tlsVerified, true);
    assert.equal(result.stage, 'complete');
    assert.equal(result.authenticationTested, false);
    assert.equal(requests, 1);
    assert.match(incoming, /^GET \/v2\/email\/configuration-sets HTTP\/1\.1\r\n/);
    assert.doesNotMatch(incoming, /Authorization|Cookie:|POST |outbound-emails/i);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|127\.0\.0\.1|Set-Cookie/);
  }
});

test('DNS errors and DNS stalls have a bounded safe result', async () => {
  const error = await probeHttpsTarget(target, { lookup: async () => {
    throw Object.assign(new Error('PRIVATE_DNS_TEXT'), { code: 'ENOTFOUND' });
  } });
  assert.equal(error.stage, 'dns'); assert.equal(error.errorCode, 'ENOTFOUND');
  assert.equal(error.tcpConnected, false);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_DNS_TEXT/);
  const stalled = await probeHttpsTarget(target, { lookup: () => new Promise(() => {}), timeoutMs: 60 });
  assert.equal(stalled.stage, 'dns'); assert.equal(stalled.errorCode, 'probe_timeout');
  assert.ok(stalled.elapsedMs < 1000);
});

test('TCP refusal is distinct from DNS and TLS failure', async () => {
  const result = await probeHttpsTarget(target, {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    connect: () => {
      const socket = new net.Socket();
      process.nextTick(() => socket.destroy(Object.assign(new Error('PRIVATE_TCP'), { code: 'ECONNREFUSED' })));
      return socket;
    },
  });
  assert.equal(result.stage, 'tcp'); assert.equal(result.errorCode, 'ECONNREFUSED');
  assert.equal(result.dnsResolved, true); assert.equal(result.tcpConnected, false);
});

test('untrusted certificates fail closed before HTTP', async t => {
  const server = tls.createServer({ key, cert }, socket => socket.on('error', () => {}));
  server.on('tlsClientError', () => {});
  const port = await listen(server, t);
  const result = await probeHttpsTarget(target, local(port, { upgrade: options => tls.connect(options) }));
  assert.equal(result.stage, 'tls'); assert.equal(result.tcpConnected, true);
  assert.equal(result.tlsVerified, false); assert.equal(result.httpStatus, null);
  assert.equal(result.errorCode, 'DEPTH_ZERO_SELF_SIGNED_CERT');
});

test('TLS and HTTP stalls obey a total deadline', async t => {
  const rawPort = await listen(net.createServer(() => {}), t);
  const tlsStall = await probeHttpsTarget(target, local(rawPort, { timeoutMs: 80 }));
  assert.equal(tlsStall.stage, 'tls'); assert.equal(tlsStall.errorCode, 'probe_timeout');
  const server = tls.createServer({ key, cert }, socket => { socket.on('error', () => {}); socket.on('data', () => {}); });
  const port = await listen(server, t);
  const httpStall = await probeHttpsTarget(target, local(port, { timeoutMs: 80 }));
  assert.equal(httpStall.stage, 'http'); assert.equal(httpStall.tlsVerified, true);
  assert.equal(httpStall.errorCode, 'probe_timeout');
});

test('malformed HTTP is sanitized without a response body', async t => {
  const port = await listen(tls.createServer({ key, cert }, socket => {
    socket.on('error', () => {}); socket.on('data', () => socket.write('PRIVATE_NOT_HTTP\r\n\r\n'));
  }), t);
  const result = await probeHttpsTarget(target, local(port));
  assert.equal(result.stage, 'http'); assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'HPE_INVALID_CONSTANT');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NOT_HTTP/);
});

test('fixed allowlist; HTTP cannot inject URL, body or headers; old endpoints still work', async t => {
  assert.deepEqual(HTTPS_TARGETS.map(item => item.url), [
    'https://example.com/', 'https://postbox.cloud.yandex.net/v2/email/configuration-sets',
  ]);
  let calls = 0;
  const server = createSmokeServer({ probe: async () => [], httpsProbe: async () => { calls++; return []; } });
  const port = await listen(server, t);
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'X-Smoke-Probe': 'https-only' };
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/https-probe`)).status, 405);
  assert.equal((await fetch(`${base}/api/https-probe`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${base}/api/https-probe?url=http://127.0.0.1`, { method: 'POST', headers })).status, 400);
  assert.equal((await fetch(`${base}/api/https-probe`, { method: 'POST', headers, body: '{}' })).status, 400);
  const first = await (await fetch(`${base}/api/https-probe`, { method: 'POST', headers })).json();
  const second = await (await fetch(`${base}/api/https-probe`, { method: 'POST', headers })).json();
  assert.equal(calls, 1); assert.equal(first.cached, false); assert.equal(second.cached, true);
  assert.equal((await fetch(`${base}/api/smtp-probe`, { method: 'POST', headers: { 'X-Smoke-Probe': 'tcp-tls-only' } })).status, 200);
});
