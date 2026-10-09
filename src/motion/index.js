import { initHeroMotion } from './hero.js';
import { initScrollReveals } from './reveal.js';
import { initInteractiveParticles } from './particles.js';
import { initPixelMorph } from './pixel-morph.js';
import { initCursorFollow } from './cursor-follow.js';

export function initMotion() {
  const disposeHero = initHeroMotion();
  const disposeReveals = initScrollReveals();
  const disposeParticles = initInteractiveParticles();
  const disposeMorph = initPixelMorph();
  const disposeCursor = initCursorFollow();
  return () => {
    disposeHero();
    disposeReveals();
    disposeParticles();
    disposeMorph();
    disposeCursor();
  };
}
