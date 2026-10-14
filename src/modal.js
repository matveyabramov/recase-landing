import { LEAD_FORMS } from './config.js';
import { mountYandexForm } from './yandex-form.js';

export function initLeadCapture() {
  const dialog = document.createElement('dialog');
  dialog.id = 'lead-capture-modal';
  dialog.className = 'lead-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'lead-modal-title');
  dialog.setAttribute('aria-describedby', 'lead-modal-description');
  dialog.innerHTML = `
    <div class="lead-modal__surface">
      <div class="lead-modal__header">
        <h2 class="lead-modal__title" id="lead-modal-title"></h2>
        <button class="button button-dark lead-modal__close" type="button"
          aria-label="Закрыть окно" autofocus>×</button>
      </div>
      <p class="lead-modal__description" id="lead-modal-description"></p>
      <div class="lead-modal__form"></div>
    </div>`;
  document.body.append(dialog);

  const closeButton = dialog.querySelector('.lead-modal__close');
  const formContainer = dialog.querySelector('.lead-modal__form');
  let opener;
  let scrollState;
  let pressedBackdrop = false;
  let embeddedForm;

  function open(type, trigger) {
    if (dialog.open) return;
    const config = LEAD_FORMS[type];
    opener = trigger;
    dialog.dataset.formType = type;
    dialog.querySelector('.lead-modal__title').textContent = config.title;
    dialog.querySelector('.lead-modal__description').textContent = config.description;
    embeddedForm = mountYandexForm(formContainer, type);

    // Compensate classic scrollbars without changing the existing page CSS.
    const root = document.documentElement;
    const scrollbar = window.innerWidth - root.clientWidth;
    scrollState = {
      x: window.scrollX,
      y: window.scrollY,
      overflow: root.style.overflow,
      paddingRight: document.body.style.paddingRight,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      width: document.body.style.width,
    };
    if (scrollbar > 0) {
      const padding = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${padding + scrollbar}px`;
    }
    root.style.overflow = 'hidden';
    // Fixed body also locks background scrolling on mobile Safari.
    document.body.style.position = 'fixed';
    document.body.style.top = `${-scrollState.y}px`;
    document.body.style.left = `${-scrollState.x}px`;
    document.body.style.width = '100%';
    dialog.querySelector('.lead-modal__surface').scrollTop = 0;
    dialog.showModal(); // Native modal makes the rest of the page inert.
    embeddedForm.start();
    closeButton.focus({ preventScroll: true });
  }

  function releasePage() {
    if (!scrollState || dialog.open) return;
    const saved = scrollState;
    scrollState = null;
    document.documentElement.style.overflow = saved.overflow;
    document.body.style.paddingRight = saved.paddingRight;
    for (const property of ['position', 'top', 'left', 'width']) document.body.style[property] = saved[property];
    window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    embeddedForm?.destroy();
    embeddedForm = null;
    formContainer.replaceChildren();
    pressedBackdrop = false;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  function close() {
    dialog.close();
    releasePage();
  }

  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', releasePage);

  const outside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener('pointerdown', (event) => {
    pressedBackdrop = event.target === dialog && outside(event);
  });
  dialog.addEventListener('click', (event) => {
    if (pressedBackdrop && event.target === dialog && outside(event)) close();
    pressedBackdrop = false;
  });

  // Native dialog traversal includes the cross-origin iframe's own controls.

  for (const trigger of document.querySelectorAll('[data-form-link]')) {
    const type = { participate: 'participant', partner: 'partner' }[trigger.dataset.formLink];
    if (!type) continue;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.setAttribute('role', 'button');
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      open(type, trigger);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.preventDefault();
        trigger.click();
      }
    });
  }
}
