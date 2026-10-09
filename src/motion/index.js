import { initHeroMotion } from './hero.js';
import { initScrollReveals } from './reveal.js';

export function initMotion() {
  const disposeHero = initHeroMotion();
  const disposeReveals = initScrollReveals();
  return () => {
    disposeHero();
    disposeReveals();
  };
}
