import assert from 'node:assert/strict';
import * as S from '../js/scoring.js';
import { decide } from '../js/lbw.js';
import { findBlobs, detectBounce, stepTracks, scorePath } from '../js/tracker.js';
import { measure } from '../js/ground.js';
import { parseScore, describe } from '../js/voice.js';

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
