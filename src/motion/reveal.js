// Animate a few content groups; headings, decoration and controls stay readable.
const basicSelectors = [
  '.experts-track', '.problem-copy', '.format > .shell',
  '.partners-intro', '.season-goal > div:last-child',
];
const groups = [
  ['.audience-grid', ':scope > article'],
  ['.problem-stats', ':scope > .problem-stat'],
  ['.benefits-grid', ':scope > .benefit-card'],
  ['.partner-cards', ':scope > .partner-card'],
  ['.effects', ':scope > .effect'],
  ['.roadmap-list', ':scope > .roadmap-step'],
];

let cleanup;

export function initScrollReveals() {
  // Repeated initialization must not attach another observer or replay entrances.
  if (cleanup) return cleanup;

  const targets = new Map();
  const pending = new Set();
  const active = new Set();
  let observer;
  let listeners;
  let disposed = false;

  cleanup = () => {
    disposed = true;
    observer?.disconnect();
    listeners?.abort();
    for (const element of targets.keys()) {
      element.classList.remove('motion-reveal', 'reveal-level', 'is-pending', 'is-revealing', 'is-revealed');
      element.style.removeProperty('--reveal-index');
    }
    pending.clear();
    active.clear();
  };

  const finish = (element) => {
    pending.delete(element);
    active.delete(element);
    observer.unobserve(element);
    element.classList.remove('is-pending', 'is-revealing');
    element.classList.add('is-revealed');
    element.style.removeProperty('--reveal-index');
    if (!pending.size && !active.size) {
      observer.disconnect();
      listeners.abort();
    }
  };

  try {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches || document.hidden || !('IntersectionObserver' in window)) return cleanup;

    for (const selector of basicSelectors) {
      for (const element of document.querySelectorAll(selector)) targets.set(element, null);
    }
    for (const [selector, children] of groups) {
      const group = document.querySelector(selector);
      if (!group) continue;
      for (const element of group.querySelectorAll(children)) targets.set(element, group);
    }

    let skipUntil = location.hash || window.scrollY > 0 ? performance.now() + 1200 : 0;
    observer = new IntersectionObserver((entries) => {
      if (disposed) return;
      try {
        const stagger = new Map();
        const entering = entries.filter(entry => pending.has(entry.target) && entry.isIntersecting)
          .sort((a, b) => a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        for (const { target, boundingClientRect } of entering) {
          // A late callback / large scroll should not delay content in the reading area.
          if (boundingClientRect.top < window.innerHeight * .65 || performance.now() < skipUntil
            || target.contains(document.activeElement)) {
            finish(target);
            continue;
          }
          const group = targets.get(target);
          const index = group ? stagger.get(group) || 0 : 0;
          if (group) stagger.set(group, index + 1);
          pending.delete(target);
          observer.unobserve(target);
          active.add(target);
          target.style.setProperty('--reveal-index', Math.min(index, 2));
          target.classList.remove('is-pending');
          target.classList.add('is-revealing');
        }
      } catch {
        cleanup();
      }
    }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });

    listeners = new AbortController();
    const options = { signal: listeners.signal };
    // Fail open on runtime errors as well as initialization/observer exceptions.
    window.addEventListener('error', cleanup, options);
    window.addEventListener('unhandledrejection', cleanup, options);
    reducedMotion.addEventListener('change', cleanup, options);
    window.addEventListener('pagehide', cleanup, options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cleanup();
    }, options);
    const onAnimationComplete = (event) => {
      if (event.animationName === 'content-reveal' && active.has(event.target)) finish(event.target);
    };
    document.addEventListener('animationend', onAnimationComplete, options);
    document.addEventListener('animationcancel', onAnimationComplete, options);
    const revealInteraction = (event) => {
      const element = event.target.closest?.('.motion-reveal');
      if (element && targets.has(element)) finish(element);
    };
    document.addEventListener('focusin', revealInteraction, options);
    document.addEventListener('pointerdown', revealInteraction, options);

    // Let an active entrance finish naturally; do not snap its transform on navigation.
    const revealAnchor = () => { skipUntil = performance.now() + 1200; };
    window.addEventListener('hashchange', revealAnchor, options);
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('a[href^="#"]:not([data-form-link])')) revealAnchor();
    }, options);

    // Read geometry once, before any writes. Never hide content already on screen.
    const belowFold = new Set([...targets.keys()].filter(element =>
      element.getBoundingClientRect().top >= window.innerHeight + 32
      && !element.contains(document.activeElement)));
    for (const element of targets.keys()) {
      element.classList.add('motion-reveal');
      if (element.matches('.roadmap-step')) element.classList.add('reveal-level');
      if (belowFold.has(element)) {
        pending.add(element);
        observer.observe(element);
        element.classList.add('is-pending');
      } else {
        element.classList.add('is-revealed');
      }
    }
  } catch {
    cleanup();
  }

  return cleanup;
}
