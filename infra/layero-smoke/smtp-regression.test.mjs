import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSmokeServer } from './server.mjs';
import { probeTarget, TARGETS } from './smtp-probe.mjs';

let fixture;
let cert;
let key;
before(() => {
  fixture = mkdtempSync(join(tmpdir(), 're-smoke-test-'));
  // Temporary synthetic TLS key; never committed or used against real SMTP.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', join(fixture, 'key.pem'), '-out', join(fixture, 'cert.pem')], { stdio: 'ignore' });
  cert = readFileSync(join(fixture, 'cert.pem'));
  key = readFileSync(join(fixture, 'key.pem'));
});
after(() => { if (fixture) rmSync(fixture, { recursive: true, force: true }); });

async function listen(server, t) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}

function localOptions() {
  return {
    connect: options => net.connect({ ...options, host: '127.0.0.1' }),
    upgrade: options => tls.connect({ ...options, ca: cert }),
  };
}

test('HTTP health is live, uncached and identifiable across process instances', async t => {
  const server = createSmokeServer({ probe: () => { throw new Error('must not probe'); } });
  const port = await listen(server, t);
  const first = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /no-store/);
  const a = await first.json();
  const b = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(a.ok, true);
  assert.equal(a.instanceId, b.instanceId);
  assert.notEqual(a.responseId, b.responseId);
  assert.ok(b.sequence > a.sequence);
  const otherPort = await listen(createSmokeServer(), t);
  const other = await (await fetch(`http://127.0.0.1:${otherPort}/api/health`)).json();
  assert.notEqual(other.instanceId, a.instanceId);
});

test('probe endpoint rejects unsolicited, parameterized and nonempty requests', async t => {
  let calls = 0;
  const port = await listen(createSmokeServer({ probe: async () => { calls++; return []; } }), t);
  const url = `http://127.0.0.1:${port}/api/smtp-probe`;
  const headers = { 'X-Smoke-Probe': 'tcp-tls-only' };
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${url}?host=example.invalid`, { method: 'POST', headers })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(calls, 0);
});

test('concurrent probes are bounded and a completed batch is reused', async t => {
  let finish;
  let calls = 0;
  const port = await listen(createSmokeServer({ probe: () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } }), t);
  const url = `http://127.0.0.1:${port}/api/smtp-probe`;
  const options = { method: 'POST', headers: { 'X-Smoke-Probe': 'tcp-tls-only' } };
  const first = fetch(url, options);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fetch(url, options)).status, 429);
  finish([{ ok: true }]);
  const a = await (await first).json();
  const b = await (await fetch(url, options)).json();
  assert.equal(calls, 1);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(b.checkedAt, a.checkedAt);
  assert.equal(b.authenticationTested, false);
  assert.equal(b.deliveryTested, false);
});

test('implicit TLS verifies certificate and SMTP greeting without sending commands', async t => {
  const commands = [];
  const server = tls.createServer({ key, cert }, socket => {
    socket.on('error', () => {});
    socket.on('data', data => commands.push(data.toString()));
    socket.write('220 localhost synthetic SMTP\r\n');
  });
  server.on('tlsClientError', () => {});
  const port = await listen(server, t);
  const result = await probeTarget({ host: 'localhost', port, mode: 'implicit_tls' }, localOptions());
  assert.equal(result.ok, true);
  assert.equal(result.tcpConnected, true);
  assert.equal(result.tlsVerified, true);
  assert.equal(result.smtpGreeting, true);
  assert.deepEqual(commands, []);
  assert.equal(result.deliveryTested, false);
});

test('an untrusted certificate fails closed without publishing raw errors', async t => {
  const server = tls.createServer({ key, cert }, socket => { socket.on('error', () => {}); });
  server.on('tlsClientError', () => {});
  const port = await listen(server, t);
  const result = await probeTarget({ host: 'localhost', port, mode: 'implicit_tls' }, {
    connect: localOptions().connect,
  });
  assert.equal(result.ok, false);
  assert.equal(result.tcpConnected, true);
  assert.equal(result.tlsVerified, false);
  assert.equal(result.stage, 'tls');
  assert.equal(result.errorCode, 'DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.equal('message' in result, false);
  assert.equal('stack' in result, false);
});

test('STARTTLS exchanges only EHLO and STARTTLS, then verifies the TLS certificate', async t => {
  const commands = [];
  const server = net.createServer(socket => {
    socket.write('220 localhost synthetic SMTP\r\n');
    let buffer = '';
    function data(chunk) {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const command = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        commands.push(command);
        if (command === 'EHLO smoke.invalid') {
          socket.write('250-local');
          setImmediate(() => socket.write('host\r\n250 STARTTLS\r\n'));
        } else if (command === 'STARTTLS') {
          socket.off('data', data);
          socket.write('220 Ready for TLS\r\n', () => {
            const secure = new tls.TLSSocket(socket, {
              isServer: true, secureContext: tls.createSecureContext({ key, cert }),
            });
            secure.on('error', () => {});
            secure.on('data', chunk => commands.push(chunk.toString()));
          });
        } else socket.destroy();
      }
    }
    socket.on('data', data);
  });
  const port = await listen(server, t);
  const result = await probeTarget({ host: 'localhost', port, mode: 'starttls' }, localOptions());
  assert.equal(result.ok, true);
  assert.equal(result.tlsVerified, true);
  assert.deepEqual(commands, ['EHLO smoke.invalid', 'STARTTLS']);
});

test('missing STARTTLS capability is distinct from TCP/TLS network blockage', async t => {
  const commands = [];
  const server = net.createServer(socket => {
    socket.write('220 localhost synthetic SMTP\r\n');
    socket.on('data', data => {
      commands.push(data.toString().trim());
      socket.write('250 localhost\r\n');
    });
  });
  const port = await listen(server, t);
  const result = await probeTarget({ host: 'localhost', port, mode: 'starttls' }, localOptions());
  assert.equal(result.ok, false);
  assert.equal(result.tcpConnected, true);
  assert.equal(result.errorCode, 'starttls_not_advertised');
  assert.deepEqual(commands, ['EHLO smoke.invalid']);
});

test('a hanging SMTP server is bounded by a total deadline', async t => {
  const port = await listen(net.createServer(() => {}), t);
  const result = await probeTarget({ host: 'localhost', port, mode: 'starttls' }, {
    ...localOptions(), timeoutMs: 100,
  });
  assert.equal(result.ok, false);
  assert.equal(result.tcpConnected, true);
  assert.equal(result.errorCode, 'probe_timeout');
  assert.ok(result.elapsedMs < 2000);
});

test('malformed/oversized banners are rejected', async t => {
  for (const banner of ['not SMTP\r\n', `220 ${'x'.repeat(17000)}`]) {
    const port = await listen(net.createServer(socket => socket.write(banner)), t);
    const result = await probeTarget({ host: 'localhost', port, mode: 'starttls' }, localOptions());
    assert.equal(result.ok, false);
    assert.ok(['smtp_invalid_reply', 'smtp_reply_too_large'].includes(result.errorCode));
  }
});

test('only fixed mail destinations and requested ports are configured', () => {
  assert.deepEqual(TARGETS.map(({ host, port }) => `${host}:${port}`), [
    'smtp.beget.com:465', 'smtp.beget.com:587', 'smtp.yandex.ru:465', 'smtp.yandex.ru:587',
  ]);
  assert.equal(Object.isFrozen(TARGETS), true);
  assert.ok(TARGETS.every(Object.isFrozen));
});
