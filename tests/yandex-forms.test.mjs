import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveYandexForms } from '../src/yandex-form-config.js';

const participant = 'https://forms.yandex.ru/u/6acf8895852af3fab5c7a14b?iframe=1';
const partner = 'https://forms.yandex.ru/u/6acfa04d2c4f89f2a71bb1ca?iframe=1';
const script = 'https://forms.yandex.ru/_static/embed.js';
const settings = { PROD: true, MODE: 'layero', VITE_YANDEX_FORMS_ENABLED: 'true',
  VITE_YANDEX_PARTICIPANT_FORM_URL: participant, VITE_YANDEX_PARTNER_FORM_URL: partner };

test('Local forms work; production and Pages require the intended configuration', () => {
  assert.equal(resolveYandexForms(settings).enabled, true);
  assert.equal(resolveYandexForms({ ...settings, DEV: true, MODE: 'development', PROD: false }).enabled, true);
  for (const change of [{ MODE: 'production' }, { VITE_YANDEX_FORMS_ENABLED: 'false' },
    { VITE_YANDEX_FORMS_ENABLED: undefined }, { PROD: false }]) {
    assert.equal(resolveYandexForms({ ...settings, ...change }).enabled, false);
  }
  for (const host of ['github.io', 'test.github.io']) assert.equal(resolveYandexForms(settings, host).enabled, false);
  for (const url of ['', 'http://forms.yandex.ru/u/abc', 'https://other.example/u/abc',
    'https://user:pass@forms.yandex.ru/u/abc', 'https://forms.yandex.ru/admin']) {
    assert.equal(resolveYandexForms({ ...settings, VITE_YANDEX_PARTICIPANT_FORM_URL: url }).participant, '');
  }
  assert.equal(resolveYandexForms({ ...settings, VITE_YANDEX_PARTICIPANT_FORM_URL: participant.split('?')[0] }).participant, participant);
});

test('Built iframe integration: CTA, scrolling, lifecycle, failures and preview isolation', async t => {
  const require = process.env.RECASE_TEST_NODE_MODULES
    ? createRequire(join(resolve(process.env.RECASE_TEST_NODE_MODULES), '../package.json')) : createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const root = await mkdtemp(join(tmpdir(), 'recase-yandex-tests-'));
  let browser;
  const sentinel = 'FICTIONAL_PRIVATE_SECRET_NEVER_PUBLIC';
  async function build(folder, overrides = {}, mode = 'layero') {
    const out = join(root, folder);
    const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', mode, '--outDir', out], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, VITE_BASE_PATH: '/', ...settings, ...overrides,
        TELEGRAM_BOT_TOKEN: sentinel, MYSQL_PASSWORD: sentinel },
    });
    assert.equal(result.status, 0, result.stderr);
    async function scan(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await scan(path);
        else {
          assert.ok(!/\.(php|sql|pptx|docx|env)$/.test(entry.name));
          const body = await readFile(path);
          assert.ok(!body.includes(Buffer.from(sentinel)));
          if (entry.name.endsWith('.js')) {
            assert.ok(!body.includes(Buffer.from('/api/lead.php')), 'Reserve API absent from bundle');
            assert.ok(!body.includes(Buffer.from('СПАСИБО ЗА ЗАЯВКУ!')), 'No custom thanks');
            assert.ok(!body.includes(Buffer.from('api.telegram.org')));
          }
        }
      }
    }
    await scan(out);
    return out;
  }
  // Offline fixture uses Yandex's public iframe-height protocol. Live QA is separate.
  const embed = process.env.RECASE_TEST_EMBED_SCRIPT
    ? await readFile(process.env.RECASE_TEST_EMBED_SCRIPT, 'utf8')
    : `window.addEventListener('message',e=>{try{const d=JSON.parse(e.data);for(const f of document.querySelectorAll('iframe'))if(f.contentWindow===e.source&&d['iframe-height'])f.style.height=d['iframe-height']+'px';}catch{}});`;
  async function pageFor(out, { width = 1512, height = 900, host = 'https://local.example', resize = true, failure = '', delayedScript = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const requests = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ url: request.url(), method: request.method() });
      if (request.url() === script) {
        if (delayedScript) await new Promise(r => setTimeout(r, 300));
        if (failure === 'script') return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: embed });
      }
      if (url.origin === 'https://forms.yandex.ru') {
        if (failure === 'frame') return route.abort();
        if (failure === 'timeout') return; // Remain pending until context closes.
        return route.fulfill({ contentType: 'text/html', body: `<html><meta name="viewport" content="width=device-width"><style>body{margin:0;overflow-wrap:anywhere}main{height:1450px}input{max-width:90%}</style><main><h1>Fixture form</h1><input aria-label="Test field"></main><button>Отправить</button><footer>Служебный футер</footer>${resize ? `<script>parent.postMessage(JSON.stringify({'iframe-height':1550}),'*');</script>` : ''}</html>` });
      }
      if (url.origin !== host) return route.abort();
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      if (relative.includes('..')) return route.abort();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      try { return route.fulfill({ contentType: mime[extname(relative)] || 'application/octet-stream', body: await readFile(join(out, relative)) }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    await page.goto(host);
    return { page, context, requests };
  }
  async function open(page, index = 1) {
    await page.locator('[data-form-link]').nth(index).click();
    await page.locator('iframe[src]').waitFor();
  }
  async function geometry(page) {
    return page.evaluate(() => {
      const dialog = document.querySelector('dialog'), surface = document.querySelector('.lead-modal__surface');
      const f = document.querySelector('iframe').getBoundingClientRect(), d = dialog.getBoundingClientRect();
      const c = document.querySelector('.lead-modal__close').getBoundingClientRect();
      return { horizontal: surface.scrollWidth > surface.clientWidth,
        fits: d.left >= 0 && d.right <= innerWidth && f.left >= d.left && f.right <= d.right,
        closeVisible: c.top >= d.top && c.bottom <= d.bottom, locked: document.body.style.position === 'fixed' };
    });
  }
  try {
    const live = await build('enabled');
    const preview = await build('preview', {}, 'production');
    const disabled = await build('disabled', { VITE_YANDEX_FORMS_ENABLED: 'false' });
    const missing = await build('missing', { VITE_YANDEX_PARTICIPANT_FORM_URL: '' });
    browser = await chromium.launch({ headless: true,
      ...(process.env.RECASE_TEST_BROWSER ? { executablePath: process.env.RECASE_TEST_BROWSER } : {}) });
    for (const width of [320, 390, 744, 1512]) {
      await t.test(`Both forms, repeat open, native height and close at ${width}px`, async () => {
        const run = await pageFor(live, { width, height: width <= 390 ? 568 : 900 });
        for (const index of [1, 2, 1, 2]) {
          await open(run.page, index);
          const expected = index === 1 ? participant : partner;
          assert.equal(await run.page.locator('iframe').getAttribute('src'), expected);
          await run.page.waitForFunction(() => document.querySelector('iframe').style.height === '1550px');
          assert.equal(await run.page.locator('dialog form, dialog input, dialog [type=submit]').count(), 0);
          assert.deepEqual(await geometry(run.page), { horizontal: false, fits: true, closeVisible: true, locked: true });
          await run.page.locator('.lead-modal__surface').evaluate(e => e.scrollTop = e.scrollHeight);
          assert.equal((await geometry(run.page)).closeVisible, true);
          assert.equal(await run.page.locator('.yandex-form a').count(), 0);
          await run.page.locator('.lead-modal__close').click();
          assert.equal(await run.page.locator('dialog').getAttribute('open'), null);
          assert.equal(await run.page.evaluate(() => document.body.style.position), '');
        }
        assert.equal(run.requests.filter(r => r.url === script).length, 1);
        assert.ok(!run.requests.some(r => r.url.includes('lead.php') || r.method === 'POST'));
        await run.context.close();
      });
    }
    await t.test('All five CTA match; Escape, overlay, focus and scroll restoration', async () => {
      const run = await pageFor(live);
      assert.equal(await run.page.locator('[data-form-link]').count(), 5);
      for (let i = 0; i < 5; i++) {
        await open(run.page, i);
        const type = await run.page.locator('[data-form-link]').nth(i).getAttribute('data-form-link');
        assert.equal(await run.page.locator('iframe').getAttribute('src'), type === 'partner' ? partner : participant);
        if (i % 2) await run.page.mouse.click(2, 2);
        else await run.page.keyboard.press('Escape');
        assert.equal(await run.page.locator('dialog').getAttribute('open'), null);
        assert.equal(await run.page.locator('[data-form-link]').nth(i).evaluate(e => e === document.activeElement), true);
      }
      await run.page.locator('[data-form-link]').last().scrollIntoViewIfNeeded();
      const before = await run.page.evaluate(() => scrollY);
      await open(run.page, 4);
      await run.page.keyboard.press('Escape');
      assert.equal(await run.page.evaluate(() => scrollY), before);
      // Cross-origin keyboard events do not reach the parent; close stays available.
      await open(run.page);
      await run.page.frameLocator('iframe').getByRole('textbox').focus();
      await run.page.keyboard.press('Escape');
      assert.notEqual(await run.page.locator('dialog').getAttribute('open'), null);
      await run.page.locator('.lead-modal__close').click();
      await run.context.close();
    });
    for (const [label, out, host] of [['ordinary preview', preview], ['disabled Layero', disabled],
      ['GitHub host', live, 'https://test.github.io'], ['missing URL', missing]]) {
      await t.test(label, async () => {
        const run = await pageFor(out, host ? { host } : {});
        await run.page.locator('[data-form-link]').nth(1).click();
        assert.equal(await run.page.locator('iframe').count(), 0);
        assert.ok(await run.page.locator('.yandex-form__status').textContent());
        assert.ok(!run.requests.some(r => r.url.startsWith('https://forms.yandex.ru')));
        await run.page.locator('.lead-modal__close').click();
        await run.context.close();
      });
    }
    for (const failure of ['script', 'frame', 'timeout']) {
      await t.test(`External ${failure} failure leaves close and fallback available`, async () => {
        const run = await pageFor(live, { failure, resize: false });
        if (failure === 'timeout') await run.page.clock.install();
        await open(run.page);
        if (failure === 'timeout') {
          assert.equal(await run.page.locator('.yandex-form__status').textContent(), 'Загружаем форму…');
          await run.page.clock.fastForward(21000);
          assert.match(await run.page.locator('.yandex-form__status').textContent(), /не появилась/);
        }
        if (failure === 'script') {
          await run.page.waitForFunction(() => !document.querySelector('.yandex-form').hasAttribute('aria-busy'));
          assert.match(await run.page.locator('.yandex-form__status').textContent(), /высота недоступна/);
          assert.equal(await run.page.locator('iframe').getAttribute('height'), '800');
          assert.equal(await run.page.locator('iframe').getAttribute('scrolling'), null);
        }
        assert.equal(await run.page.locator('.yandex-form a').count(), 0);
        assert.notEqual(await run.page.locator('#lead-modal-title').textContent(), 'СПАСИБО ЗА ЗАЯВКУ!');
        await run.page.locator('.lead-modal__close').click();
        assert.equal(await run.page.evaluate(() => document.body.style.position), '');
        await run.context.close();
      });
    }
    await t.test('Closing before script load cannot navigate a stale iframe', async () => {
      const run = await pageFor(live, { delayedScript: true });
      await run.page.locator('[data-form-link]').nth(1).click();
      await run.page.locator('.lead-modal__close').click();
      await open(run.page, 2);
      await run.page.waitForFunction(() => document.querySelector('iframe').style.height === '1550px');
      assert.ok(!run.requests.some(r => r.url === participant));
      assert.equal(run.requests.filter(r => r.url === script).length, 1);
      await run.context.close();
    });
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});
