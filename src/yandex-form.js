import { yandexForms } from './config.js';

const EMBED_SCRIPT = 'https://forms.yandex.ru/_static/embed.js';
let embedReady;

function loadEmbedScript() {
  if (embedReady) return embedReady;
  embedReady = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = EMBED_SCRIPT;
    script.async = true;
    script.dataset.yandexFormsEmbed = '';
    const timer = setTimeout(() => resolve(false), 8000);
    const finish = (loaded) => { clearTimeout(timer); resolve(loaded); };
    script.addEventListener('load', () => finish(true), { once: true });
    script.addEventListener('error', () => finish(false), { once: true });
    document.head.append(script);
  });
  return embedReady;
}

export function mountYandexForm(container, type) {
  const wrapper = document.createElement('div');
  wrapper.className = 'yandex-form';
  const status = document.createElement('p');
  status.className = 'yandex-form__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  wrapper.append(status);
  container.replaceChildren(wrapper);
  const url = yandexForms[type];
  if (!yandexForms.enabled || !url) {
    status.textContent = !yandexForms.enabled
      ? 'Приём заявок в этом режиме отключён.'
      : 'Форма временно недоступна: не настроен адрес формы.';
    return { start() {}, destroy() {} };
  }

  const frame = document.createElement('iframe');
  frame.className = 'yandex-form__iframe';
  frame.title = type === 'participant' ? 'Заявка участника RE:CASE — Яндекс Форма' : 'Заявка партнёра RE:CASE — Яндекс Форма';
  frame.name = `yandex-${url.match(/\/u\/([^/?]+)/)[1]}`;
  frame.width = '100%';
  frame.height = '800'; // Native iframe scrolling remains available if embed.js is blocked.
  wrapper.append(frame);
  let disposed = false;
  let timer;
  let scriptLoaded = false;
  const loading = 'Загружаем форму…';
  const uncertain = 'Если форма не появилась или не отвечает, закройте окно и попробуйте позже.';
  status.textContent = loading;
  wrapper.setAttribute('aria-busy', 'true');
  function finish(message = '') {
    clearTimeout(timer);
    wrapper.removeAttribute('aria-busy');
    status.textContent = message;
  }
  frame.addEventListener('load', () => {
    // Loading is never evidence of submission or even an HTTP-success response.
    if (!disposed && frame.hasAttribute('src')) finish(scriptLoaded ? ''
      : 'Автоматическая высота недоступна. Прокрутите форму внутри окна.');
  });
  frame.addEventListener('error', () => { if (!disposed) finish(uncertain); });
  return {
    async start() {
      // Navigate only after showModal(): the external form measures a visible width.
      scriptLoaded = await loadEmbedScript();
      if (disposed) return;
      timer = setTimeout(() => finish(uncertain), 20000);
      frame.src = url;
    },
    destroy() {
      disposed = true;
      clearTimeout(timer);
      wrapper.removeAttribute('aria-busy');
    },
  };
}
