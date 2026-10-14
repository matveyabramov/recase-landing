// Reserve implementation: this module is not imported by the active frontend.
import { privacyPolicyUrl, personalDataConsentUrl } from './config.js';
import { resolveLeadApi } from './lead-api-config.js';
const { enabled: leadApiEnabled, url: leadApiUrl, origin: leadSiteOrigin } = resolveLeadApi(import.meta.env);

// Data lives only in the form/request, never in browser storage or analytics.
export function mountLeadForm(container, type, onComplete) {
  const form = document.createElement('form');
  form.className = 'lead-form';
  form.method = 'dialog'; // Even native fallback submission has no network destination.
  form.autocomplete = 'off';
  form.innerHTML = `
    <label class="lead-form__field" for="lead-name">
      <span>Имя <span aria-hidden="true">*</span></span>
      <input id="lead-name" name="name" type="text" required maxlength="120" autocomplete="off" />
    </label>
    <label class="lead-form__field" for="lead-contact">
      <span>Телефон или Telegram <span aria-hidden="true">*</span></span>
      <input id="lead-contact" name="contact" type="text" required maxlength="160"
        autocomplete="off" aria-describedby="lead-contact-hint" />
    </label>
    <p class="lead-form__hint" id="lead-contact-hint">Укажите один способ связи: номер телефона или @username.</p>
    <div class="lead-form__consent">
      <input id="lead-consent" name="consent" type="checkbox" required aria-labelledby="lead-consent-text" />
      <span id="lead-consent-text"><label for="lead-consent">Я даю </label><a href="${personalDataConsentUrl}"
        target="_blank" rel="noopener noreferrer">согласие на обработку персональных данных</a> (подробнее — <a href="${privacyPolicyUrl}"
        target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>).</span>
    </div>
    <button class="button button-dark lead-form__submit" type="submit">Отправить заявку</button>
    <p class="lead-form__status" role="status" aria-live="polite" aria-atomic="true"></p>`;

  const status = form.querySelector('.lead-form__status');
  const submit = form.querySelector('[type="submit"]');
  const consent = form.querySelector('[name="consent"]');
  let pending = false;
  let previousValues;
  let requestId;

  function showStatus(message) {
    status.textContent = message;
    status.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  const textInputs = [...form.querySelectorAll('input[type="text"]')];
  for (const input of textInputs) {
    input.addEventListener('input', () => input.setCustomValidity(''));
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    for (const input of textInputs) {
      input.setCustomValidity(input.value.trim() ? '' : 'Заполните это поле.');
    }
    if (!form.reportValidity()) return;
    const pagesHost = location.hostname === 'github.io' || location.hostname.endsWith('.github.io');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (!leadApiEnabled || pagesHost || loopback || location.origin !== leadSiteOrigin) {
      showStatus('Приём заявок временно недоступен. Попробуйте позже.');
      return;
    }
    if (location.protocol !== 'https:') {
      showStatus('Отправляйте заявку с сайта RE:CASE по HTTPS.');
      return;
    }
    const values = {
      name: form.elements.name.value.trim(),
      contact: form.elements.contact.value.trim(),
      type,
      consent: consent.checked,
    };
    const signature = JSON.stringify(values);
    if (signature !== previousValues) {
      // Keep the same ID on a retry after a lost response, never retry automatically.
      requestId = crypto.randomUUID();
      previousValues = signature;
    }
    pending = true;
    submit.disabled = true;
    submit.textContent = 'Отправляем…';
    form.setAttribute('aria-busy', 'true');
    for (const input of textInputs) input.readOnly = true;
    consent.disabled = true;
    showStatus('Отправляем заявку…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(leadApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...values, requestId }),
        credentials: 'omit',
        mode: 'cors',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new Error('unexpected_response');
      }
      const result = await response.json();
      // An old in-flight form must never replace a newly opened modal.
      if (!form.isConnected) return;
      if (response.ok && result.ok === true && result.status === 'accepted') {
        form.reset();
        onComplete();
        return;
      }
      const messages = {
        unavailable: 'Приём заявок временно недоступен. Попробуйте позже.',
        rate_limited: 'Слишком много попыток. Попробуйте позже.',
        validation_error: 'Проверьте заполнение формы.',
        submission_unconfirmed: 'Не удалось подтвердить отправку. Не отправляйте заявку повторно; обратитесь к организаторам.',
        request_conflict: 'Обновите страницу перед отправкой изменённой заявки.',
        forbidden: 'Отправляйте заявку с сайта RE:CASE по HTTPS.',
      };
      showStatus(messages[result.status] || 'Не удалось отправить заявку. Попробуйте позже.');
      for (const input of textInputs) {
        if (typeof result.fields?.[input.name] === 'string') {
          input.setCustomValidity(result.fields[input.name]);
        }
      }
    } catch {
      if (form.isConnected) {
        showStatus('Не удалось подтвердить отправку. Проверьте соединение и попробуйте позже.');
      }
    } finally {
      clearTimeout(timer);
      pending = false;
      submit.disabled = false;
      submit.textContent = 'Отправить заявку';
      form.removeAttribute('aria-busy');
      for (const input of textInputs) input.readOnly = false;
      consent.disabled = false;
      if (form.isConnected) {
        form.reportValidity();
        // Disabling the focused submit button can move focus to the body.
        if (document.activeElement === document.body) submit.focus({ preventScroll: true });
      }
    }
  });
  container.replaceChildren(form);
}
