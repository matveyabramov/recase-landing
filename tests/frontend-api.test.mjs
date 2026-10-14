import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveLeadApi } from '../src/lead-api-config.js';

const origin = 'https://production.layero.example';
const api = 'https://matveyyb.beget.tech/api/lead.php';
const settings = { PROD: true, MODE: 'layero', VITE_LEAD_API_ENABLED: 'true', VITE_SITE_ORIGIN: origin, VITE_LEAD_API_URL: api };
test('Production API settings fail closed outside the explicit Layero build', () => {
  assert.equal(resolveLeadApi(settings).enabled, true);
  for (const change of [{ PROD: false }, { MODE: 'development' }, { MODE: 'production' },
    { VITE_LEAD_API_ENABLED: 'false' }, { VITE_SITE_ORIGIN: '' }, { VITE_SITE_ORIGIN: origin + '/' },
    { VITE_LEAD_API_URL: '/api/lead.php' }, { VITE_LEAD_API_URL: api.replace('https:', 'http:') },
    { VITE_LEAD_API_URL: api + '?token=secret' }, { VITE_LEAD_API_URL: api.replace('https://', 'https://user:pass@') }]) {
    assert.equal(resolveLeadApi({ ...settings, ...change }).enabled, false, JSON.stringify(change));
  }
});

test('Built forms: success, errors, retry identity, preview isolation and private data exclusion', async (t) => {
  // Use an installed Playwright or the desktop runtime, without downloading dependencies.
  const require = process.env.RECASE_TEST_NODE_MODULES
    ? createRequire(join(resolve(process.env.RECASE_TEST_NODE_MODULES), '../package.json')) : createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const root = await mkdtemp(join(tmpdir(), 'recase-frontend-test-'));
  let browser;
  const sentinel = 'FICTIONAL_PRIVATE_SECRET_NEVER_PUBLIC';
  async function build(mode, enabled, folder) {
    const out = join(root, folder);
    const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', mode, '--outDir', out], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, VITE_BASE_PATH: '/', VITE_LEAD_API_ENABLED: enabled,
        VITE_SITE_ORIGIN: origin, VITE_LEAD_API_URL: api, MYSQL_PASSWORD: sentinel, TELEGRAM_BOT_TOKEN: sentinel },
    });
    assert.equal(result.status, 0, result.stderr);
    for (const file of ['index.html', 'privacy-policy.html', 'personal-data-consent.html']) await readFile(join(out, file));
    async function scan(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await scan(path);
        else {
          assert.ok(!/\.(php|sql)$/.test(entry.name), 'No backend files in static output');
          assert.ok(!(await readFile(path)).includes(Buffer.from(sentinel)), 'No private environment values in frontend');
        }
      }
    }
    await scan(out);
    return out;
  }
  try {
    const live = await build('layero', 'true', 'live-mocked');
    const preview = await build('production', 'true', 'preview'); // Even accidentally enabled env is safe.
    const closed = await build('layero', 'false', 'closed');
    browser = await chromium.launch({ headless: true,
      ...(process.env.RECASE_TEST_BROWSER ? { executablePath: process.env.RECASE_TEST_BROWSER } : {}) });
    async function pageFor(out, host = origin, width = 1512) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const requests = [];
      let outcome = 'accepted';
      // Every request is intercepted. No connection to Beget, Telegram or any public site.
      await context.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (req.url() === api) {
          const headers = { 'Access-Control-Allow-Origin': host, 'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', Vary: 'Origin' };
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
          requests.push(req.postDataJSON());
          if (outcome === 'offline') return route.abort('connectionfailed');
          if (outcome === 'html') return route.fulfill({ status: 502, contentType: 'text/html', body: 'Unavailable' });
          const status = { unavailable: 503, validation_error: 422, request_conflict: 409, rate_limited: 429 }[outcome] || 200;
          return route.fulfill({ status, headers, body: JSON.stringify({ ok: outcome === 'accepted', status: outcome }) });
        }
        if (url.origin !== host) return route.abort();
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if (relative.includes('..')) return route.abort();
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
        try { return await route.fulfill({ contentType: mime[extname(relative)] || 'application/octet-stream', body: await readFile(join(out, relative)) }); }
        catch { return route.fulfill({ status: 404, body: '' }); }
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const original = window.fetch;
        window.fetch = (url, options) => {
          window.__leadFetchOptions = { credentials: options.credentials, mode: options.mode, redirect: options.redirect, referrerPolicy: options.referrerPolicy };
          return original(url, options);
        };
      });
      await page.goto(host);
      return { page, context, requests, setOutcome: (value) => { outcome = value; } };
    }
    async function fill(page, type = 'participate') {
      await page.locator(`[data-form-link="${type}"]:visible`).first().click();
      await page.locator('#lead-name').fill('Вымышленный Участник');
      await page.locator('#lead-contact').fill('@fictional_test');
      await page.locator('#lead-consent').check();
    }
    async function submit(page) { await page.locator('.lead-form__submit').click(); }
    async function retained(page) {
      await page.waitForFunction(() => !document.querySelector('.lead-form__submit').disabled);
      assert.equal(await page.locator('#lead-name').inputValue(), 'Вымышленный Участник');
      assert.equal(await page.locator('#lead-contact').inputValue(), '@fictional_test');
      assert.equal(await page.locator('#lead-consent').isChecked(), true);
      assert.ok(await page.locator('.lead-form__status').textContent());
      assert.notEqual(await page.locator('#lead-modal-title').textContent(), 'СПАСИБО ЗА ЗАЯВКУ!');
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    }
    for (const [type, width] of [['participate', 390], ['partner', 1512]]) {
      await t.test(`Saved ${type} shows existing thanks (${width}px)`, async () => {
        const run = await pageFor(live, origin, width);
        await fill(run.page, type); await submit(run.page);
        await run.page.getByRole('heading', { name: 'СПАСИБО ЗА ЗАЯВКУ!' }).waitFor();
        assert.equal(run.requests[0].type, type === 'partner' ? 'partner' : 'participant');
        assert.equal(await run.page.locator('#lead-modal-description').textContent(), 'Мы получили ваши данные и свяжемся с вами в течение дня');
        assert.deepEqual(await run.page.evaluate(() => window.__leadFetchOptions), { credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer' });
        await run.context.close();
      });
    }
    for (const error of ['offline', 'unavailable', 'html', 'validation_error', 'request_conflict', 'rate_limited']) {
      await t.test(`${error} preserves fields and consent; retry retains UUID`, async () => {
        const run = await pageFor(live);
        run.setOutcome(error); await fill(run.page); await submit(run.page); await retained(run.page);
        await submit(run.page); await retained(run.page);
        assert.equal(run.requests.length, 2);
        assert.equal(run.requests[0].requestId, run.requests[1].requestId);
        await run.page.locator('#lead-name').fill('Изменённый Участник');
        await submit(run.page);
        await run.page.waitForFunction(() => !document.querySelector('.lead-form__submit').disabled);
        assert.notEqual(run.requests[2].requestId, run.requests[0].requestId);
        await run.context.close();
      });
    }
    await t.test('Missing consent is blocked before fetch', async () => {
      const run = await pageFor(live);
      await fill(run.page); await run.page.locator('#lead-consent').uncheck();
      await submit(run.page);
      assert.equal(run.requests.length, 0);
      assert.equal(await run.page.locator('#lead-name').inputValue(), 'Вымышленный Участник');
      await run.context.close();
    });
    for (const [label, out, host] of [['GitHub Pages', live, 'https://fictional.github.io'],
      ['local development host', live, 'http://localhost'], ['unconfirmed host', live, 'https://other.example'],
      ['ordinary Vite preview with enabled env', preview, origin], ['Layero intake disabled', closed, origin]]) {
      await t.test(`${label} sends no application`, async () => {
        const run = await pageFor(out, host);
        await fill(run.page); await submit(run.page); await retained(run.page);
        assert.equal(run.requests.length, 0);
        await run.context.close();
      });
    }
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});
