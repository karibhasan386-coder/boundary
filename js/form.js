// Form check: turns body points into a few plain measurements and coaching pointers.
// No DOM and no AI in this file. The body points come from the pose tracker (33 points per person,
// each { x, y, visibility } as fractions of the picture). Everything here is 2D, so the camera
// should be side-on to the player.
//
// These are general coaching pointers, not a coach. The ranges are deliberately wide.

export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};

// Lines to draw between body points.
export const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

export const SPORTS = {
  batting: { name: 'Cricket: batting (front-foot shot)', moment: 'the moment the bat meets the ball' },
  bowling: { name: 'Cricket: bowling', moment: 'the moment the ball leaves the hand' },
  tennis: { name: 'Tennis: forehand or backhand', moment: 'the moment the racket meets the ball' },
  badminton: { name: 'Badminton: overhead shot', moment: 'the moment the racket meets the shuttle' },
  football: { name: 'Football: striking the ball', moment: 'the moment the foot meets the ball' },
};

// Angle at point b, in degrees. 180 means a straight limb.
export function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const den = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!den) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / den))) * 180) / Math.PI;
}

// hand: 'right' or 'left'. The "front" side is the one facing the play (left side for a right-hander);
// the "hit" side is the bowling arm, racket arm or kicking leg.
export function metrics(lm, hand = 'right', aspect = 16 / 9) {
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 1 });
  const f = hand === 'right' ? 'l' : 'r', h = hand === 'right' ? 'r' : 'l';
  const pt = (side, part) => P(LM[side + part]);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const sh = mid(P(LM.lShoulder), P(LM.rShoulder)), hip = mid(P(LM.lHip), P(LM.rHip)), nose = P(LM.nose);
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 1e-6;
  const used = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
  return {
    kneeFront: angle(pt(f, 'Hip'), pt(f, 'Knee'), pt(f, 'Ankle')),
    kneeHit: angle(pt(h, 'Hip'), pt(h, 'Knee'), pt(h, 'Ankle')),
    elbowFront: angle(pt(f, 'Shoulder'), pt(f, 'Elbow'), pt(f, 'Wrist')),
    elbowHit: angle(pt(h, 'Shoulder'), pt(h, 'Elbow'), pt(h, 'Wrist')),
    trunkLean: (Math.atan2(Math.abs(sh.x - hip.x), hip.y - sh.y) * 180) / Math.PI,   // 0 = upright
    headOverFront: Math.abs(nose.x - pt(f, 'Ankle').x) / torso,                       // 0 = head over the front foot
    wristHitHeight: (sh.y - pt(h, 'Wrist').y) / torso,                                 // above 0 = hitting hand above the shoulders
    wristAboveHead: pt(h, 'Wrist').y < nose.y,
    armsOut: Math.abs(pt(f, 'Wrist').x - pt(f, 'Shoulder').x) / torso,                 // front arm away from the body
    confidence: Math.min(...used.map((i) => lm[i].visibility ?? 1)),
  };
}

const r = (n) => Math.round(n);
const C = (ok, title, good, fix) => ({ ok, title, detail: ok ? good : fix });

// Returns [{ ok, title, detail }] for the chosen shot.
export function checks(sport, m) {
  switch (sport) {
    case 'batting': return [
      C(m.kneeFront >= 100 && m.kneeFront <= 160, 'Front knee', `Bent (${r(m.kneeFront)}°): your weight is going into the shot.`,
        m.kneeFront > 160 ? `Front leg is stiff (${r(m.kneeFront)}°). Bend the front knee and lean into the ball.` : `Front knee is very deep (${r(m.kneeFront)}°). Stay a little taller to keep your balance.`),
      C(m.headOverFront <= 0.6, 'Head position', 'Head is over the front foot.', 'Head is falling behind the front foot. Take your head towards the ball.'),
      C(m.elbowFront >= 60 && m.elbowFront <= 150, 'Front elbow', `Front elbow is bent and leading (${r(m.elbowFront)}°).`,
        m.elbowFront > 150 ? `Front arm is locked straight (${r(m.elbowFront)}°). Keep the front elbow bent and high.` : `Front arm is cramped (${r(m.elbowFront)}°). Give yourself room to swing.`),
      C(m.trunkLean <= 30, 'Balance', `Body is balanced (${r(m.trunkLean)}° lean).`, `Body is leaning a lot (${r(m.trunkLean)}°). Stay more upright through the shot.`),
    ];
    case 'bowling': return [
      C(m.elbowHit >= 160, 'Bowling arm', `Arm is straight (${r(m.elbowHit)}°).`, `Bowling arm is bent (${r(m.elbowHit)}°). A bent arm that straightens is a throw. Keep it straight.`),
      C(m.wristAboveHead, 'Release height', 'Releasing from above the head.', 'Release is low. Reach tall and let go above your head.'),
      C(m.kneeFront >= 150, 'Front leg', `Front leg is braced (${r(m.kneeFront)}°).`, `Front knee is collapsing (${r(m.kneeFront)}°). Land on a firm front leg to bowl over it.`),
      C(m.trunkLean <= 45, 'Balance', `Body is under control (${r(m.trunkLean)}° lean).`, `Falling away a lot (${r(m.trunkLean)}°). Keep your head and chest going towards the batter.`),
    ];
    case 'tennis': return [
      C(m.kneeFront >= 115 && m.kneeFront <= 165, 'Knees', `Knees are bent (${r(m.kneeFront)}°).`,
        m.kneeFront > 165 ? `Legs are straight (${r(m.kneeFront)}°). Bend your knees and push up through the ball.` : `Very low (${r(m.kneeFront)}°). Rise a little as you hit.`),
      C(m.elbowHit >= 110, 'Hitting arm', `Arm is extended through contact (${r(m.elbowHit)}°).`, `Arm is cramped (${r(m.elbowHit)}°). Meet the ball further in front of you.`),
      C(m.wristHitHeight >= -0.9 && m.wristHitHeight <= 0.2, 'Contact height', 'Contact is between hip and shoulder height.',
        m.wristHitHeight > 0.2 ? 'Contact is above the shoulder. Move back or take it earlier.' : 'Contact is very low. Bend your knees instead of dropping the racket.'),
      C(m.trunkLean <= 25, 'Balance', `Body is upright (${r(m.trunkLean)}° lean).`, `Leaning a lot (${r(m.trunkLean)}°). Move your feet so you can hit upright.`),
    ];
    case 'badminton': return [
      C(m.wristAboveHead, 'Reach', 'Hitting above the head.', 'Contact is low. Get behind the shuttle and reach up to hit it at full height.'),
      C(m.elbowHit >= 150, 'Hitting arm', `Arm is nearly straight at contact (${r(m.elbowHit)}°).`, `Arm is bent at contact (${r(m.elbowHit)}°). Straighten the arm as you hit for more power.`),
      C(m.kneeFront <= 175 || m.kneeHit <= 175, 'Legs', 'Knees are soft, ready to move.', 'Legs are locked. Keep your knees slightly bent so you can recover.'),
      C(m.trunkLean <= 35, 'Balance', `Body is under control (${r(m.trunkLean)}° lean).`, `Leaning back a lot (${r(m.trunkLean)}°). Move your feet earlier to get behind the shuttle.`),
    ];
    case 'football': return [
      C(m.kneeFront >= 115 && m.kneeFront <= 168, 'Standing leg', `Standing knee is bent (${r(m.kneeFront)}°).`,
        m.kneeFront > 168 ? `Standing leg is stiff (${r(m.kneeFront)}°). Bend it for balance and power.` : `Standing leg is very bent (${r(m.kneeFront)}°). Plant a little taller.`),
      C(m.trunkLean <= 25, 'Body over the ball', `Chest is over the ball (${r(m.trunkLean)}° lean).`, `Leaning back (${r(m.trunkLean)}°). The ball will fly high. Get your chest over it.`),
      C(m.kneeHit >= 100, 'Kicking leg', `Kicking leg is extending through the ball (${r(m.kneeHit)}°).`, `Kicking leg is still folded (${r(m.kneeHit)}°). Strike through the ball and follow through.`),
      C(m.armsOut >= 0.3, 'Arms', 'Opposite arm is out for balance.', 'Arms are tucked in. Swing your opposite arm out for balance.'),
    ];
    default: return [];
  }
}

const NAMES = { kneeFront: 'front knee', kneeHit: 'back knee', elbowFront: 'front elbow', elbowHit: 'hitting elbow', trunkLean: 'body lean' };

// Compares against a pose the player saved earlier. Only differences worth mentioning are returned.
export function compare(m, ref, threshold = 15) {
  const out = [];
  for (const key of Object.keys(NAMES)) {
    const diff = m[key] - ref[key];
    if (Math.abs(diff) < threshold) continue;
    const more = key === 'trunkLean' ? 'more' : 'straighter', less = key === 'trunkLean' ? 'less' : 'more bent';
    out.push(`Your ${NAMES[key]} is ${r(Math.abs(diff))}° ${diff > 0 ? more : less} than your reference (${r(m[key])}° against ${r(ref[key])}°).`);
  }
  return out;
}
