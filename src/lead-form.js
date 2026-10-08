import { privacyPolicyUrl } from './config.js';

// Local prototype only: no network requests, storage, logging or analytics.
export function mountLeadForm(container, onComplete) {
  const form = document.createElement('form');
  form.className = 'lead-form';
  form.method = 'dialog'; // Even native fallback submission has no network destination.
  form.autocomplete = 'off';
  form.innerHTML = `
    <p class="lead-form__notice">Тестовый режим: данные никуда не отправляются.</p>
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
    <label class="lead-form__consent">
      <input name="consent" type="checkbox" required />
      <span>Согласен с обработкой персональных данных <span aria-hidden="true">*</span></span>
    </label>
    <div class="lead-form__policy"></div>
    <button class="button button-dark lead-form__submit" type="submit">Отправить заявку</button>`;

  const policy = form.querySelector('.lead-form__policy');
  if (privacyPolicyUrl) {
    const link = document.createElement('a');
    link.href = privacyPolicyUrl;
    link.textContent = 'Политика конфиденциальности';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    policy.append(link);
  } else {
    policy.textContent = 'Политика конфиденциальности будет добавлена перед запуском.';
  }

  const textInputs = [...form.querySelectorAll('input[type="text"]')];
  for (const input of textInputs) {
    input.addEventListener('input', () => input.setCustomValidity(''));
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const input of textInputs) {
      input.setCustomValidity(input.value.trim() ? '' : 'Заполните это поле.');
    }
    if (!form.reportValidity()) return;
    form.reset();
    onComplete(); // Demonstration state, never evidence of a real submission.
  });
  container.replaceChildren(form);
}
