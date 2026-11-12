// Ground Studio: a top-down boundary polygon you drag into the shape of your real ground.

export function defaultGround() {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    points.push({ x: 0.5 + 0.42 * Math.cos(a), y: 0.5 + 0.44 * Math.sin(a) });
  }
  return { id: Date.now(), name: '', points, widthM: 60, pitchYards: 22, surface: 'grass', rules: '' };
}

function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

// Distances are from the middle of the pitch (centre of the drawing), in metres.
export function measure(points, widthM) {
  let shortest = Infinity, longest = 0, area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    shortest = Math.min(shortest, segDist(0.5, 0.5, a, b));
    longest = Math.max(longest, Math.hypot(a.x - 0.5, a.y - 0.5));
    area += a.x * b.y - b.x * a.y;
  }
  return { shortest: shortest * widthM, longest: longest * widthM, area: Math.abs(area) / 2 * widthM * widthM };
}

export class GroundEditor {
  constructor(canvas, onChange) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.onChange = onChange;
    this.ground = defaultGround(); this.sel = -1; this.drag = -1;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(ev, () => { this.drag = -1; });
  }

  set(ground) { this.ground = ground; this.sel = -1; this.draw(); }

  pos(e) {
    const r = this.c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  down(e) {
    const p = this.pos(e);
    let best = 0.06; this.drag = -1;
    this.ground.points.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) { best = d; this.drag = i; }
    });
    this.sel = this.drag;
    if (this.drag >= 0) this.c.setPointerCapture?.(e.pointerId);
    this.draw();
  }

  move(e) {
    if (this.drag < 0) return;
    const p = this.pos(e), clamp = (v) => Math.max(0.02, Math.min(0.98, v));
    this.ground.points[this.drag] = { x: clamp(p.x), y: clamp(p.y) };
    this.draw(); this.onChange?.();
  }

  addPoint() {
    const pts = this.ground.points;
    let at = 0, longest = 0;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > longest) { longest = d; at = i; }
    });
    const a = pts[at], b = pts[(at + 1) % pts.length];
    pts.splice(at + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    this.sel = at + 1; this.draw(); this.onChange?.();
  }

  removePoint() {
    const pts = this.ground.points;
    if (pts.length <= 3) return false;
    pts.splice(this.sel >= 0 ? this.sel : pts.length - 1, 1);
    this.sel = -1; this.draw(); this.onChange?.();
    return true;
  }

  draw() {
    const { g, c, ground } = this, W = c.width, H = c.height, pts = ground.points;
    // Colours follow the active theme.
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    const stroke = v('--stroke', '#111111');
    g.clearRect(0, 0, W, H);
    g.fillStyle = v('--canvas-bg', '#F7F6F3'); g.fillRect(0, 0, W, H);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H)));
    g.closePath();
    g.fillStyle = v('--field', '#EDF3EC'); g.fill();
    g.setLineDash([14, 8]); g.lineWidth = 4; g.strokeStyle = stroke; g.stroke(); // the boundary rope
    g.setLineDash([]);

    const pl = ((ground.pitchYards * 0.9144) / ground.widthM) * H, pw = Math.max(6, (3.05 / ground.widthM) * W);
    g.fillStyle = v('--pitch', '#FBF3DB'); g.fillRect(W / 2 - pw / 2, H / 2 - pl / 2, pw, pl);
    g.lineWidth = 2; g.strokeStyle = v('--pitch-line', '#956400'); g.strokeRect(W / 2 - pw / 2, H / 2 - pl / 2, pw, pl);

    pts.forEach((p, i) => {
      const r = i === this.sel ? 15 : 11;
      g.beginPath(); g.arc(p.x * W, p.y * H, r, 0, 7);
      g.fillStyle = i === this.sel ? stroke : v('--dot', '#FFFFFF'); g.fill();
      g.lineWidth = 3; g.strokeStyle = stroke; g.stroke();
    });
  }
}
