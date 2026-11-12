// Experimental live ball tracker.
// Real matches are busy: players, bats and shadows all move. So instead of picking one blob per
// frame, it follows every small moving blob for a few frames and only calls something "the ball"
// when it has moved fast and fairly straight. It measures what it can see; it never gives a verdict.

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

// How ball-like a path is. Returns null until it is long, fast, straight and smooth enough.
// Smooth matters most on real footage: leaves in the wind give paths that hop about with
// uneven steps and sharp turns, while a ball keeps a steady speed and turns once at most (the bounce).
export function scorePath(pts, minPoints = 5, minStep = 2.5, minStraight = 0.6) {
  if (pts.length < minPoints) return null;
  const steps = [];
  let len = 0, turns = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, d = Math.hypot(dx, dy) / (pts[i].gap || 1);
    steps.push(d); len += Math.hypot(dx, dy);
    if (i > 1) {
      const ex = pts[i - 1].x - pts[i - 2].x, ey = pts[i - 1].y - pts[i - 2].y;
      const cos = (dx * ex + dy * ey) / ((Math.hypot(dx, dy) * Math.hypot(ex, ey)) || 1);
      if (cos < 0.5) turns++; // more than 60 degrees
    }
  }
  const a = pts[0], b = pts[pts.length - 1], net = Math.hypot(b.x - a.x, b.y - a.y);
  const step = len / (pts.length - 1), straight = len ? net / len : 0;
  const sorted = [...steps].sort((x, y) => x - y), median = sorted[sorted.length >> 1];
  const even = sorted[sorted.length - 1] <= 3 * median && sorted[0] >= median / 3;
  return step >= minStep && straight >= minStraight && turns <= 1 && even ? { step, straight, len } : null;
}

// Pure association step, so it can be tested without a camera.
// tracks: [{ pts: [{x, y}], miss }], cands: [{x, y}] in pixels. Mutates and returns tracks.
export function stepTracks(tracks, cands, maxTracks = 80, k = 1) {
  const used = new Uint8Array(cands.length);
  tracks.sort((p, q) => q.pts.length - p.pts.length); // longer paths choose first
  for (const t of tracks) {
    const n = t.pts.length, a = t.pts[n - 1], b = n > 1 ? t.pts[n - 2] : null;
    const gap = t.miss + 1;
    const vx = b ? (a.x - b.x) / (a.gap || 1) : 0, vy = b ? (a.y - b.y) / (a.gap || 1) : 0, sp = Math.hypot(vx, vy);
    const px = a.x + vx * gap, py = a.y + vy * gap;
    const gate = b ? Math.max(5 * k, 0.6 * sp * gap) : 40 * k;
    let best = -1, bd = gate;
    for (let i = 0; i < cands.length; i++) {
      if (used[i]) continue;
      const d = Math.hypot(cands[i].x - px, cands[i].y - py);
      // Nearest wins, even if it barely moved: a wobbling limb then stays a slow path and never scores.
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { used[best] = 1; t.pts.push({ x: cands[best].x, y: cands[best].y, gap }); t.miss = 0; }
    else t.miss++;
  }
  const kept = tracks.filter((t) => t.miss <= (t.pts.length >= 5 ? 6 : 2));
  for (let i = 0; i < cands.length && kept.length < maxTracks; i++) {
    if (!used[i]) kept.push({ pts: [{ x: cands[i].x, y: cands[i].y, gap: 1 }], miss: 0 });
  }
  return kept;
}

// The part of the picture where the pitch should sit (fractions of width and height).
export const PITCH_ZONE = { x0: 0.12, x1: 0.88, y0: 0.28, y1: 0.96 };

// Camera-free core: feed it RGBA frames of a fixed size. Used by the app and by the offline footage test.
export class TrackCore {
  constructor(w = 320, h = 180) { this.w = w; this.h = h; this.zone = { ...PITCH_ZONE }; this.reset(); }

  reset() { this.prev = null; this.prev2 = null; this.tracks = []; this.ball = null; this.shown = []; this.live = false; this.shaky = false; }

  feed(d) {
    const { w, h } = this, p1 = this.prev, p2 = this.prev2;
    this.prev2 = p1; this.prev = d;
    if (!p1 || !p2) return this.state();

    // Moving right now = different from both of the last two frames (removes the "ghost" left behind).
    const mask = new Uint8Array(w * h);
    let moving = 0;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const a = Math.abs(d[p] - p1[p]) + Math.abs(d[p + 1] - p1[p + 1]) + Math.abs(d[p + 2] - p1[p + 2]);
      if (a <= 45) continue;
      const b = Math.abs(d[p] - p2[p]) + Math.abs(d[p + 1] - p2[p + 1]) + Math.abs(d[p + 2] - p2[p + 2]);
      if (b > 45) { mask[i] = 1; moving++; }
    }
    // If a big part of the picture moved, the camera itself moved: nothing can be trusted this frame.
    this.shaky = moving > mask.length * 0.12;
    const k = w / 320; // size limits scale with the working resolution
    // Skip the outer edge of the picture: video compression flickers there and looks like motion.
    // Only look inside the pitch zone. Trees, sky and the crowd around it move too, and fool the tracker.
    const z = this.zone;
    const cands = this.shaky ? [] : findBlobs(mask, w, h).filter((b) => b.area <= 140 * k * k && b.bw <= 28 * k && b.bh <= 28 * k
      && b.x > z.x0 * w && b.x < z.x1 * w && b.y > z.y0 * h && b.y < z.y1 * h).slice(0, 70);
    this.tracks = stepTracks(this.tracks, cands, 80, k);

    let best = null, bestLen = 0;
    for (const t of this.tracks) {
      if (t.miss > 0 && t !== this.ball) continue;
      // A real delivery is over in about 3 seconds and is seen in most frames along the way.
      const frames = t.pts.reduce((n, p) => n + (p.gap || 1), 0);
      if (frames > 90 || t.pts.length / frames < 0.6) { if (t === this.ball) this.ball = null; continue; }
      const s = scorePath(t.pts, 5, 2.5 * k);
      if (s && s.len > bestLen) { best = t; bestLen = s.len; }
    }
    if (best) this.ball = best;
    this.live = !!this.ball && this.tracks.includes(this.ball) && this.ball.miss <= 6;
    if (this.ball && this.live) this.shown = this.ball.pts.slice(-120).map((p) => ({ x: p.x / w, y: p.y / h }));
    if (!this.live) this.ball = null; // keep the finished path on screen until a new one starts
    return this.state();
  }

  state() {
    return { trail: this.shown, bounce: detectBounce(this.shown), tracking: this.live, shaky: this.shaky };
  }
}

export class BallTracker extends TrackCore {
  constructor(w = 320, h = 180) {
    super(w, h);
    this.c = document.createElement('canvas');
    this.c.width = w; this.c.height = h;
    this.ctx = this.c.getContext('2d', { willReadFrequently: true });
  }

  process(video) {
    this.ctx.drawImage(video, 0, 0, this.w, this.h);
    return this.feed(this.ctx.getImageData(0, 0, this.w, this.h).data);
  }
}
