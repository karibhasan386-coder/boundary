import assert from 'node:assert/strict';
import * as S from '../js/scoring.js';
import { decide } from '../js/lbw.js';
import { findBlobs, detectBounce, stepTracks, scorePath } from '../js/tracker.js';
import { measure } from '../js/ground.js';
import { parseScore, describe } from '../js/voice.js';
import { solve, side } from '../js/drs.js';
import { ballAt } from '../js/hawkview.js';
import { angle, metrics, checks, compare, LM } from '../js/form.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };
const bowl = (m, ...balls) => balls.forEach((b) => S.addBall(m, typeof b === 'number' ? { runs: b } : b));

test('legal balls, overs and runs', () => {
  const m = S.newMatch({ overs: 2 });
  bowl(m, 1, 4, 0, 6, 2, 1, 1);
  const s = S.summarize(m.innings[0], m.cfg);
  assert.equal(s.runs, 15); assert.equal(s.overs, '1.1'); assert.equal(s.legal, 7);
  assert.deepEqual(S.thisOver(m.innings[0], m.cfg), ['1']);
});

test('wide and no-ball add a run and are bowled again', () => {
  const m = S.newMatch({ overs: 1 });
  bowl(m, { runs: 0, extra: 'wd' }, { runs: 4, extra: 'nb' }, { runs: 2, extra: 'lb' });
  const s = S.summarize(m.innings[0], m.cfg);
  assert.equal(s.runs, 1 + 5 + 2); assert.equal(s.legal, 1); assert.equal(s.extras, 1 + 1 + 2);
});

test('local rule: wides count as balls when not re-bowled', () => {
  const m = S.newMatch({ overs: 1, reball: false });
  bowl(m, { runs: 0, extra: 'wd' });
  assert.equal(S.summarize(m.innings[0], m.cfg).legal, 1);
});

test('innings change, chase and result by wickets', () => {
  const m = S.newMatch({ teamA: 'Lions', teamB: 'Tigers', overs: 1 });
  bowl(m, 1, 1, 1, 1, 1, 1);
  assert.equal(m.current, 1); assert.equal(S.target(m), 7);
  bowl(m, 6, { runs: 0, wicket: 'Bowled' }, 1);
  assert.equal(m.done, true);
  assert.equal(S.result(m), 'Tigers won by 9 wickets');
  assert.throws(() => S.addBall(m, { runs: 1 }));
});

test('result by runs, tie, and all out', () => {
  const m = S.newMatch({ teamA: 'Lions', teamB: 'Tigers', overs: 1, wickets: 2 });
  bowl(m, 4, 4, 0, 0, 0, 0);
  bowl(m, { runs: 0, wicket: 'Caught' }, { runs: 0, wicket: 'LBW' });
  assert.equal(S.result(m), 'Lions won by 8 runs');
  const t = S.newMatch({ overs: 1 });
  bowl(t, 1, 0, 0, 0, 0, 0); bowl(t, 1, 0, 0, 0, 0, 0);
  assert.equal(S.result(t), 'Match tied');
});

test('undo steps back across the innings break and a finished match', () => {
  const m = S.newMatch({ overs: 1 });
  bowl(m, 1, 1, 1, 1, 1, 1);
  S.undo(m);
  assert.equal(m.current, 0); assert.equal(m.innings.length, 1); assert.equal(m.innings[0].balls.length, 5);
  bowl(m, 1); bowl(m, 6, 6);
  assert.equal(m.done, true);
  S.undo(m);
  assert.equal(m.done, false); assert.equal(m.innings[1].balls.length, 1);
});

test('rejects bad input', () => {
  const m = S.newMatch({});
  assert.throws(() => S.addBall(m, { runs: 9 }));
  assert.throws(() => S.addBall(m, { runs: 1, extra: 'zz' }));
});

const plumb = { noBall: 'no', pitched: 'in_line', batFirst: 'no', impact: 'in_line', shot: 'yes', hitting: 'yes' };
test('LBW: plumb is OUT', () => assert.equal(decide(plumb).verdict, 'OUT'));
test('LBW: each not-out condition', () => {
  for (const change of [{ noBall: 'yes' }, { pitched: 'outside_leg' }, { batFirst: 'yes' }, { impact: 'outside_leg' },
    { impact: 'outside_off', shot: 'yes' }, { hitting: 'no' }]) {
    assert.equal(decide({ ...plumb, ...change }).verdict, 'NOT OUT', JSON.stringify(change));
  }
});
test('LBW: outside off with no shot can be OUT; full toss can be OUT', () => {
  assert.equal(decide({ ...plumb, impact: 'outside_off', shot: 'no' }).verdict, 'OUT');
  assert.equal(decide({ ...plumb, pitched: 'full_toss' }).verdict, 'OUT');
});
test('LBW: unknowns are INCONCLUSIVE, but a known not-out fact still wins', () => {
  assert.equal(decide({}).verdict, 'INCONCLUSIVE');
  assert.equal(decide({}).missing.length, 5);
  assert.equal(decide({ ...plumb, hitting: 'unsure' }).verdict, 'INCONCLUSIVE');
  assert.equal(decide({ pitched: 'outside_leg' }).verdict, 'NOT OUT');
});

test('tracker: finds separate blobs with correct centres', () => {
  const w = 10, h = 6, mask = new Uint8Array(w * h);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2], [8, 4]]) mask[y * w + x] = 1;
  const blobs = findBlobs(mask, w, h).sort((a, b) => b.area - a.area);
  assert.equal(blobs.length, 2);
  assert.equal(blobs[0].area, 4); assert.equal(blobs[0].x, 1.5); assert.equal(blobs[0].y, 1.5);
  assert.equal(blobs[1].area, 1); assert.equal(blobs[1].x, 8);
});
test('tracker: bounce is where the ball stops going down', () => {
  const ys = [0.2, 0.3, 0.4, 0.5, 0.45, 0.4];
  const b = detectBounce(ys.map((y, i) => ({ x: 0.5, y, t: i })));
  assert.equal(b.y, 0.5);
  assert.equal(detectBounce(ys.slice(0, 4).map((y) => ({ x: 0.5, y }))), null);
});

test('tracker: a fast straight blob is picked out from slow jittering clutter', () => {
  let tracks = [];
  for (let f = 0; f < 10; f++) {
    const cands = [{ x: 20 + f * 8, y: 40 + f * 2 }]; // ball: 8 px per frame
    for (let k = 0; k < 12; k++) cands.push({ x: 100 + k * 15 + (f % 2), y: 120 + ((f + k) % 2) }); // limbs wobbling 1 px
    tracks = stepTracks(tracks, cands);
  }
  const good = tracks.filter((t) => scorePath(t.pts));
  assert.equal(good.length, 1);
  assert.equal(good[0].pts.length, 10);
  assert.equal(good[0].pts[9].x, 92);
});
test('tracker: slow or wandering paths are not called a ball', () => {
  const slow = Array.from({ length: 8 }, (_, i) => ({ x: i, y: 0 }));
  const zigzag = Array.from({ length: 8 }, (_, i) => ({ x: (i % 2) * 10, y: 0 }));
  assert.equal(scorePath(slow), null);
  assert.equal(scorePath(zigzag), null);
  assert.ok(scorePath(Array.from({ length: 8 }, (_, i) => ({ x: i * 6, y: i }))));
});

test('voice: English phrases become suggested events', () => {
  assert.deepEqual(parseScore('Four!'), { runs: 4, extra: null, wicket: null });
  assert.deepEqual(parseScore('two runs'), { runs: 2, extra: null, wicket: null });
  assert.deepEqual(parseScore('dot ball'), { runs: 0, extra: null, wicket: null });
  assert.deepEqual(parseScore('wide'), { runs: 0, extra: 'wd', wicket: null });
  assert.deepEqual(parseScore('no ball and four'), { runs: 4, extra: 'nb', wicket: null });
  assert.deepEqual(parseScore('leg bye one'), { runs: 1, extra: 'lb', wicket: null });
  assert.deepEqual(parseScore('he is out bowled'), { runs: 0, extra: null, wicket: 'Bowled' });
  assert.deepEqual(parseScore('run out 1'), { runs: 1, extra: null, wicket: 'Run out' });
  assert.equal(parseScore('nice weather today'), null);
  assert.equal(parseScore(''), null);
});
test('voice: Bangla phrases', () => {
  assert.deepEqual(parseScore('চার'), { runs: 4, extra: null, wicket: null });
  assert.deepEqual(parseScore('ছক্কা'), { runs: 6, extra: null, wicket: null });
  assert.deepEqual(parseScore('দুই রান'), { runs: 2, extra: null, wicket: null });
  assert.deepEqual(parseScore('ওয়াইড'), { runs: 0, extra: 'wd', wicket: null });
  assert.deepEqual(parseScore('নো বল'), { runs: 0, extra: 'nb', wicket: null });
  assert.deepEqual(parseScore('আউট'), { runs: 0, extra: null, wicket: 'Other' });
});
test('voice: descriptions for the confirm step', () => {
  assert.equal(describe({ runs: 4, extra: null, wicket: null }), '4 runs');
  assert.equal(describe({ runs: 0, extra: null, wicket: null }), 'Dot ball');
  assert.equal(describe({ runs: 1, extra: 'wd', wicket: null }), 'Wide + 1 run');
  assert.equal(describe({ runs: 0, extra: null, wicket: 'Bowled' }), 'Wicket (Bowled)');
});

// A pretend camera: 1.5 m high, 3 m behind the bowler's stumps, looking straight down the pitch.
const ASPECT = 16 / 9, HALF = 0.1143, STUMP = 0.711, ZO = 3, ZB = 3 + 20.12;
const shoot = (X, Y, Z) => ({ x: (0.5 * ASPECT + (1.2 * X) / Z) / ASPECT, y: 0.5 + (1.2 * (1.5 - Y)) / Z });
const stumpMarks = { bl: shoot(-HALF, 0, ZB), br: shoot(HALF, 0, ZB), bt: shoot(0, STUMP, ZB), ol: shoot(-HALF, 0, ZO), or: shoot(HALF, 0, ZO) };
const ballMarks = (pitch, hit) => ({ ...stumpMarks, pitch: shoot(...pitch), impact: shoot(...hit) });
const STRIDE = 1.22 / 20.12, ZI = ZB - 1.22;

test('DRS: recovers the ball position and projects it on to the stumps', () => {
  const r = solve(ballMarks([0.05, 0, 17], [0.03, 0.3, ZI]), { aspect: ASPECT, stride: STRIDE });
  assert.equal(r.error, undefined);
  assert.ok(Math.abs(r.P.X - 0.05 / HALF) < 1e-6);
  assert.ok(Math.abs(r.I.X - 0.03 / HALF) < 1e-6);
  assert.ok(Math.abs(r.I.H - 0.3 / HALF) < 1e-6);
  assert.ok(Math.abs(r.stumpH - STUMP / HALF) < 1e-6);
  const t = 1.22 / (ZI - 17);
  assert.ok(Math.abs(r.W.X - (0.03 + (0.03 - 0.05) * t) / HALF) < 1e-6);
  assert.ok(Math.abs(r.W.H - (0.3 + 0.3 * t) / HALF) < 1e-6);
  assert.deepEqual([r.pitching, r.impact, r.wickets], ['in_line', 'in_line', 'hitting']);
});
test('DRS: missing, going over, clipping and pitched outside', () => {
  const o = { aspect: ASPECT, stride: STRIDE };
  assert.equal(solve(ballMarks([-0.3, 0, 17], [0.1, 0.3, ZI]), o).wickets, 'missing');      // sliding past the right stump
  assert.equal(solve(ballMarks([0, 0, 19], [0, 0.65, ZI]), o).wickets, 'missing');          // bouncing over the top
  assert.equal(solve(ballMarks([0.13, 0, 15], [0.13, 0.3, ZI]), o).wickets, 'clipping');    // just outside the stump, ball edge touches
  const wide = solve(ballMarks([0.4, 0, 16], [0.2, 0.3, ZI]), o);
  assert.deepEqual([wide.pitching, wide.impact], ['right', 'right']);
});
test('DRS: full toss, bad marks, and off or leg side', () => {
  const ft = solve({ ...stumpMarks, impact: shoot(0, 0.4, ZI) }, { aspect: ASPECT, stride: STRIDE, fullToss: true });
  assert.deepEqual([ft.pitching, ft.impact, ft.wickets], ['full_toss', 'in_line', 'unknown']);
  assert.ok(solve({ ...stumpMarks }, { aspect: ASPECT }).error);
  assert.ok(solve(ballMarks([0, 0, 22.5], [0, 0.3, ZI]), { aspect: ASPECT, stride: STRIDE }).error); // "pitched" behind the batter
  assert.equal(side('right', 'right', 'behind-bowler'), 'outside_leg');
  assert.equal(side('left', 'right', 'behind-bowler'), 'outside_off');
  assert.equal(side('right', 'left', 'behind-bowler'), 'outside_off');
  assert.equal(side('right', 'right', 'behind-batter'), 'outside_off');
  assert.equal(side('in_line', 'left'), 'in_line');
});

test('decision picture: the ball passes through the marked points', () => {
  const r = solve(ballMarks([0.05, 0, 17], [0.03, 0.3, ZI]), { aspect: ASPECT, stride: STRIDE });
  assert.ok(Math.abs(r.P.u - (17 - ZO) / 20.12) < 1e-6);
  assert.ok(Math.abs(r.I.u - (1 - STRIDE)) < 1e-6);
  assert.ok(ballAt(r, 0).H > 10);                                   // released high
  assert.ok(Math.abs(ballAt(r, r.P.u).H) < 1e-9);                   // on the ground at the bounce
  assert.ok(Math.abs(ballAt(r, r.P.u).X - r.P.X) < 1e-9);
  const hit = ballAt(r, r.I.u);
  assert.ok(Math.abs(hit.H - r.I.H) < 1e-9 && Math.abs(hit.X - r.I.X) < 1e-9);
  const end = ballAt(r, 1);
  assert.equal(end.phase, 'projected');
  assert.ok(Math.abs(end.X - r.W.X) < 1e-9 && Math.abs(end.H - r.W.H) < 1e-9);
  const ft = solve({ ...stumpMarks, impact: shoot(0, 0.4, ZI) }, { aspect: ASPECT, stride: STRIDE, fullToss: true });
  assert.equal(ballAt(ft, 1).phase, 'stopped');                     // full toss: no projection
});

test('rules: five-ball overs and wides worth nothing', () => {
  const m = S.newMatch({ overs: 1, bpo: 5, wideRuns: 0 });
  bowl(m, { runs: 0, extra: 'wd' }, 1, 1, 1, 1);
  assert.equal(S.summarize(m.innings[0], m.cfg).runs, 4);
  assert.equal(S.summarize(m.innings[0], m.cfg).overs, '0.4');
  bowl(m, 1);
  assert.equal(m.current, 1);                       // one five-ball over is the whole innings
  assert.equal(S.newMatch({ bpo: 7 }).cfg.bpo, 6);   // nonsense values fall back to six
});

test('run-out: the non-striker can be the one out', () => {
  const m = S.newMatch({ overs: 2, playersA: 'Rafi\nImran\nSakib', playersB: 'Nayeem' });
  const inn = m.innings[0];
  Object.assign(inn, { striker: 'Rafi', non: 'Imran', bowler: 'Nayeem' });
  bowl(m, { runs: 0, wicket: 'Run out', out: 'non' });
  assert.equal(inn.striker, 'Rafi'); assert.equal(inn.non, null);
  assert.deepEqual(S.outBatters(inn), ['Imran']);
  const st = S.playerStats([m]);
  assert.equal(st.find((p) => p.name === 'Imran').outs, 1);
  assert.equal(st.find((p) => p.name === 'Rafi').outs, 0);
  assert.equal(st.find((p) => p.name === 'Nayeem').wickets, 0); // a run-out is not the bowler's wicket
  S.undo(m);
  assert.equal(inn.non, 'Imran');
});

test('scorecard: batting, bowling, extras, fall of wickets, partnerships', () => {
  const m = S.newMatch({ teamA: 'Lions', teamB: 'Tigers', overs: 2, playersA: 'Rafi\nImran\nSakib', playersB: 'Nayeem\nTuhin' });
  const inn = m.innings[0];
  Object.assign(inn, { striker: 'Rafi', non: 'Imran', bowler: 'Nayeem' });
  bowl(m, 0, 0, 0, 0, 0, 0);                         // maiden to Rafi
  Object.assign(inn, { bowler: 'Tuhin' });           // Imran now on strike
  bowl(m, 4, { runs: 0, extra: 'wd' }, { runs: 2, extra: 'lb' }, { runs: 0, wicket: 'Bowled' });
  const c = S.scorecard(m, 0);
  assert.equal(c.team, 'Lions');
  const rafi = c.batting.find((p) => p.name === 'Rafi'), imran = c.batting.find((p) => p.name === 'Imran');
  assert.deepEqual([rafi.runs, rafi.balls, rafi.how], [0, 6, 'not out']);
  assert.deepEqual([imran.runs, imran.balls, imran.fours, imran.how], [4, 3, 1, 'b Tuhin']);
  const nay = c.bowling.find((p) => p.name === 'Nayeem'), tuh = c.bowling.find((p) => p.name === 'Tuhin');
  assert.deepEqual([nay.overs, nay.maidens, nay.runs, nay.wickets], ['1.0', 1, 0, 0]);
  assert.deepEqual([tuh.overs, tuh.maidens, tuh.runs, tuh.wickets], ['0.3', 0, 5, 1]);
  assert.deepEqual(c.extras, { wd: 1, nb: 0, b: 0, lb: 2, total: 3 });
  assert.deepEqual(c.fow, [{ wicket: 1, score: 7, name: 'Imran', over: '1.3' }]);
  assert.deepEqual(c.partnerships, [{ wicket: 1, runs: 7, balls: 9, unbroken: false }]);
  assert.equal(S.playerOfMatch(m).name, 'Tuhin');    // one wicket (20) beats four runs
  const csv = S.scorecardCsv(m);
  assert.ok(csv.startsWith('"Match","Lions v Tigers"'));
  assert.ok(csv.includes('"Imran","b Tuhin","4","3","1","0"'));
  assert.equal(S.playerOfMatch(S.newMatch({})), null);
});

// A stick figure seen side-on. Coordinates are picture fractions; aspect 1 keeps the maths simple.
function figure(over = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const base = {
    nose: [0.50, 0.20], lShoulder: [0.50, 0.30], rShoulder: [0.50, 0.30], lElbow: [0.56, 0.38], rElbow: [0.44, 0.38],
    lWrist: [0.60, 0.30], rWrist: [0.40, 0.30], lHip: [0.50, 0.55], rHip: [0.50, 0.55],
    lKnee: [0.56, 0.70], rKnee: [0.46, 0.72], lAnkle: [0.50, 0.90], rAnkle: [0.46, 0.90], ...over,
  };
  for (const [k, [x, y]] of Object.entries(base)) lm[LM[k]] = { x, y, visibility: 1 };
  return lm;
}

test('form: angles and measurements', () => {
  assert.equal(Math.round(angle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })), 180);
  assert.equal(Math.round(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })), 90);
  const m = metrics(figure(), 'right', 1);
  assert.ok(m.kneeFront > 130 && m.kneeFront < 150);            // front (left) knee bent
  assert.ok(m.kneeHit > 160);                                    // back leg nearly straight
  assert.equal(Math.round(m.trunkLean), 0);
  assert.ok(m.headOverFront < 0.01);
  assert.equal(m.confidence, 1);
  assert.ok(metrics(figure(), 'left', 1).kneeFront > 160);       // left-hander: sides swap
});

test('form: batting pointers change with the pose', () => {
  const good = checks('batting', metrics(figure(), 'right', 1));
  assert.equal(good.length, 4);
  assert.ok(good.every((c) => c.ok));
  const stiff = checks('batting', metrics(figure({ lKnee: [0.50, 0.72] }), 'right', 1));
  assert.equal(stiff[0].ok, false);
  assert.ok(stiff[0].detail.includes('stiff'));
  const back = checks('batting', metrics(figure({ nose: [0.25, 0.20] }), 'right', 1));
  assert.equal(back[1].ok, false);
});

test('form: bowling, badminton and football pointers', () => {
  const armUp = { rElbow: [0.50, 0.20], rWrist: [0.50, 0.08] };               // straight arm above the head
  const bowl = checks('bowling', metrics(figure({ ...armUp, lKnee: [0.50, 0.72] }), 'right', 1));
  assert.ok(bowl[0].ok && bowl[1].ok && bowl[2].ok);
  const chuck = checks('bowling', metrics(figure({ rElbow: [0.42, 0.22], rWrist: [0.50, 0.12] }), 'right', 1));
  assert.equal(chuck[0].ok, false);
  assert.ok(checks('badminton', metrics(figure(armUp), 'right', 1))[0].ok);
  assert.equal(checks('badminton', metrics(figure(), 'right', 1))[0].ok, false);
  const lean = checks('football', metrics(figure({ lShoulder: [0.30, 0.34], rShoulder: [0.30, 0.34] }), 'right', 1));
  assert.equal(lean[1].ok, false);                                             // leaning back
  assert.equal(checks('nonsense', {}).length, 0);
});

test('form: comparing with a saved reference', () => {
  const ref = metrics(figure(), 'right', 1);
  assert.deepEqual(compare(ref, ref), []);
  const diff = compare(metrics(figure({ lKnee: [0.50, 0.72] }), 'right', 1), ref);
  assert.equal(diff.length, 1);
  assert.ok(diff[0].startsWith('Your front knee is') && diff[0].includes('straighter'));
});

test('all out: a three-player side is out after two wickets, not ten', () => {
  const m = S.newMatch({ overs: 5, wickets: 10, playersA: 'Rafi\nImran\nSakib', playersB: 'Nayeem' });
  const inn = m.innings[0];
  Object.assign(inn, { striker: 'Rafi', non: 'Imran', bowler: 'Nayeem' });
  bowl(m, { runs: 0, wicket: 'Bowled' });
  assert.equal(m.current, 0);
  inn.striker = 'Sakib';
  bowl(m, { runs: 0, wicket: 'Bowled' });
  assert.equal(m.current, 1);                       // nobody left to bat
  bowl(m, 1);                                       // the one-player side wins with its only wicket in hand
  assert.equal(S.result(m), 'Team B won by 10 wickets');   // one named player is not a squad: the setting applies
  const pair = S.newMatch({ teamA: 'Lions', teamB: 'Tigers', overs: 1, playersB: 'Nayeem\nTuhin' });
  bowl(pair, 0, 0, 0, 0, 0, 0);
  Object.assign(pair.innings[1], { striker: 'Nayeem', non: 'Tuhin' });
  bowl(pair, 1);
  assert.equal(S.result(pair), 'Tigers won by 1 wicket');  // a two-player side only ever has one wicket to lose
  const t = S.newMatch({ overs: 5, wickets: 2 });   // no names: the wicket setting decides
  bowl(t, { runs: 0, wicket: 'Bowled' }, { runs: 0, wicket: 'Bowled' });
  assert.equal(t.current, 1);
});

test('ground: square field distances and area', () => {
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const s = measure(sq, 100);
  assert.equal(s.shortest, 50); assert.ok(Math.abs(s.longest - 70.71) < 0.01); assert.equal(s.area, 10000);
});

test('players: strike rotates on odd runs and at the end of the over', () => {
  const m = S.newMatch({ overs: 2, playersA: 'Rafi\nImran, Sakib', playersB: 'Nayeem\nTuhin' });
  assert.deepEqual(m.cfg.players[0], ['Rafi', 'Imran', 'Sakib']);
  const inn = m.innings[0];
  Object.assign(inn, { striker: 'Rafi', non: 'Imran', bowler: 'Nayeem' });
  bowl(m, 1);
  assert.equal(inn.striker, 'Imran');
  bowl(m, 4, 0, 0, 0, 0);
  assert.equal(inn.striker, 'Rafi'); assert.equal(inn.bowler, null);
  S.undo(m);
  assert.equal(inn.striker, 'Imran'); assert.equal(inn.bowler, 'Nayeem');
});

test('players: wicket needs a new batter; stats add up', () => {
  const m = S.newMatch({ overs: 2, playersA: 'Rafi\nImran\nSakib', playersB: 'Nayeem' });
  const inn = m.innings[0];
  Object.assign(inn, { striker: 'Rafi', non: 'Imran', bowler: 'Nayeem' });
  bowl(m, 4, 6, { runs: 0, extra: 'wd' }, { runs: 2, extra: 'lb' }, { runs: 0, wicket: 'Bowled' });
  assert.equal(inn.striker, null);
  assert.deepEqual(S.outBatters(inn), ['Rafi']);
  const st = S.playerStats([m]);
  const rafi = st.find((p) => p.name === 'Rafi'), nay = st.find((p) => p.name === 'Nayeem');
  assert.equal(rafi.runs, 10); assert.equal(rafi.balls, 4); assert.equal(rafi.fours, 1); assert.equal(rafi.sixes, 1); assert.equal(rafi.outs, 1);
  assert.equal(rafi.strikeRate, 250);
  assert.equal(nay.wickets, 1); assert.equal(nay.bowled, 4); assert.equal(nay.conceded, 11);
  assert.equal(nay.economy, 16.5);
});

test('scorecard text', () => {
  const m = S.newMatch({ teamA: 'Lions', teamB: 'Tigers', overs: 1 });
  bowl(m, 1, 1, 1, 1, 1, 1); bowl(m, 6, 1);
  assert.equal(S.scorecardText(m), 'Lions 6/0 (1.0 ov)\nTigers 7/0 (0.2 ov)\nTigers won by 10 wickets\nScored with Boundary');
});

console.log(`\n${n} tests passed`);
