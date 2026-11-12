// DRS-style ball path from a handful of taps on the replay. No AI: this is geometry.
//
// The scorer taps the outer stumps at both ends, the top of the batter's stumps, where the ball
// pitched and where it hit the batter. Because both wickets are a known distance apart and the two
// stump lines meet at a vanishing point, that is enough to place the ball on the pitch and project
// it on to the stumps in a straight line. It ignores swing and dip after impact, so treat a close
// call as close.
//
// All points are { x, y } as fractions of the video frame (0..1). Sideways distances come back in
// "half wicket widths": 0 is middle stump, -1 and +1 are the outer stumps (+ is the right of the picture).

export const BALL = 0.31; // ball radius, in half wicket widths (3.6 cm against 11.4 cm)

function meet(a, b, c, d) { // where line a-b crosses line c-d
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-9) return null;
  const p = a.x * b.y - a.y * b.x, q = c.x * d.y - c.y * d.x;
  return { x: (p * (c.x - d.x) - (a.x - b.x) * q) / den, y: (p * (c.y - d.y) - (a.y - b.y) * q) / den };
}

// marks: { bl, br, bt, ol, or, pitch?, impact }   opts: { aspect, stride, fullToss }
// stride = how far in front of the stumps the batter was hit, as a fraction of the pitch length.
export function solve(marks, opts = {}) {
  const aspect = opts.aspect || 16 / 9, stride = opts.stride ?? 0.06;
  const sq = (p) => ({ x: p.x * aspect, y: p.y }); // make units square
  const need = ['bl', 'br', 'bt', 'ol', 'or', 'impact'].concat(opts.fullToss ? [] : ['pitch']);
  for (const k of need) if (!marks[k]) return { error: `Missing mark: ${k}` };
  const bl = sq(marks.bl), br = sq(marks.br), bt = sq(marks.bt), ol = sq(marks.ol), or = sq(marks.or), impact = sq(marks.impact);

  const V = meet(ol, bl, or, br);
  if (!V) return { error: 'The stump marks are parallel. Mark the stumps again.' };
  const yb = (bl.y + br.y) / 2, yo = (ol.y + or.y) / 2;
  if ((yb - V.y) * (yo - V.y) <= 0 || Math.abs(yb - yo) < 0.02) return { error: 'The two wickets look like they are in the same place. Mark the stumps again.' };

  const depth = (y) => 1 / (y - V.y);          // distance along the ground, in arbitrary units
  const groundY = (Z) => V.y + 1 / Z;
  const edge = (p, y) => V.x + ((p.x - V.x) * (y - V.y)) / (p.y - V.y);
  const centre = (y) => (edge(bl, y) + edge(br, y)) / 2;
  const half = (y) => (edge(br, y) - edge(bl, y)) / 2; // picture size of half a wicket width at that depth

  const Zb = depth(yb), Zo = depth(yo), L = Zo - Zb;
  const stumpH = (yb - bt.y) / half(yb);
  if (!(stumpH > 0.5)) return { error: 'The top of the stumps should be above the bottom. Mark the stumps again.' };

  const Zi = Zb + stride * L, yi = groundY(Zi);
  const along = (Z) => (Z - Zo) / (Zb - Zo); // 0 at the bowler's stumps, 1 at the batter's
  const I = { X: (impact.x - centre(yi)) / half(yi), H: (yi - impact.y) / half(yi), Z: Zi, u: along(Zi) };

  let P = null, W = null;
  if (!opts.fullToss) {
    const pitch = sq(marks.pitch);
    if ((pitch.y - V.y) * (yb - V.y) <= 0) return { error: 'The pitch point is above the horizon. Tap the ball where it hits the ground.' };
    P = { X: (pitch.x - centre(pitch.y)) / half(pitch.y), H: 0, Z: depth(pitch.y) };
    P.u = along(P.Z);
    if ((P.Z - Zi) * L <= 0) return { error: 'The ball must pitch before it reaches the batter. Check the pitch point, or choose a longer stride.' };
    const t = (Zb - Zi) / (Zi - P.Z);
    W = { X: I.X + (I.X - P.X) * t, H: I.H + (I.H - P.H) * t };
  }

  const line = (X) => (Math.abs(X) <= 1 ? 'in_line' : X > 0 ? 'right' : 'left');
  let wickets = 'unknown';
  if (W) {
    const inside = Math.abs(W.X) <= 1 && W.H >= 0 && W.H <= stumpH;
    const touching = Math.abs(W.X) <= 1 + BALL && W.H >= -BALL && W.H <= stumpH + BALL;
    wickets = inside ? 'hitting' : touching ? 'clipping' : 'missing';
  }

  const img = (X, H, y) => ({ x: (centre(y) + X * half(y)) / aspect, y: y - H * half(y) }); // back to frame fractions
  return {
    pitching: P ? line(P.X) : 'full_toss', impact: line(I.X), wickets,
    P, I, W, stumpH,
    draw: {
      corridor: [marks.bl, marks.br, marks.or, marks.ol],
      stumps: [img(-1, 0, yb), img(-1, stumpH, yb), img(1, stumpH, yb), img(1, 0, yb)],
      pitch: P ? marks.pitch : null, impact: marks.impact,
      wicket: W ? img(W.X, W.H, yb) : null,
      ballPx: half(yb) * BALL / aspect, // ball radius at the stumps, as a fraction of frame width
    },
  };
}

// Turn "left / right of the picture" into off or leg for this batter and camera.
export function side(zone, hand = 'right', camera = 'behind-bowler') {
  if (zone !== 'left' && zone !== 'right') return zone;
  const legIsRight = (hand === 'right') !== (camera === 'behind-batter');
  return (zone === 'right') === legIsRight ? 'outside_leg' : 'outside_off';
}
