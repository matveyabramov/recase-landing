// Movement-only cursor pixels are independent from the anchored decorations.
// A bounded pool, cached exclusions and a finite spring/fade keep idle CPU at zero.
let cleanup;
const COUNT = 32;
const LIFE = 480;
const MAX_OFFSET = 18;
const protectedSelector = 'h1,h2,h3,h4,p,li,a,button,input,textarea,label,article,.hero-heading,.card-icon,.hero-computer,.format-computer';

export function initCursorFollow() {
  if (cleanup) return cleanup;
  const eligible = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let layer, pixels = [], listeners, frame = 0, lastTime = 0;
  let pointer = null, lastSpawn = 0, sequence = 0, dirty = true, blockers = [];

  const stop = () => {
    cancelAnimationFrame(frame); frame = 0; lastTime = 0; pointer = null;
    for (const pixel of pixels) { pixel.active = false; pixel.element.hidden = true; }
    dirty = true;
  };
  const measure = () => {
    // One batched read on entry / after scroll, never during animation frames.
    blockers = [...document.querySelectorAll(protectedSelector)].flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || rect.bottom < -60 || rect.top > innerHeight + 60) return [];
      if (!element.matches('h1,h2,h3,h4,p,li,label')) return [rect];
      const range = document.createRange(); range.selectNodeContents(element);
      return [...range.getClientRects()];
    }).filter(r => r.width && r.height).map(r => ({
      left: r.left - 26, right: r.right + 26, top: r.top - 26, bottom: r.bottom + 26,
    }));
    dirty = false;
  };
  const free = (x, y, size) => x > 4 && y > 4 && x + size < innerWidth - 4 && y + size < innerHeight - 4
    && !blockers.some(r => x < r.right && x + size > r.left && y < r.bottom && y + size > r.top);
  const tick = time => {
    frame = 0;
    const dt = Math.min(lastTime ? (time - lastTime) / 1000 : 1 / 60, 1 / 30);
    lastTime = time;
    let active = false;
    for (const pixel of pixels) {
      if (!pixel.active) continue;
      const age = time - pixel.born;
      if (age >= LIFE) { pixel.active = false; pixel.element.hidden = true; continue; }
      active = true;
      const following = pointer && time - pointer.time < 110;
      const dx = following ? pointer.x - pixel.originX : 0, dy = following ? pointer.y - pixel.originY : 0;
      const distance = Math.hypot(dx, dy);
      const force = following ? Math.min(MAX_OFFSET, distance * .35) * Math.max(0, 1 - distance / 140) : 0;
      const tx = distance ? dx / distance * force : 0, ty = distance ? dy / distance * force : 0;
      // Small substeps keep sharp pointer changes stable, carrying velocity.
      const steps = Math.ceil(dt * 120), step = dt / steps;
      for (let i = 0; i < steps; i++) {
        pixel.vx += ((tx - pixel.x) * 320 - pixel.vx * 30) * step;
        pixel.vy += ((ty - pixel.y) * 320 - pixel.vy * 30) * step;
        pixel.x += pixel.vx * step; pixel.y += pixel.vy * step;
      }
      const opacity = Math.min(1, age / 55) * Math.min(1, (LIFE - age) / 270);
      pixel.element.style.opacity = opacity.toFixed(3);
      pixel.element.style.transform = `translate3d(${Math.round(pixel.originX + pixel.x)}px, ${Math.round(pixel.originY + pixel.y)}px, 0)`;
    }
    if (active) frame = requestAnimationFrame(tick);
    else lastTime = 0;
  };
  const move = event => {
    if (event.pointerType !== 'mouse' || document.hidden || !event.target.closest?.('.hero,main') || event.target.closest('[role="dialog"]')) return;
    const time = performance.now();
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < .5) return;
    pointer = { x: event.clientX, y: event.clientY, time };
    if (time - lastSpawn < 24) return;
    lastSpawn = time;
    if (dirty) measure();
    for (let i = 0; i < 4; i++) {
      const pixel = pixels.find(p => !p.active);
      if (!pixel) break;
      const angle = sequence++ * 2.399963;
      const radius = 18 + sequence % 4 * 12;
      const x = Math.round(pointer.x + Math.cos(angle) * radius), y = Math.round(pointer.y + Math.sin(angle) * radius);
      if (!free(x, y, pixel.size)) continue;
      Object.assign(pixel, { active: true, born: time, originX: x, originY: y, x: 0, y: 0, vx: 0, vy: 0 });
      pixel.element.hidden = false; pixel.element.style.opacity = '0';
      pixel.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    if (!frame && pixels.some(p => p.active)) frame = requestAnimationFrame(tick);
  };
  const configure = () => {
    listeners?.abort(); stop(); layer?.remove(); pixels = [];
    if (!eligible.matches) return;
    listeners = new AbortController();
    const options = { signal: listeners.signal, passive: true };
    layer = document.createElement('div'); layer.className = 'cursor-pixels'; layer.setAttribute('aria-hidden', 'true');
    pixels = Array.from({ length: COUNT }, (_, i) => {
      const element = document.createElement('span'), size = [4, 5, 6, 5][i % 4];
      element.style.width = element.style.height = `${size}px`;
      element.style.backgroundColor = ['#E5297A', '#BAFB2B', '#FFF21A'][i % 3];
      element.hidden = true; layer.append(element);
      return { element, size, active: false };
    });
    document.body.append(layer);
    document.addEventListener('pointermove', move, options);
    document.addEventListener('pointerout', event => { if (!event.relatedTarget) stop(); }, options);
    window.addEventListener('scroll', stop, options);
    window.addEventListener('resize', stop, options);
    window.addEventListener('blur', stop, options);
    window.addEventListener('pagehide', stop, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, options);
    // Reveal completion can change protected text positions without a resize.
    document.addEventListener('animationend', () => { dirty = true; }, options);
    document.fonts.ready.then(() => { dirty = true; });
  };
  cleanup = () => { eligible.removeEventListener('change', configure); listeners?.abort(); stop(); layer?.remove(); cleanup = null; };
  eligible.addEventListener('change', configure); configure();
  return cleanup;
}
