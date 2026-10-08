export function initNavigation() {
  const header = document.querySelector('.site-header');
  const toggle = header.querySelector('.menu-toggle');
  const navigation = header.querySelector('.navigation');
  const compact = window.matchMedia('(max-width: 1023px)');

  function setOpen(open, restoreFocus = false) {
    header.dataset.menuOpen = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  header.dataset.menuReady = '';
  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false, compact.matches);
  });
  document.addEventListener('click', (event) => {
    if (!header.contains(event.target) || event.target.closest('[data-form-link]')) {
      setOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false, true);
    }
  });
  header.addEventListener('focusout', (event) => {
    if (!header.contains(event.relatedTarget)) setOpen(false);
  });
  compact.addEventListener('change', () => setOpen(false));
}
