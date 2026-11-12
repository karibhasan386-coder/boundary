// The decision picture: a drawn pitch seen from behind the bowler, with the ball flying in,
// bouncing, reaching the batter and carrying on to the stumps.
// Input is the result of solve() in drs.js. Sideways and height units are half wicket widths.

export const LEN = 176;        // pitch length in half wicket widths (20.12 m / 11.43 cm)
const RELEASE_H = 17;          // about 2 m: where the bowler lets go. Illustrative only.
const lerp = (a, b, k) => a + (b - a) * k;

// Where the ball is when it has travelled a fraction u of the pitch (0 = bowler's stumps, 1 = batter's stumps).
// Before the bounce is drawn for effect; from the bounce onwards it follows the measured marks.
export function ballAt(r, u) {
  const { P, I, W } = r, startX = (P ? P.X : I.X) * 0.4;
  if (P && u <= P.u) {
    const k = P.u ? u / P.u : 1;
    return { X: lerp(startX, P.X, k), H: RELEASE_H * (1 - k ** 1.7), u, phase: 'air' };
  }
  if (u <= I.u) {
    if (P) { const k = (u - P.u) / (I.u - P.u); return { X: lerp(P.X, I.X, k), H: I.H * k, u, phase: 'bounced' }; }
    const k = I.u ? u / I.u : 1;
    return { X: lerp(startX, I.X, k), H: lerp(RELEASE_H, I.H, k ** 1.4), u, phase: 'air' };
  }
  if (!W) return { X: I.X, H: I.H, u: I.u, phase: 'stopped' };
  const k = Math.min(1, (u - I.u) / (1 - I.u));
  return { X: lerp(I.X, W.X, k), H: lerp(I.H, W.H, k), u: Math.min(1, u), phase: 'projected' };
}

const COLOUR = { air: 'rgba(229, 72, 77, 0.5)', bounced: '#e5484d', projected: '#4aa3ff', stopped: '#e5484d' };

// Draw the scene with the ball at u. final = the ball has arrived, so the stumps show the result.
export function drawScene(g, W, H, r, u, final = false) {
  const s = W / 640;
  // Camera over the bowler's shoulder, zoomed on the batter's end: the stumps are about 60 px wide on a 640 px picture.
  const proj = (X, h, uu) => { const Z = uu * LEN + 300; return [W / 2 + (s * 14280 * X) / Z, s * (-144 + (14280 * (13 - h)) / Z)]; };
  const quad = (x0, x1, u0, u1, fill) => {
    g.beginPath();
    [[x0, u0], [x1, u0], [x1, u1], [x0, u1]].forEach(([X, uu], i) => { const [x, y] = proj(X, 0, uu); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fillStyle = fill; g.fill();
  };

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d3320'); sky.addColorStop(1, '#1f6b3a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  quad(-13.3, 13.3, -0.12, 1.1, '#cdb47c');                 // the pitch
  quad(-1, 1, 0, 1, 'rgba(74, 163, 255, 0.38)');           // wicket to wicket
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = 2 * s;
  for (const cu of [0.94, 1]) { g.beginPath(); g.moveTo(...proj(-11.5, 0, cu)); g.lineTo(...proj(11.5, 0, cu)); g.stroke(); }

  const stumpColour = !final ? '#f4f1e6' : r.wickets === 'hitting' ? '#ff453a' : r.wickets === 'clipping' ? '#ffd60a' : '#f4f1e6';
  g.strokeStyle = stumpColour; g.lineCap = 'round'; g.lineWidth = 8 * s;
  for (const X of [-0.85, 0, 0.85]) { g.beginPath(); g.moveTo(...proj(X, 0, 1)); g.lineTo(...proj(X, r.stumpH, 1)); g.stroke(); }
  g.lineWidth = 5 * s; g.beginPath(); g.moveTo(...proj(-0.95, r.stumpH, 1)); g.lineTo(...proj(0.95, r.stumpH, 1)); g.stroke();

  // The path so far, coloured by what kind of stretch it is.
  g.lineWidth = 9 * s; g.lineJoin = 'round';
  let prev = ballAt(r, 0);
  for (let uu = 0.01; uu <= u + 1e-9; uu += 0.01) {
    const b = ballAt(r, Math.min(uu, u));
    g.beginPath(); g.moveTo(...proj(prev.X, prev.H, prev.u)); g.lineTo(...proj(b.X, b.H, b.u));
    g.strokeStyle = COLOUR[b.phase]; g.stroke();
    prev = b;
  }

  const mark = (X, h, uu, fill, rx) => {
    const [x, y] = proj(X, h, uu);
    g.beginPath(); g.ellipse(x, y, rx * s, rx * 0.45 * s, 0, 0, 7); g.fillStyle = fill; g.fill();
    g.lineWidth = 1.5 * s; g.strokeStyle = '#fff'; g.stroke();
  };
  if (r.P && u >= r.P.u) mark(r.P.X, 0, r.P.u, 'rgba(255, 214, 10, 0.9)', 16);   // where it pitched

  const b = ballAt(r, u), Z = b.u * LEN + 300, rad = Math.max(3 * s, (s * 14280 * 0.31) / Z);
  const [gx, gy] = proj(b.X, 0, b.u), [bx, by] = proj(b.X, b.H, b.u);
  g.beginPath(); g.ellipse(gx, gy, rad * 1.1, rad * 0.4, 0, 0, 7); g.fillStyle = 'rgba(0, 0, 0, 0.35)'; g.fill(); // shadow: shows the height
  if (u >= r.I.u) { const [ix, iy] = proj(r.I.X, r.I.H, r.I.u); g.beginPath(); g.arc(ix, iy, rad * 1.7, 0, 7); g.lineWidth = 2 * s; g.strokeStyle = '#fff'; g.stroke(); }
  g.beginPath(); g.arc(bx, by, rad, 0, 7); g.fillStyle = b.phase === 'projected' ? '#4aa3ff' : '#e5484d'; g.fill();
  g.beginPath(); g.arc(bx - rad * 0.3, by - rad * 0.3, rad * 0.35, 0, 7); g.fillStyle = 'rgba(255, 255, 255, 0.55)'; g.fill();
}
