import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';

// Fixed public destinations. Never accept a host, port or credentials over HTTP.
export const TARGETS = Object.freeze([
  Object.freeze({ host: 'smtp.beget.com', port: 465, mode: 'implicit_tls', documentedPort: true }),
  Object.freeze({ host: 'smtp.beget.com', port: 587, mode: 'starttls', documentedPort: false }),
  Object.freeze({ host: 'smtp.yandex.ru', port: 465, mode: 'implicit_tls', documentedPort: true }),
  Object.freeze({ host: 'smtp.yandex.ru', port: 587, mode: 'starttls', documentedPort: true }),
]);

const SAFE_ERRORS = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'EPROTO',
  'probe_timeout', 'smtp_closed', 'smtp_invalid_reply', 'smtp_reply_too_large',
  'smtp_greeting_rejected', 'smtp_ehlo_rejected', 'starttls_not_advertised',
  'starttls_rejected', 'tls_not_authorized',
]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const clean = () => {
      socket.off(event, ready);
      socket.off('error', error);
      socket.off('close', closed);
    };
    const ready = () => { clean(); resolve(); };
    const error = value => { clean(); reject(value); };
    const closed = () => error(failure('smtp_closed'));
    socket.once(event, ready);
    socket.once('error', error);
    socket.once('close', closed);
  });
}

// Bounded multiline SMTP reader; banners and remote error text never leave it.
function replyReader(socket) {
  let buffer = '';
  let lines = [];
  let bytes = 0;
  let problem;
  let waiting;
  const replies = [];
  function fail(error) {
    problem = error;
    if (waiting) { waiting.reject(error); waiting = undefined; }
  }
  function data(chunk) {
    bytes += chunk.length;
    if (bytes > 16384) { fail(failure('smtp_reply_too_large')); socket.destroy(); return; }
    buffer += chunk.toString('ascii');
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!/^[0-9]{3}[ -]/.test(line)
          || (lines.length && line.slice(0, 3) !== lines[0].slice(0, 3))) {
        fail(failure('smtp_invalid_reply')); socket.destroy(); return;
      }
      lines.push(line);
      if (line[3] === ' ') {
        const reply = { code: Number(line.slice(0, 3)), lines };
        lines = [];
        if (waiting) { waiting.resolve(reply); waiting = undefined; }
        else replies.push(reply);
      }
    }
  }
  const error = value => fail(value);
  const closed = () => fail(failure('smtp_closed'));
  socket.on('data', data);
  socket.on('error', error);
  socket.on('close', closed);
  socket.on('end', closed);
  return {
    read() {
      if (problem) return Promise.reject(problem);
      if (replies.length) return Promise.resolve(replies.shift());
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
    },
    detach() {
      socket.off('data', data);
      socket.off('error', error);
      socket.off('close', closed);
      socket.off('end', closed);
    },
  };
}

// Dependencies are injectable for loopback-only tests, never from environment/HTTP.
export async function probeTarget(target, {
  connect = options => net.connect(options),
  upgrade = options => tls.connect(options),
  timeoutMs = 8000,
} = {}) {
  const started = performance.now();
  const result = {
    ...target, ok: false, dnsResolved: false, tcpConnected: false,
    tlsVerified: false, smtpGreeting: false, stage: 'tcp',
    authenticationTested: false, deliveryTested: false,
  };
  let socket;
  let raw;
  let reader;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    socket?.destroy(failure('probe_timeout'));
    if (raw !== socket) raw?.destroy();
  }, timeoutMs);
  try {
    raw = socket = connect({ host: target.host, port: target.port });
    socket.on('error', () => {});
    socket.once('lookup', error => { result.dnsResolved = !error; });
    await waitFor(socket, 'connect');
    result.tcpConnected = true;
    result.dnsResolved = true;
    if (target.mode === 'starttls') {
      result.stage = 'smtp_greeting';
      reader = replyReader(socket);
      if ((await reader.read()).code !== 220) throw failure('smtp_greeting_rejected');
      result.smtpGreeting = true;
      result.stage = 'ehlo';
      const ehloReply = reader.read();
      socket.write('EHLO smoke.invalid\r\n');
      const ehlo = await ehloReply;
      if (ehlo.code !== 250) throw failure('smtp_ehlo_rejected');
      if (!ehlo.lines.some(line => /^250[ -]STARTTLS(?:\s|$)/i.test(line))) {
        throw failure('starttls_not_advertised');
      }
      result.stage = 'starttls';
      const startReply = reader.read();
      socket.write('STARTTLS\r\n');
      if ((await startReply).code !== 220) throw failure('starttls_rejected');
      reader.detach();
      reader = undefined;
    }
    result.stage = 'tls';
    socket = upgrade({ socket: raw, servername: target.host,
      rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    socket.on('error', () => {});
    await waitFor(socket, 'secureConnect');
    if (!socket.authorized) throw failure('tls_not_authorized');
    result.tlsVerified = true;
    result.tlsProtocol = socket.getProtocol();
    if (target.mode === 'implicit_tls') {
      result.stage = 'smtp_greeting';
      reader = replyReader(socket);
      if ((await reader.read()).code !== 220) throw failure('smtp_greeting_rejected');
      result.smtpGreeting = true;
    }
    result.ok = true;
    result.stage = 'complete';
  } catch (error) {
    const code = timedOut ? 'probe_timeout' : error.code;
    result.errorCode = SAFE_ERRORS.has(code) ? code : 'connection_failed';
  } finally {
    clearTimeout(timer);
    reader?.detach();
    socket?.destroy();
    if (raw !== socket) raw?.destroy();
  }
  result.elapsedMs = Math.round(performance.now() - started);
  return result;
}

export async function runProbes() {
  const results = [];
  // Four bounded, sequential connections: at most ~32 seconds in total.
  for (const target of TARGETS) results.push(await probeTarget(target));
  return results;
}
