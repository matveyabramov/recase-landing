const initializedHeroes = new WeakSet();

export function initHeroMotion() {
  const hero = document.querySelector('.hero');
  const heading = hero?.querySelector('.hero-heading');
  const computer = hero?.querySelector('.hero-computer');
  if (!heading || !computer || initializedHeroes.has(hero)) return () => {};
  initializedHeroes.add(hero);

  let listeners;
  const finish = () => {
    hero.removeAttribute('data-motion');
    listeners?.abort();
  };

  try {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // An anchor/restored scroll or background load should never hide read content.
    if (reducedMotion.matches || document.hidden || window.scrollY > 0) return finish;

    listeners = new AbortController();
    const options = { signal: listeners.signal };
    reducedMotion.addEventListener('change', finish, options);
    window.addEventListener('pagehide', finish, options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) finish();
    }, options);
    const complete = (event) => {
      if (event.target === computer && event.animationName === 'hero-computer-reveal') finish();
    };
    hero.addEventListener('animationend', complete, options);
    hero.addEventListener('animationcancel', finish, options);

    // Register cleanup before opting in. CSS ends visibly even if JS stops later.
    hero.dataset.motion = 'entering';
  } catch {
    finish(); // Unsupported APIs or partial initialization keep the static Hero.
  }

  return finish;
}
