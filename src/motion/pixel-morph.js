const NS = 'http://www.w3.org/2000/svg';
const sources = new Map();
const surfaces = [
  { trigger: '.audience', art: '.pixel-background', asset: 'audience-mask', type: 'mask' },
  { trigger: '.format', art: '.pixel-background', asset: 'format-mask', type: 'mask' },
  { trigger: '.participate', art: '.pixel-background', asset: 'participate-mask', type: 'mask' },
  { trigger: '.contacts', art: '.pixel-background', asset: 'contacts-mask', type: 'mask' },
  { trigger: '.hero-heading', art: '.hero-pixel-underlay', asset: 'hero-title-shape', type: 'image' },
  { trigger: '.stat-cloud-resumes', asset: 'resumes-shape', type: 'background' },
  { trigger: '.stat-cloud-growth', asset: 'growth-shape', type: 'background' },
  { trigger: '.registration', art: '.registration-border img', asset: 'registration-frame', type: 'image' },
  { trigger: '.championship', art: '.championship-background', asset: 'championship-shape', type: 'background' },
  { trigger: '.defence', art: '.defence-background', asset: 'defence-shape', type: 'background' },
  { trigger: '.effect-teams', art: '.effect-border img', asset: 'teams-frame', type: 'image' },
  { trigger: '.effect-solutions', art: '.effect-border img', asset: 'solutions-frame', type: 'image' },
  { trigger: '.effect-weeks', art: '.effect-border img', asset: 'weeks-frame', type: 'image' },
  { trigger: '.season-goal', art: '.season-goal-background', asset: 'season-goal-shape', type: 'background' },
  { trigger: '.partners', art: '.idea-sticker', asset: 'idea-sticker', type: 'image' },
  { trigger: '.partner-process-row', art: '.team-sticker', asset: 'team-sticker', type: 'image' },
  { trigger: '.process-strip', asset: 'process-decoration', type: 'ribbon' },
  { trigger: '.partner-banner', asset: 'banner-decoration', type: 'ribbon', externalDecoration: true },
];
let cleanup;
const usesBackground = config => config.type === 'background' || config.type === 'ribbon';

// Ribbons already combine a rectangular fill with pixel cutouts. Split each
// straight edge into paired vertices: default remains the exact rectangle;
// hover introduces small notches on all four sides, behind the live content.
function ribbonGeometry(width, height) {
  const points = [{ x: 0, y: 0, move: true }];
  const targetPoints = [{ x: 0, y: 0, move: true }];
  const edges = [
    { length: width, point: (t, depth) => ({ x: t, y: depth }) },
    { length: height, point: (t, depth) => ({ x: width - depth, y: t }) },
    { length: width, point: (t, depth) => ({ x: width - t, y: height - depth }) },
    { length: height, point: (t, depth) => ({ x: depth, y: height - t }) },
  ];
  for (const edge of edges) {
    const count = Math.max(2, Math.floor(edge.length / 70));
    for (let i = 0; i < count; i++) {
      const a = (i + .24) / count * edge.length;
      const b = (i + .58) / count * edge.length;
      for (const [t, depth] of [[a, 0], [a, 10], [b, 10], [b, 0]]) {
        points.push(edge.point(t, 0)); targetPoints.push(edge.point(t, depth));
      }
    }
    points.push(edge.point(edge.length, 0)); targetPoints.push(edge.point(edge.length, 0));
  }
  points.push({ close: true }); targetPoints.push({ close: true });
  return { points, targetPoints };
}

const pathString = points => points.map(point => point.close ? 'Z' : `${point.move ? 'M' : 'L'}${point.x} ${point.y}`).join('');

// These assets contain straight M/L/H/V contours. Normalize commands once;
// inner loops keep their winding, so framed shapes retain transparent centers.
function vertices(path) {
  const tokens = path.match(/[MLHVZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  const points = [];
  let command;
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length;) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++].toUpperCase();
    if (command === 'Z') { points.push({ close: true }); command = null; continue; }
    if (command === 'M' || command === 'L') {
      x = Number(tokens[i++]); y = Number(tokens[i++]);
      points.push({ x, y, move: command === 'M' });
      command = 'L';
    } else if (command === 'H') { x = Number(tokens[i++]); points.push({ x, y }); }
    else if (command === 'V') { y = Number(tokens[i++]); points.push({ x, y }); }
    else throw new Error('Unsupported pixel contour');
  }
  return points;
}

// Expand straight runs into paired vertices. Resting vertices are collinear;
// hover creates NEW rectangular teeth locally instead of warping the axes.
// Frame loops share notches: the inner opening is inset at each new corner,
// keeping the outline connected even when the tooth is deeper than the border.
function toothGeometry(source, sx, sy, config) {
  const angled = config.asset === 'idea-sticker' || config.asset === 'team-sticker';
  if (angled) {
    const a = source.find(p => !p.close), b = source.find(p => !p.close && Math.hypot(p.x - a.x, p.y - a.y) > 25);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(angle), s = Math.sin(angle);
    const local = source.map(p => p.close ? p : ({ ...p, x: +(p.x * c + p.y * s).toFixed(1), y: +(-p.x * s + p.y * c).toFixed(1) }));
    // Export rounding gives a small tolerance on local orthogonal coordinates.
    const geometry = toothGeometry(local, sx, sy, { ...config, asset: 'local-sticker' });
    for (const list of [geometry.points, geometry.targetPoints]) for (const p of list) if (!p.close) {
      const x = p.x; p.x = x * c - p.y * s; p.y = x * s + p.y * c;
    }
    return geometry;
  }
  const loops = [];
  for (const point of source) {
    if (point.move) loops.push([]);
    if (!point.close) loops.at(-1).push(point);
  }
  const edges = loops.flatMap((loop, loopIndex) => {
    const area = loop.reduce((sum, p, i) => {
      const q = loop[(i + 1) % loop.length]; return sum + p.x * q.y - q.x * p.y;
    }, 0);
    return loop.map((a, i) => {
      const b = loop[(i + 1) % loop.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx * sx, dy * sy);
      const horizontal = Math.abs(dy) < .15, vertical = Math.abs(dx) < .15;
      return { a, b, loopIndex, length, horizontal, vertical, cuts: [],
        normal: area > 0 ? { x: dy / Math.hypot(dx, dy), y: -dx / Math.hypot(dx, dy) }
          : { x: -dy / Math.hypot(dx, dy), y: dx / Math.hypot(dx, dy) } };
    });
  });
  const depth = config.type === 'mask' ? 14 : config.asset === 'hero-title-shape' ? 7 : 10;
  const framed = loops.length > 1;
  const add = (edge, lo, hi, delta) => {
    const axis = edge.horizontal ? 'x' : 'y';
    const length = edge.b[axis] - edge.a[axis];
    edge.cuts.push({ a: (lo - edge.a[axis]) / length, b: (hi - edge.a[axis]) / length, delta });
  };
  edges.forEach((edge, edgeIndex) => {
    if (framed && edge.loopIndex !== 0) return;
    if (!edge.horizontal && !edge.vertical) return;
    const axis = edge.horizontal ? 'x' : 'y';
    const cross = edge.horizontal ? 'y' : 'x';
    const alongScale = edge.horizontal ? sx : sy, crossScale = edge.horizontal ? sy : sx;
    let lo = Math.min(edge.a[axis], edge.b[axis]), hi = Math.max(edge.a[axis], edge.b[axis]);
    let inner, gap = 0;
    if (framed) {
      inner = edges.filter(e => e.loopIndex !== 0 && e.horizontal === edge.horizontal && e.vertical === edge.vertical)
        .filter(e => Math.min(hi, Math.max(e.a[axis], e.b[axis])) - Math.max(lo, Math.min(e.a[axis], e.b[axis])) > 20 / alongScale)
        .sort((a, b) => Math.abs(a.a[cross] - edge.a[cross]) - Math.abs(b.a[cross] - edge.a[cross]))[0];
      if (!inner) return;
      gap = Math.abs(inner.a[cross] - edge.a[cross]) * crossScale;
      if (gap > 26 || gap < .5) return;
      lo = Math.max(lo, Math.min(inner.a[axis], inner.b[axis]));
      hi = Math.min(hi, Math.max(inner.a[axis], inner.b[axis]));
    }
    const margin = (depth + gap + 3) / alongScale;
    lo += margin; hi -= margin;
    const available = (hi - lo) * alongScale;
    if (available < (framed ? 2 * gap + 12 : 10)) return;
    const count = Math.max(1, Math.floor(available / 70));
    for (let i = 0; i < count; i++) {
      const cell = (hi - lo) / count;
      const span = Math.min(cell * (framed ? 1 : .62), (framed ? 2 * gap + 18 : 26) / alongScale);
      const start = lo + cell * (i + .5) - span / 2, end = start + span;
      const direction = config.type === 'mask' ? -1 : 1;
      const amplitude = depth * (edgeIndex % 3 === 0 ? 1 : .8) * direction;
      const delta = { x: edge.normal.x * amplitude / sx, y: edge.normal.y * amplitude / sy };
      add(edge, start, end, delta);
      if (inner) add(inner, start + gap / alongScale, end - gap / alongScale, delta);
    }
  });
  const points = [], targetPoints = [];
  for (const [edgeIndex, edge] of edges.entries()) {
    const first = !points.length || edge.a.move;
    points.push({ ...edge.a, move: first }); targetPoints.push({ ...edge.a, move: first });
    for (const cut of edge.cuts.sort((a, b) => Math.min(a.a, a.b) - Math.min(b.a, b.b))) {
      const lo = Math.min(cut.a, cut.b), hi = Math.max(cut.a, cut.b);
      for (const [t, displaced] of [[lo, false], [lo, true], [hi, true], [hi, false]]) {
        const point = { x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t };
        points.push(point); targetPoints.push({ x: point.x + (displaced ? cut.delta.x : 0), y: point.y + (displaced ? cut.delta.y : 0) });
      }
    }
    const next = edges[edgeIndex + 1];
    if (!next || next.loopIndex !== edge.loopIndex) { points.push({ close: true }); targetPoints.push({ close: true }); }
  }
  return { points, targetPoints };
}

// The established UI cubic-bezier(.2,.7,.2,1), evaluated without a library.
function ease(progress) {
  let t = progress;
  for (let i = 0; i < 5; i++) {
    const x = 3 * (1 - t) ** 2 * t * .2 + 3 * (1 - t) * t ** 2 * .2 + t ** 3;
    const slope = .6 * (1 - t) ** 2 + 2.4 * t ** 2;
    t = Math.max(0, Math.min(1, t - (x - progress) / Math.max(.001, slope)));
  }
  return 3 * (1 - t) ** 2 * t * .7 + 3 * (1 - t) * t ** 2 + t ** 3;
}

function load(asset) {
  if (!sources.has(asset)) sources.set(asset,
    fetch(`${import.meta.env.BASE_URL}assets/icons/${asset}.svg`).then(response => {
      if (!response.ok) throw new Error('Pixel artwork unavailable');
      return response.text();
    }));
  return sources.get(asset);
}

export function initPixelMorph() {
  if (cleanup) return cleanup;
  const eligible = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let generation = 0;
  let listeners;
  let intersection;
  let resize;
  let scenes = [];
  let frame = 0;
  let hoverFrame = 0;
  let pointer = null;
  const moving = new Set();

  const restore = scene => {
    scene.svg.hidden = true;
    scene.svg.style.display = 'none';
    scene.path.setAttribute('d', scene.defaultPath);
    scene.painted = null;
    if (usesBackground(scene.config)) {
      scene.art.style.backgroundImage = scene.original;
      if (scene.config.type === 'ribbon') scene.art.style.backgroundColor = scene.backgroundColor;
    }
    else scene.art.style.visibility = scene.original;
    scene.trigger.removeAttribute('data-pixel-morph');
  };
  const reset = scene => {
    moving.delete(scene);
    scene.value = scene.target = 0;
    restore(scene);
  };

  const measure = scene => {
    const { art, svg, config } = scene;
    const css = getComputedStyle(art);
    const rect = art.getBoundingClientRect();
    const width = css.transform === 'none' ? rect.width : parseFloat(css.width);
    const height = css.transform === 'none' ? rect.height : parseFloat(css.height);
    Object.assign(svg.style, {
      position: 'absolute', width: `${width}px`, height: `${height}px`,
      left: css.position === 'absolute' ? css.left : `${art.offsetLeft}px`,
      top: css.position === 'absolute' ? css.top : `${art.offsetTop}px`,
      transform: css.transform, transformOrigin: css.transformOrigin,
      borderRadius: css.borderRadius, zIndex: css.zIndex,
    });
    if (usesBackground(config)) Object.assign(svg.style, { left: '0', top: '0', zIndex: '-1' });
    if (config.type === 'ribbon') {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      scene.sx = scene.sy = 1;
      const geometry = ribbonGeometry(width, height);
      scene.points = geometry.points; scene.targetPoints = geometry.targetPoints;
      scene.defaultPath = pathString(scene.points);
      scene.path.setAttribute('d', scene.defaultPath);
      scene.path.setAttribute('fill', css.backgroundColor);
      const artWidth = Math.min(width, 1512);
      scene.decor?.setAttribute('transform', `translate(${(width - artWidth) / 2} 0) scale(${artWidth / scene.width})`);
      scene.dirty = false;
      return;
    }
    let sx = width / scene.width;
    let sy = height / scene.height;
    if (svg.getAttribute('preserveAspectRatio') !== 'none') sx = sy = Math.min(sx, sy);
    scene.sx = sx; scene.sy = sy;
    const geometry = toothGeometry(scene.sourcePoints, sx, sy, config);
    scene.points = geometry.points; scene.targetPoints = geometry.targetPoints;
    if (config.type === 'mask') scene.path.setAttribute('fill', css.backgroundColor);
    scene.dirty = false;
  };

  const paint = scene => {
    // Quantize displacement in screen pixels, retaining the source artwork's
    // base grid. Text is outside this SVG and never participates in the morph.
    const d = scene.points.map((point, i) => {
      if (point.close) return 'Z';
      const target = scene.targetPoints[i];
      const dx = Math.round((target.x - point.x) * scene.value * scene.sx);
      const dy = Math.round((target.y - point.y) * scene.value * scene.sy);
      const x = point.x + dx / scene.sx;
      const y = point.y + dy / scene.sy;
      return `${point.move ? 'M' : 'L'}${+x.toFixed(4)} ${+y.toFixed(4)}`;
    }).join('');
    if (d !== scene.painted) { scene.path.setAttribute('d', d); scene.painted = d; }
  };
  const tick = time => {
    frame = 0;
    for (const scene of moving) {
      const progress = Math.min(1, (time - scene.start) / 280);
      scene.value = scene.from + (scene.target - scene.from) * ease(progress);
      paint(scene);
      if (progress === 1) {
        moving.delete(scene);
        if (!scene.target) restore(scene);
      }
    }
    if (moving.size) frame = requestAnimationFrame(tick);
  };
  const setTarget = (scene, target) => {
    if (!scene.visible || document.hidden) return;
    if (target === scene.target) return;
    if (scene.dirty) measure(scene);
    scene.svg.hidden = false;
    scene.svg.style.display = 'block';
    if (usesBackground(scene.config)) {
      scene.art.style.backgroundImage = 'none';
      if (scene.config.type === 'ribbon') scene.art.style.backgroundColor = 'transparent';
    }
    else scene.art.style.visibility = 'hidden';
    scene.trigger.dataset.pixelMorph = target ? 'hover' : 'return';
    scene.from = scene.value; scene.target = target; scene.start = performance.now();
    moving.add(scene);
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame); cancelAnimationFrame(hoverFrame); frame = hoverFrame = 0;
    for (const scene of scenes) { reset(scene); scene.dirty = true; }
  };
  const reconcileHover = () => {
    hoverFrame = 0;
    const hit = pointer && !document.hidden ? document.elementFromPoint(pointer.x, pointer.y) : null;
    for (const scene of scenes) setTarget(scene, Number(Boolean(hit && scene.trigger.contains(hit))));
  };
  const scheduleHover = () => {
    if (!hoverFrame) hoverFrame = requestAnimationFrame(reconcileHover);
  };
  const clearPointer = () => { pointer = null; stop(); };
  const invalidate = () => { stop(); scheduleHover(); };
  const suspend = () => {
    generation++;
    listeners?.abort(); intersection?.disconnect(); resize?.disconnect();
    stop();
    for (const scene of scenes) {
      scene.svg.remove();
      if (usesBackground(scene.config)) scene.art.style.isolation = scene.isolation;
    }
    scenes = [];
  };
  const configure = async () => {
    suspend(); pointer = null;
    if (!eligible.matches) return;
    const current = generation;
    const loaded = await Promise.allSettled(surfaces.map(config => load(config.asset)));
    if (current !== generation) return;
    listeners = new AbortController();
    const options = { signal: listeners.signal, passive: true };
    scenes = surfaces.flatMap((config, i) => {
      const trigger = document.querySelector(config.trigger);
      const art = config.art ? trigger?.querySelector(config.art) : trigger;
      if (!art || loaded[i].status !== 'fulfilled') return [];
      const svg = new DOMParser().parseFromString(loaded[i].value, 'image/svg+xml').documentElement;
      let decor;
      if (config.type === 'ribbon') {
        svg.style.overflow = 'hidden'; // Background images were clipped to this box.
        if (config.externalDecoration) svg.replaceChildren();
        else {
          decor = document.createElementNS(NS, 'g');
          decor.append(...svg.childNodes); svg.append(decor);
        }
        const outline = document.createElementNS(NS, 'path');
        outline.setAttribute('d', 'M0 0L1512 0L1512 90L0 90Z');
        svg.prepend(outline);
      }
      const path = svg.querySelector('path');
      const defaultPath = path.getAttribute('d');
      const points = vertices(defaultPath);
      const viewBox = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      // Prefix referenced IDs for artwork with masks (e.g. stickers).
      for (const node of svg.querySelectorAll('[id]')) {
        const id = node.id;
        const replacement = `morph-${i}-${id}`;
        node.id = replacement;
        for (const element of svg.querySelectorAll('*')) for (const attribute of [...element.attributes])
          if (attribute.value.includes(`url(#${id})`)) element.setAttribute(attribute.name, attribute.value.replaceAll(`url(#${id})`, `url(#${replacement})`));
      }
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.classList.add('pixel-morph-art');
      svg.dataset.morphAsset = config.asset;
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.style.display = 'none';
      const scene = { config, trigger, art, svg, path, points, sourcePoints: points, defaultPath,
        width: viewBox[2], height: viewBox[3], value: 0, target: 0,
        visible: false, dirty: true, original: usesBackground(config) ? art.style.backgroundImage : art.style.visibility,
        isolation: art.style.isolation, backgroundColor: art.style.backgroundColor, decor,
      };
      if (usesBackground(config)) { art.style.isolation = 'isolate'; art.prepend(svg); }
      else art.after(svg);
      return [scene];
    });
    intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const scene = scenes.find(s => s.trigger === entry.target);
        scene.visible = entry.isIntersecting;
        if (!scene.visible) reset(scene);
      }
      if (!moving.size) { cancelAnimationFrame(frame); frame = 0; }
      scheduleHover();
    });
    resize = new ResizeObserver(invalidate);
    for (const scene of scenes) { intersection.observe(scene.trigger); resize.observe(scene.art); }
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      scheduleHover();
    }, options);
    document.addEventListener('pointerout', event => { if (!event.relatedTarget) clearPointer(); }, options);
    window.addEventListener('scroll', scheduleHover, options);
    window.addEventListener('resize', invalidate, options);
    window.addEventListener('blur', clearPointer, options);
    window.addEventListener('pagehide', clearPointer, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearPointer(); }, options);
  };
  cleanup = () => { eligible.removeEventListener('change', configure); suspend(); cleanup = null; };
  eligible.addEventListener('change', configure);
  configure();
  return cleanup;
}
