import type { OverlayOptions } from "./types.ts";

/** Pure seeded geometry, serialized unchanged into the trusted browser program. */
export function createBokehGeometry(width: number, height: number, options: OverlayOptions["Bokeh"], random: () => number) {
  const pieces = [];
  for (let index = 0; index < Math.max(1, Math.round(options.amount * 48)); index++) {
    pieces.push({
      x: random() * width,
      y: random() * height,
      radius: (options["min-size"] + random() * (options["max-size"] - options["min-size"])) / 2,
      alpha: 0.1 + random() * 0.35,
      velocity: random() * 2 - 1,
    });
  }
  return pieces;
}

/** Trusted browser code. Layout is seeded once; every seek clears and redraws from the local frame alone. */
export const OVERLAY_SETUP = String.raw`
const canvas = root.querySelector('canvas');
if (!canvas) throw new Error('Overlay canvas is missing');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Overlay requires a 2D canvas');
const w = data.width, h = data.height, o = data.options, kind = data.kind;
canvas.width = w; canvas.height = h;
const diagonal = Math.hypot(w, h);
let seed = 2166136261;
for (const char of String(o.seed === undefined ? 0 : o.seed)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
function random() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ seed >>> 15, seed | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const pieces = [];
if (kind === 'GlitchVeil') for (let i = 0; i < o.bars; i++) pieces.push({
  y: random() * h, height: Math.max(1, h * (0.005 + random() * 0.06)),
  x: random() * w, width: w * (0.15 + random() * 0.85),
  alpha: 0.25 + random() * 0.75, velocity: random() * 2 - 1,
  color: o.colors[Math.floor(random() * o.colors.length)]
});
if (kind === 'Bokeh') pieces.push(...(${createBokehGeometry.toString()})(w, h, o, random));
if (kind === 'LightLeak') for (const color of o.colors) pieces.push({
  x: random() * w, y: random() * h, radius: diagonal * (0.2 + random() * 0.3),
  angle: (o.angle + (random() * 2 - 1) * 20) * Math.PI / 180, color
});
let texture;
if (kind === 'Grain' || kind === 'TVStatic') {
  // A bounded, repeating grid retains the author's exact cell size even on large canvases.
  const tile = document.createElement('canvas'); tile.width = 128; tile.height = 128;
  const t = tile.getContext('2d');
  if (!t) throw new Error('Overlay noise requires a 2D canvas');
  const image = t.createImageData(128, 128);
  for (let i = 0; i < image.data.length; i += 4) {
    const grey = Math.floor(random() * 256);
    image.data[i] = grey;
    image.data[i + 1] = kind === 'Grain' && o.chroma === 'color' ? Math.floor(random() * 256) : grey;
    image.data[i + 2] = kind === 'Grain' && o.chroma === 'color' ? Math.floor(random() * 256) : grey;
    image.data[i + 3] = Math.floor(random() * 256 * o.amount);
  }
  t.putImageData(image, 0, 0); texture = ctx.createPattern(tile, 'repeat');
  if (!texture) throw new Error('Overlay noise pattern could not be created');
}
let lines;
if (kind === 'ScanLines') {
  const tile = document.createElement('canvas'); tile.width = 1; tile.height = 256;
  const t = tile.getContext('2d');
  if (!t) throw new Error('Overlay scan lines require a 2D canvas');
  t.fillStyle = '#ffffff'; t.fillRect(0, 0, 1, 256 * o.thickness / o.spacing);
  lines = ctx.createPattern(tile, 'repeat');
  if (!lines) throw new Error('Overlay scan pattern could not be created');
}
let staticLines;
if (kind === 'TVStatic' && o['scan-lines'] > 0) {
  const tile = document.createElement('canvas'); tile.width = 1; tile.height = 4;
  const t = tile.getContext('2d');
  if (!t) throw new Error('Overlay static scan lines require a 2D canvas');
  t.fillStyle = '#000000'; t.fillRect(0, 0, 1, 1);
  staticLines = ctx.createPattern(tile, 'repeat');
  if (!staticLines) throw new Error('Overlay static scan pattern could not be created');
}
function modulo(value, range) { return ((value % range) + range) % range; }
return function draw(frame) {
  const p = data.frames <= 1 ? 0 : Math.max(0, Math.min(1, frame / (data.frames - 1)));
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.save();
  if (kind === 'Flash' || kind === 'ColorWash') {
    let alpha = o.opacity;
    if (kind === 'Flash') {
      const duration = o.attack + o.hold + o.decay;
      let envelope = duration === 0 ? 1 : frame < o.attack ? frame / o.attack : frame < o.attack + o.hold ? 1 : o.decay > 0 ? Math.max(0, 1 - (frame - o.attack - o.hold) / o.decay) : 0;
      alpha = o.intensity * envelope;
    }
    ctx.globalAlpha = alpha; ctx.fillStyle = o.color; ctx.fillRect(0, 0, w, h);
  } else if (kind === 'Vignette') {
    ctx.translate(o['center-x'] * w, o['center-y'] * h);
    ctx.scale(o['radius-x'] * w, o['radius-y'] * h);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, '#00000000');
    gradient.addColorStop(Math.max(0, 1 - o.softness), '#00000000');
    gradient.addColorStop(1, o.color);
    ctx.fillStyle = gradient; ctx.globalAlpha = o.opacity;
    ctx.fillRect(-o['center-x'] / o['radius-x'], -o['center-y'] / o['radius-y'], 1 / o['radius-x'], 1 / o['radius-y']);
  } else if (kind === 'ScanLines') {
    ctx.translate(w / 2, h / 2); ctx.rotate(o.angle * Math.PI / 180);
    ctx.translate(0, p * o.travel); ctx.globalAlpha = o.opacity;
    lines.setTransform(new DOMMatrix().scale(1, o.spacing / 256));
    ctx.fillStyle = lines; ctx.fillRect(-diagonal - Math.abs(o.travel), -diagonal - Math.abs(o.travel), 2 * (diagonal + Math.abs(o.travel)), 2 * (diagonal + Math.abs(o.travel)));
  } else if (kind === 'DirectionalMatte') {
    ctx.translate(w / 2, h / 2); ctx.rotate(o.angle * Math.PI / 180);
    const center = ((o.from + (o.to - o.from) * p) - 0.5) * diagonal;
    const width = o.coverage * diagonal, feather = o.feather * diagonal;
    ctx.globalAlpha = o.opacity;
    if (width > 0) {
      if (feather === 0) { ctx.fillStyle = o.color; ctx.fillRect(center - width / 2, -diagonal, width, diagonal * 2); }
      else {
        const half = width / 2 + feather;
        const gradient = ctx.createLinearGradient(center - half, 0, center + half, 0);
        gradient.addColorStop(0, '#00000000'); gradient.addColorStop(feather / (2 * half), o.color);
        gradient.addColorStop(1 - feather / (2 * half), o.color); gradient.addColorStop(1, '#00000000');
        ctx.fillStyle = gradient; ctx.fillRect(center - half, -diagonal, half * 2, diagonal * 2);
      }
    }
  } else if (kind === 'WhipVeil') {
    const horizontal = o.direction === 'left' || o.direction === 'right';
    const sign = o.direction === 'left' || o.direction === 'up' ? -1 : 1;
    ctx.translate(w / 2, h / 2); if (!horizontal) ctx.rotate(Math.PI / 2);
    const center = sign * (p * 2 - 1) * o.travel;
    const half = o.width / 2 + o.softness; ctx.globalAlpha = o.opacity;
    if (o.softness === 0) ctx.fillStyle = '#ffffff';
    else {
      const gradient = ctx.createLinearGradient(center - half, 0, center + half, 0);
      gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(o.softness / (2 * half), '#ffffff');
      gradient.addColorStop(1 - o.softness / (2 * half), '#ffffff'); gradient.addColorStop(1, '#ffffff00'); ctx.fillStyle = gradient;
    }
    ctx.fillRect(center - half, -diagonal, half * 2, diagonal * 2);
  } else if (kind === 'GlitchVeil') {
    for (const piece of pieces) {
      ctx.globalAlpha = piece.alpha * o.opacity; ctx.fillStyle = piece.color;
      const x = modulo(piece.x + piece.velocity * p * o.travel, w);
      ctx.fillRect(x, piece.y, piece.width, piece.height); ctx.fillRect(x - w, piece.y, piece.width, piece.height);
    }
  } else if (kind === 'Grain' || kind === 'TVStatic') {
    const shift = frame * o['motion-rate'];
    texture.setTransform(new DOMMatrix().translate(kind === 'Grain' ? shift : 0, shift).scale(o.size));
    ctx.imageSmoothingEnabled = false; ctx.fillStyle = texture; ctx.fillRect(0, 0, w, h);
    if (kind === 'TVStatic' && o['scan-lines'] > 0) {
      // Fixed scan lines are not translated with the noise grid.
      ctx.globalAlpha = o['scan-lines']; ctx.fillStyle = staticLines; ctx.fillRect(0, 0, w, h);
    }
  } else if (kind === 'LightLeak') {
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = o.intensity;
    for (const piece of pieces) {
      ctx.save(); ctx.translate(piece.x + p * o.travel, piece.y); ctx.rotate(piece.angle);
      const radius = piece.radius;
      const gradient = ctx.createLinearGradient(-radius, 0, radius, 0);
      gradient.addColorStop(0, '#00000000'); gradient.addColorStop(0.5, piece.color); gradient.addColorStop(1, '#00000000');
      ctx.filter = 'blur(' + (o.softness * radius * 0.25) + 'px)'; ctx.fillStyle = gradient;
      ctx.fillRect(-radius, -diagonal, radius * 2, diagonal * 2); ctx.restore();
    }
  } else if (kind === 'Bokeh') {
    for (const piece of pieces) {
      const x = modulo(piece.x + p * o.drift * piece.velocity, w), y = modulo(piece.y - p * o.drift, h);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, piece.radius);
      gradient.addColorStop(0, o.color); gradient.addColorStop(0.35, o.color); gradient.addColorStop(1, '#00000000');
      ctx.globalAlpha = piece.alpha; ctx.fillStyle = gradient; ctx.fillRect(x - piece.radius, y - piece.radius, piece.radius * 2, piece.radius * 2);
      if (o.warmth !== 0) {
        const tint = ctx.createRadialGradient(x, y, 0, x, y, piece.radius);
        tint.addColorStop(0, o.warmth > 0 ? '#ff9b40' : '#6db7ff'); tint.addColorStop(1, '#00000000');
        ctx.globalAlpha = piece.alpha * Math.abs(o.warmth); ctx.fillStyle = tint; ctx.fillRect(x - piece.radius, y - piece.radius, piece.radius * 2, piece.radius * 2);
      }
    }
  }
  ctx.restore();
};
`;
