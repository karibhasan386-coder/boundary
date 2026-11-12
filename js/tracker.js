// Experimental live ball tracker: frame differencing on a tiny frame, small moving blobs,
// nearest-to-prediction association. It measures only what it can see; it never guesses a verdict.

export function findBlobs(mask, w, h) {
  const seen = new Uint8Array(w * h), blobs = [], stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    blobs.push({ area, x: sx / area, y: sy / area, bw, bh, fill: area / (bw * bh) });
  }
  return blobs;
}

// First point where the ball stops moving down the image and starts moving up.
export function detectBounce(trail) {
  for (let i = 2; i < trail.length; i++) {
    const v1 = trail[i - 1].y - trail[i - 2].y, v2 = trail[i].y - trail[i - 1].y;
    if (v1 > 0.004 && v2 < -0.002) return trail[i - 1];
  }
  return null;
}

export class BallTracker {
  constructor(w = 160, h = 90) {
    this.w = w; this.h = h;
    this.c = document.createElement('canvas');
    this.c.width = w; this.c.height = h;
    this.ctx = this.c.getContext('2d', { willReadFrequently: true });
    this.reset();
  }

  reset() { this.prev = null; this.trail = []; this.miss = 0; this.ended = true; this.frames = 0; }

  process(video) {
    const { w, h, ctx } = this;
    ctx.drawImage(video, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, prev = this.prev;
    this.prev = d; this.frames++;
    if (!prev) return this.state();

    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const diff = Math.abs(d[p] - prev[p]) + Math.abs(d[p + 1] - prev[p + 1]) + Math.abs(d[p + 2] - prev[p + 2]);
      if (diff > 60) mask[i] = 1;
    }
    const cands = findBlobs(mask, w, h).filter((b) => b.area >= 2 && b.area <= 150 && b.bw <= 25 && b.bh <= 25);

    let pick = null;
    const n = this.trail.length;
    if (!this.ended && n) {
      const a = this.trail[n - 1], b = n > 1 ? this.trail[n - 2] : a;
      const px = (2 * a.x - b.x) * w, py = (2 * a.y - b.y) * h;
      let best = 25;
      for (const c of cands) {
        const dist = Math.hypot(c.x - px, c.y - py);
        if (dist < best) { best = dist; pick = c; }
      }
    } else if (cands.length >= 1 && cands.length <= 5) {
      pick = cands.reduce((m, c) => (c.fill > m.fill || (c.fill === m.fill && c.area < m.area) ? c : m));
    }

    if (pick) {
      if (this.ended) { this.trail = []; this.ended = false; }
      this.trail.push({ x: pick.x / w, y: pick.y / h, t: performance.now() });
      if (this.trail.length > 120) this.trail.shift();
      this.miss = 0;
    } else if (!this.ended && ++this.miss > 12) {
      this.ended = true; // keep the finished trail on screen until a new one starts
    }
    return this.state();
  }

  state() {
    const trail = this.trail.length >= 4 ? this.trail : [];
    return { trail, bounce: detectBounce(trail), tracking: !this.ended && trail.length > 0 };
  }
}
