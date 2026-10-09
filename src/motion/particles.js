const configs = [
  { selector: '.hero', count: 28, colors: ['#E5297A', '#BAFB2B', '#FFF21A'] },
  { selector: '.audience', count: 12, colors: ['#FFF21A', '#B8F72E'] },
  { selector: '.format', count: 12, colors: ['#B8F72E', '#FFF21A'] },
  { selector: '.participate', count: 12, colors: ['#E5297A', '#FFF21A'] },
  { selector: '.contacts', count: 12, colors: ['#FFF21A', '#E5297A'] },
];
const protectedSelector = 'h1,h2,h3,h4,p,a,button,article,.hero-heading,.hero-computer,.format-computer';
const RADIUS = 140;
const DISPLACEMENT = 20;
const STIFFNESS = 320;
const DAMPING = 30;
let cleanup;

export function initInteractiveParticles() {
  if (cleanup) return cleanup;
  const eligible = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const lifetime = new AbortController();
  let listeners;
  let frame = 0;
  let previousTime = 0;
  const moving = new Set();
  const scenes = configs.flatMap((config, sceneIndex) => {
    const element = document.querySelector(config.selector);
    if (!element) return [];
    const layer = document.createElement('div');
    layer.className = 'motion-particles';
    layer.setAttribute('aria-hidden', 'true');
    const added = Array.from({ length: config.count }, (_, i) => {
      const pixel = document.createElement('span');
      const size = [6, 8, 10, 8, 12][i % 5];
      pixel.style.width = pixel.style.height = `${size}px`;
      pixel.style.background = config.colors[i % config.colors.length];
      pixel.dataset.addedParticle = '';
      layer.append(pixel);
      return { element: pixel, size, added: true, visible: false };
    });
    const existing = [...element.querySelectorAll('.particles > span,[data-hero-particle]')].map(pixel => {
      const svg = pixel.ownerSVGElement;
      const box = svg ? pixel.getBBox() : null;
      return { element: pixel, svg, origin: box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null };
    });
    const particles = [...existing, ...added].map(pixel => ({
      ...pixel, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, paintedX: 0, paintedY: 0, scale: 1,
    }));
    element.append(layer);
    return [{ element, layer, config, sceneIndex, particles, visible: false, dirty: true }];
  });

  const paint = pixel => {
    const x = Math.round(pixel.x);
    const y = Math.round(pixel.y);
    if (x === pixel.paintedX && y === pixel.paintedY) return;
    pixel.paintedX = x; pixel.paintedY = y;
    if (!x && !y) pixel.element.style.removeProperty('transform');
    else pixel.element.style.transform = `translate3d(${x / pixel.scale}px, ${y / pixel.scale}px, 0)`;
  };
  const reset = scene => {
    moving.delete(scene);
    for (const pixel of scene.particles) {
      pixel.x = pixel.y = pixel.vx = pixel.vy = pixel.tx = pixel.ty = 0;
      paint(pixel);
    }
  };
  const stop = () => {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    for (const scene of scenes) { reset(scene); scene.dirty = true; }
  };
  const measureCenters = scene => {
    const svgRects = new Map();
    const rect = scene.layer.getBoundingClientRect();
    for (const pixel of scene.particles) {
      if (pixel.added) {
        pixel.centerX = rect.left + pixel.left + pixel.size / 2;
        pixel.centerY = rect.top + pixel.top + pixel.size / 2;
      } else if (pixel.svg) {
        if (!svgRects.has(pixel.svg)) svgRects.set(pixel.svg, pixel.svg.getBoundingClientRect());
        const r = svgRects.get(pixel.svg);
        pixel.scale = r.width / pixel.svg.viewBox.baseVal.width;
        pixel.centerX = r.left + pixel.origin.x * pixel.scale;
        pixel.centerY = r.top + pixel.origin.y * pixel.scale;
        pixel.visible = r.width > 0;
      } else {
        const r = pixel.element.getBoundingClientRect();
        pixel.centerX = r.left + r.width / 2;
        pixel.centerY = r.top + r.height / 2;
        pixel.visible = r.width > 0;
      }
    }
    scene.dirty = false;
  };

  const layout = () => {
    stop();
    // Batch source geometry reads before placing pooled pixels. No layout
    // measurements occur in tick; placement changes only on init/font/resize.
    const measurements = scenes.map(scene => {
      const rect = scene.layer.getBoundingClientRect();
      const padding = scene.config.selector === '.hero' ? 30 : 42;
      const blockers = [...scene.element.querySelectorAll(protectedSelector)].flatMap(element => {
        if (!element.matches('h1,h2,h3,h4,p')) return [element.getBoundingClientRect()];
        const range = document.createRange(); range.selectNodeContents(element);
        return [...range.getClientRects()];
      }).filter(r => r.width && r.height).map(r => ({
        left: r.left - rect.left - padding, right: r.right - rect.left + padding,
        top: r.top - rect.top - padding, bottom: r.bottom - rect.top + padding,
      }));
      // Do not duplicate colored SVG decor or pixels inside the computer PNG.
      const artwork = scene.config.selector === '.hero'
        ? [...scene.element.querySelectorAll('.hero-particle-art path')].filter(path => {
          const colors = path.getAttribute('fill').match(/\d+/g).map(Number);
          return Math.max(...colors) - Math.min(...colors) > 60;
        }) : [];
      for (const element of [...scene.particles.filter(p => !p.added).map(p => p.element), ...artwork]) {
        const r = element.getBoundingClientRect();
        if (r.width && r.height) blockers.push({
          left: r.left - rect.left - 24, right: r.right - rect.left + 24,
          top: r.top - rect.top - 24, bottom: r.bottom - rect.top + 24,
        });
      }
      return { rect, blockers };
    });
    scenes.forEach((scene, sceneIndex) => {
      const { rect, blockers } = measurements[sceneIndex];
      const count = innerWidth >= 1024 ? scene.config.count : Math.ceil(scene.config.count / (innerWidth > 600 ? 2 : 3));
      const candidates = Array.from({ length: 24 * 18 }, (_, i) => ({
        x: ((i % 24) + .5 + .18 * Math.sin(i * 2.4)) / 24 * rect.width,
        y: (Math.floor(i / 24) + .5 + .18 * Math.cos(i * 1.7)) / 18 * rect.height,
        order: Math.imul(i + scene.sceneIndex * 29, 2654435761) >>> 0,
      })).sort((a, b) => a.order - b.order);
      let placed = 0;
      for (const pixel of scene.particles.filter(p => p.added)) {
        const margin = scene.config.selector === '.hero' ? 12 : 42;
        const candidate = placed < count && candidates.find(p =>
          p.x >= margin && p.y >= margin && p.x + pixel.size <= rect.width - margin && p.y + pixel.size <= rect.height - margin
          && !blockers.some(r => p.x < r.right && p.x + pixel.size > r.left && p.y < r.bottom && p.y + pixel.size > r.top));
        pixel.visible = Boolean(candidate);
        pixel.element.hidden = !candidate;
        if (!candidate) continue;
        pixel.left = Math.round(candidate.x); pixel.top = Math.round(candidate.y);
        pixel.element.style.left = `${pixel.left}px`; pixel.element.style.top = `${pixel.top}px`;
        blockers.push({ left: pixel.left - 24, right: pixel.left + pixel.size + 24, top: pixel.top - 24, bottom: pixel.top + pixel.size + 24 });
        placed++;
      }
      scene.element.dataset.particleCount = String(placed);
    });
    for (const scene of scenes) measureCenters(scene);
  };

  const tick = time => {
    frame = 0;
    if (document.hidden) return stop();
    const elapsed = previousTime ? Math.min((time - previousTime) / 1000, 1 / 30) : 1 / 60;
    previousTime = time;
    const steps = Math.ceil(elapsed / (1 / 120));
    const dt = elapsed / steps;
    for (const scene of moving) {
      let unsettled = false;
      for (const pixel of scene.particles) {
        if (!pixel.visible) continue;
        for (let i = 0; i < steps; i++) {
          pixel.vx += ((pixel.tx - pixel.x) * STIFFNESS - pixel.vx * DAMPING) * dt;
          pixel.vy += ((pixel.ty - pixel.y) * STIFFNESS - pixel.vy * DAMPING) * dt;
          pixel.x += pixel.vx * dt; pixel.y += pixel.vy * dt;
        }
        if (Math.abs(pixel.x - pixel.tx) < .04 && Math.abs(pixel.y - pixel.ty) < .04 && Math.hypot(pixel.vx, pixel.vy) < .2) {
          pixel.x = pixel.tx; pixel.y = pixel.ty; pixel.vx = pixel.vy = 0;
        } else unsettled = true;
        paint(pixel);
      }
      if (!unsettled) moving.delete(scene);
    }
    if (moving.size) frame = requestAnimationFrame(tick);
    else previousTime = 0;
  };
  const wake = scene => {
    moving.add(scene);
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const configure = () => {
    listeners?.abort(); stop();
    if (!eligible.matches) return;
    listeners = new AbortController();
    const options = { signal: listeners.signal, passive: true };
    for (const scene of scenes) {
      scene.element.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || !scene.visible || document.hidden) return;
        if (scene.dirty) measureCenters(scene);
        const nearest = scene.particles.filter(p => p.visible).map(pixel => ({
          pixel, dx: event.clientX - pixel.centerX, dy: event.clientY - pixel.centerY,
        })).map(p => ({ ...p, distance: Math.hypot(p.dx, p.dy) })).filter(p => p.distance < RADIUS).sort((a, b) => a.distance - b.distance).slice(0, 8);
        const targets = new Map(nearest.map(p => [p.pixel, p]));
        let changed = false;
        for (const pixel of scene.particles) {
          const next = targets.get(pixel);
          const proximity = next ? 1 - next.distance / RADIUS : 0;
          // Attraction falls to zero at the cursor center: no overshoot or
          // direction discontinuity when the pointer passes through a pixel.
          const force = Math.min(DISPLACEMENT * proximity ** 2 * (3 - 2 * proximity), next ? next.distance * .35 : 0);
          const tx = next?.distance > .01 ? next.dx / next.distance * force : 0;
          const ty = next?.distance > .01 ? next.dy / next.distance * force : 0;
          changed ||= Math.abs(pixel.tx - tx) > .001 || Math.abs(pixel.ty - ty) > .001;
          pixel.tx = tx; pixel.ty = ty;
        }
        if (changed) wake(scene);
      }, options);
      scene.element.addEventListener('pointerleave', () => {
        if (!scene.particles.some(p => p.x || p.y || p.tx || p.ty)) return;
        for (const pixel of scene.particles) pixel.tx = pixel.ty = 0;
        wake(scene);
      }, options);
    }
  };
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const scene = scenes.find(s => s.element === entry.target);
      scene.visible = entry.isIntersecting;
      if (!scene.visible) reset(scene);
    }
    if (!moving.size) { cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
  });
  const resize = new ResizeObserver(layout);
  for (const scene of scenes) { intersection.observe(scene.element); resize.observe(scene.element); }
  const options = { signal: lifetime.signal, passive: true };
  window.addEventListener('scroll', stop, options);
  window.addEventListener('blur', stop, options);
  window.addEventListener('pagehide', stop, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, options);
  eligible.addEventListener('change', configure);
  document.fonts.ready.then(() => { if (!lifetime.signal.aborted) layout(); });
  layout(); configure();
  cleanup = () => {
    listeners?.abort(); lifetime.abort(); intersection.disconnect(); resize.disconnect();
    eligible.removeEventListener('change', configure); stop();
    for (const scene of scenes) { scene.layer.remove(); scene.element.removeAttribute('data-particle-count'); }
    cleanup = null;
  };
  return cleanup;
}
