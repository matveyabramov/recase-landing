import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';

// GET only, no credentials, no send/create operation, no redirects or input URLs.
export const HTTPS_TARGETS = Object.freeze([
  Object.freeze({ id: 'control', url: 'https://example.com/' }),
  Object.freeze({ id: 'yandex_postbox', url: 'https://postbox.cloud.yandex.net/v2/email/configuration-sets' }),
]);

const SAFE_ERRORS = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'EPROTO', 'HPE_INVALID_CONSTANT',
  'HPE_HEADER_OVERFLOW', 'HPE_INVALID_HEADER_TOKEN',
  'probe_timeout', 'connection_closed', 'dns_no_address', 'tls_not_authorized',
]);
const failure = code => Object.assign(new Error(code), { code });

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off(event, ready); socket.off('error', error); socket.off('close', closed);
    };
    const ready = () => { cleanup(); resolve(); };
    const error = value => { cleanup(); reject(value); };
    const closed = () => error(failure('connection_closed'));
    socket.once(event, ready); socket.once('error', error); socket.once('close', closed);
  });
}

// Injection is exclusively for local tests; HTTP callers cannot change these.
export async function probeHttpsTarget(target, {
  lookup = dnsLookup,
  connect = options => net.connect(options),
  upgrade = options => tls.connect(options),
  request = options => http.request(options),
  timeoutMs = 12000,
} = {}) {
  const destination = new URL(target.url);
  if (destination.protocol !== 'https:' || destination.username || destination.password
      || (destination.port && destination.port !== '443')) throw failure('invalid_test_target');
  const began = performance.now();
  let phaseBegan = began;
  const result = {
    id: target.id, url: target.url, method: 'GET', port: 443,
    ok: false, transportAccessible: false, dnsResolved: false,
    tcpConnected: false, tlsVerified: false, httpResponded: false,
    httpStatus: null, stage: 'dns', timingsMs: {},
    authenticationTested: false, deliveryTested: false,
  };
  let raw;
  let socket;
  let req;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(failure('probe_timeout')), timeoutMs);
  const destroy = () => { req?.destroy(); socket?.destroy(); if (raw !== socket) raw?.destroy(); };
  controller.signal.addEventListener('abort', destroy, { once: true });
  function next(stage) {
    result.timingsMs[result.stage] = Math.round(performance.now() - phaseBegan);
    result.stage = stage; phaseBegan = performance.now();
  }
  try {
    const addresses = await abortable(lookup(destination.hostname, { all: true, order: 'ipv4first' }), controller.signal);
    const selected = addresses.find(item => item.family === 4) || addresses[0];
    if (!selected) throw failure('dns_no_address');
    result.dnsResolved = true;
    result.addressFamily = selected.family; // Addresses themselves are never returned.
    next('tcp');
    raw = socket = connect({ host: selected.address, port: 443, family: selected.family });
    socket.on('error', () => {});
    await abortable(waitFor(socket, 'connect'), controller.signal);
    result.tcpConnected = true;
    next('tls');
    socket = upgrade({ socket: raw, servername: destination.hostname,
      rejectUnauthorized: true, minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'] });
    socket.on('error', () => {});
    await abortable(waitFor(socket, 'secureConnect'), controller.signal);
    if (!socket.authorized) throw failure('tls_not_authorized');
    result.tlsVerified = true;
    result.tlsProtocol = socket.getProtocol();
    next('http');
    const response = new Promise((resolve, reject) => {
      // Native HTTP parser over the existing VERIFIED TLS socket. No second DNS/TCP.
      req = request({ hostname: destination.hostname, port: 443,
        path: destination.pathname + destination.search, method: 'GET',
        createConnection: () => socket, maxHeaderSize: 16384,
        headers: { Host: destination.hostname, Accept: 'application/json',
          'User-Agent': 're-layero-smoke/1.0', Connection: 'close' } });
      req.once('error', reject);
      req.once('response', response => {
        const status = response.statusCode;
        response.on('error', () => {});
        // Do not retain/log body or response headers. Never follow a Location.
        response.destroy();
        resolve(status);
      });
      req.end();
    });
    result.httpStatus = await abortable(response, controller.signal);
    result.httpResponded = true;
    result.ok = result.transportAccessible = true; // Includes 401/403, not authorization.
    next('complete');
  } catch (error) {
    const code = controller.signal.aborted ? 'probe_timeout' : error.code;
    result.errorCode = SAFE_ERRORS.has(code) ? code : 'connection_failed';
    result.timingsMs[result.stage] = Math.round(performance.now() - phaseBegan);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', destroy);
    destroy();
  }
  result.elapsedMs = Math.round(performance.now() - began);
  return result;
}

export async function runHttpsProbes() {
  const results = [];
  for (const target of HTTPS_TARGETS) results.push(await probeHttpsTarget(target));
  return results;
}
