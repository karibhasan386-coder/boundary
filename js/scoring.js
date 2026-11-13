// Pure scoring engine. No DOM. A match is a list of ball events; everything else is derived.

const names = (v) => [...new Set(String(v || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean))].slice(0, 15);
const newInnings = () => ({ balls: [], striker: null, non: null, bowler: null });
const pick = (v, allowed, fallback) => (allowed.includes(Number(v)) ? Number(v) : fallback);

// Balls in an over. Six unless the match says otherwise (some local games play 4, 5 or 8).
export const bpo = (cfg) => cfg.bpo || 6;
const oversText = (legal, n) => `${(legal / n) | 0}.${legal % n}`;

export function newMatch(cfg) {
  return {
    id: Date.now(),
    created: new Date().toISOString(),
    cfg: {
      teams: [cfg.teamA || 'Team A', cfg.teamB || 'Team B'],
      players: [names(cfg.playersA), names(cfg.playersB)], // optional; empty = team scoring only
      overs: Math.max(1, cfg.overs | 0 || 5),
      wickets: Math.max(1, cfg.wickets | 0 || 10),
      ballType: cfg.ballType || 'tape',
      groundId: cfg.groundId || null,
      wideRuns: pick(cfg.wideRuns, [0, 1, 2], 1),     // local rule: what a wide is worth
      noBallRuns: pick(cfg.noBallRuns, [0, 1, 2], 1),
      bpo: pick(cfg.bpo, [4, 5, 6, 8], 6),
      reball: cfg.reball !== false, // local rule: are wides / no-balls bowled again?
    },
    innings: [newInnings()],
    current: 0,
    done: false,
  };
}

export const ballRuns = (b, cfg) =>
  b.runs + (b.extra === 'wd' ? cfg.wideRuns : b.extra === 'nb' ? cfg.noBallRuns : 0);

export const isLegal = (b, cfg) => !(b.extra === 'wd' || b.extra === 'nb') || !cfg.reball;

export function summarize(inn, cfg) {
  let runs = 0, wickets = 0, legal = 0, extras = 0;
  for (const b of inn.balls) {
    runs += ballRuns(b, cfg);
    if (b.wicket) wickets++;
    if (isLegal(b, cfg)) legal++;
    if (b.extra === 'b' || b.extra === 'lb') extras += b.runs;
    else if (b.extra === 'wd') extras += cfg.wideRuns + b.runs;
    else if (b.extra === 'nb') extras += cfg.noBallRuns;
  }
  return { runs, wickets, legal, extras, overs: oversText(legal, bpo(cfg)) };
}

export function target(match) {
  return match.innings.length > 1 ? summarize(match.innings[0], match.cfg).runs + 1 : null;
}

export function inningsOver(match, i) {
  const s = summarize(match.innings[i], match.cfg);
  if (s.legal >= match.cfg.overs * bpo(match.cfg) || s.wickets >= match.cfg.wickets) return true;
  return i === 1 && s.runs >= target(match);
}

export function addBall(match, ev) {
  if (match.done) throw new Error('Match is finished');
  const runs = ev.runs | 0;
  if (runs < 0 || runs > 7) throw new Error('Runs must be 0 to 7');
  if (ev.extra && !['wd', 'nb', 'b', 'lb'].includes(ev.extra)) throw new Error('Unknown extra');
  const inn = match.innings[match.current];
  const pos = [inn.striker || null, inn.non || null, inn.bowler || null];
  // On a run-out either batter can be the one out; otherwise it is the striker.
  const outNon = !!ev.wicket && ev.out === 'non' && !!pos[1];
  const ball = { runs, extra: ev.extra || null, wicket: ev.wicket || null, t: Date.now(), batter: pos[0], bowler: pos[2], pos,
    out: ev.wicket ? (outNon ? pos[1] : pos[0]) : null };
  const legalBefore = summarize(inn, match.cfg).legal;
  inn.balls.push(ball);
  // Who is on strike next: new batter needed after a wicket, swap on odd runs and at the end of the over.
  if (ball.wicket) { if (outNon) inn.non = null; else inn.striker = null; }
  if (runs % 2 === 1) [inn.striker, inn.non] = [inn.non || null, inn.striker || null];
  if (isLegal(ball, match.cfg) && (legalBefore + 1) % bpo(match.cfg) === 0) {
    [inn.striker, inn.non] = [inn.non || null, inn.striker || null];
    inn.bowler = null;
  }
  if (inningsOver(match, match.current)) {
    if (match.current === 0) { match.innings.push(newInnings()); match.current = 1; }
    else match.done = true;
  }
  return match;
}

export function undo(match) {
  let inn = match.innings[match.current];
  if (!inn.balls.length && match.current === 1) {
    match.innings.pop(); match.current = 0; inn = match.innings[0];
  }
  if (inn.balls.length) {
    const b = inn.balls.pop();
    if (b.pos) [inn.striker, inn.non, inn.bowler] = b.pos;
    match.done = false;
  }
  return match;
}

export function result(match) {
  if (!match.done) return null;
  const { cfg } = match;
  const a = summarize(match.innings[0], cfg), b = summarize(match.innings[1], cfg);
  if (b.runs > a.runs) {
    const w = cfg.wickets - b.wickets;
    return `${cfg.teams[1]} won by ${w} wicket${w === 1 ? '' : 's'}`;
  }
  if (a.runs > b.runs) {
    const r = a.runs - b.runs;
    return `${cfg.teams[0]} won by ${r} run${r === 1 ? '' : 's'}`;
  }
  return 'Match tied';
}

export function ballLabel(b) {
  if (b.wicket) return b.extra ? `W${b.extra}` : 'W';
  if (b.extra === 'wd') return b.runs ? `wd+${b.runs}` : 'wd';
  if (b.extra === 'nb') return b.runs ? `nb+${b.runs}` : 'nb';
  if (b.extra === 'b') return `${b.runs}b`;
  if (b.extra === 'lb') return `${b.runs}lb`;
  return b.runs ? String(b.runs) : '•';
}

// Labels for the over in progress (or the one just completed if nothing bowled since).
export function thisOver(inn, cfg) {
  let out = [], legal = 0;
  for (const b of inn.balls) {
    if (legal === bpo(cfg)) { out = []; legal = 0; }
    out.push(ballLabel(b));
    if (isLegal(b, cfg)) legal++;
  }
  return out;
}

export const outBatters = (inn) => inn.balls.filter((b) => b.wicket && (b.out || b.batter)).map((b) => b.out || b.batter);

// Career numbers per player name across every match stored on this phone.
export function playerStats(matches) {
  const P = {};
  const get = (n) => (P[n] ||= { name: n, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, bowled: 0, conceded: 0, wickets: 0, ids: new Set() });
  for (const m of matches) for (const inn of m.innings) for (const b of inn.balls) {
    if (b.batter) {
      const p = get(b.batter); p.ids.add(m.id);
      if (b.extra !== 'wd') p.balls++;
      if (!b.extra || b.extra === 'nb') { p.runs += b.runs; if (b.runs === 4) p.fours++; if (b.runs === 6) p.sixes++; }
    }
    if (b.wicket && (b.out || b.batter)) { const o = get(b.out || b.batter); o.ids.add(m.id); o.outs++; }
    if (b.bowler) {
      const q = get(b.bowler); q.ids.add(m.id);
      if (b.extra !== 'wd' && b.extra !== 'nb') q.bowled++;
      if (b.extra !== 'b' && b.extra !== 'lb') q.conceded += ballRuns(b, m.cfg);
      if (b.wicket && b.wicket !== 'Run out') q.wickets++;
    }
  }
  return Object.values(P).map(({ ids, ...p }) => ({
    ...p, matches: ids.size,
    strikeRate: p.balls ? (p.runs * 100) / p.balls : 0,
    economy: p.bowled ? (p.conceded * 6) / p.bowled : 0,
  })).sort((a, b) => b.runs - a.runs || b.wickets - a.wickets);
}

export function scorecardText(match) {
  const line = (i) => {
    const s = summarize(match.innings[i], match.cfg);
    return `${match.cfg.teams[i]} ${s.runs}/${s.wickets} (${s.overs} ov)`;
  };
  const out = [line(0)];
  if (match.innings[1]) out.push(line(1));
  out.push(result(match) || 'Match in progress', 'Scored with Boundary');
  return out.join('\n');
}

// Everything a printed scorecard shows for one innings.
export function scorecard(match, i) {
  const inn = match.innings[i], cfg = match.cfg, n = bpo(cfg);
  if (!inn) return null;
  const bat = new Map(), bowl = new Map(), extras = { wd: 0, nb: 0, b: 0, lb: 0 }, fow = [], partnerships = [];
  const batter = (name) => { if (!bat.has(name)) bat.set(name, { name, runs: 0, balls: 0, fours: 0, sixes: 0, how: 'not out' }); return bat.get(name); };
  const bowler = (name) => { if (!bowl.has(name)) bowl.set(name, { name, balls: 0, runs: 0, wickets: 0, maidens: 0, over: -1, overRuns: 0, overBalls: 0 }); return bowl.get(name); };
  let score = 0, legal = 0, wk = 0, pRuns = 0, pBalls = 0;
  for (const b of inn.balls) {
    const total = ballRuns(b, cfg), counts = isLegal(b, cfg), overIdx = (legal / n) | 0;
    score += total; pRuns += total;
    if (b.extra === 'wd') extras.wd += cfg.wideRuns + b.runs;
    else if (b.extra === 'nb') extras.nb += cfg.noBallRuns;
    else if (b.extra) extras[b.extra] += b.runs;
    if (b.extra !== 'wd') pBalls++;
    if (b.batter) {
      const p = batter(b.batter);
      if (b.extra !== 'wd') p.balls++;
      if (!b.extra || b.extra === 'nb') { p.runs += b.runs; if (b.runs === 4) p.fours++; if (b.runs === 6) p.sixes++; }
    }
    if (b.bowler) {
      const q = bowler(b.bowler), conceded = b.extra === 'b' || b.extra === 'lb' ? 0 : total;
      if (q.over !== overIdx) { q.over = overIdx; q.overRuns = 0; q.overBalls = 0; }
      q.runs += conceded; q.overRuns += conceded;
      if (b.extra !== 'wd' && b.extra !== 'nb') q.balls++;
      if (counts && ++q.overBalls === n && q.overRuns === 0) q.maidens++;
      if (b.wicket && b.wicket !== 'Run out') q.wickets++;
    }
    if (counts) legal++;
    if (b.wicket) {
      wk++;
      const who = b.out || b.batter;
      if (who) batter(who).how = b.wicket === 'Run out' || !b.bowler ? b.wicket.toLowerCase() : b.wicket === 'Bowled' ? `b ${b.bowler}` : `${b.wicket.toLowerCase()} b ${b.bowler}`;
      fow.push({ wicket: wk, score, name: who || null, over: oversText(legal, n) });
      partnerships.push({ wicket: wk, runs: pRuns, balls: pBalls, unbroken: false });
      pRuns = 0; pBalls = 0;
    }
  }
  if (pRuns || pBalls) partnerships.push({ wicket: wk + 1, runs: pRuns, balls: pBalls, unbroken: true });
  return {
    team: cfg.teams[i], total: summarize(inn, cfg),
    batting: [...bat.values()].map((p) => ({ ...p, strikeRate: p.balls ? (p.runs * 100) / p.balls : 0 })),
    bowling: [...bowl.values()].map(({ over, overRuns, overBalls, ...q }) => ({ ...q, overs: oversText(q.balls, n), economy: q.balls ? (q.runs * n) / q.balls : 0 })),
    extras: { ...extras, total: extras.wd + extras.nb + extras.b + extras.lb }, fow, partnerships,
  };
}

// A simple, explainable pick: runs, plus 20 for each wicket taken.
export function playerOfMatch(match) {
  const best = playerStats([match]).map((p) => ({ name: p.name, runs: p.runs, wickets: p.wickets, points: p.runs + 20 * p.wickets }))
    .sort((a, b) => b.points - a.points)[0];
  return best && best.points > 0 ? best : null;
}

export function scorecardCsv(match) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, rows = [];
  rows.push(['Match', `${match.cfg.teams[0]} v ${match.cfg.teams[1]}`], ['Date', match.created.slice(0, 10)], ['Result', result(match) || 'Not finished']);
  match.innings.forEach((_, i) => {
    const c = scorecard(match, i);
    rows.push([], [`Innings ${i + 1}`, c.team, `${c.total.runs}/${c.total.wickets}`, `${c.total.overs} overs`]);
    rows.push(['Batter', 'How out', 'Runs', 'Balls', '4s', '6s']);
    c.batting.forEach((p) => rows.push([p.name, p.how, p.runs, p.balls, p.fours, p.sixes]));
    rows.push(['Extras', `wd ${c.extras.wd} nb ${c.extras.nb} b ${c.extras.b} lb ${c.extras.lb}`, c.extras.total]);
    rows.push(['Bowler', 'Overs', 'Maidens', 'Runs', 'Wickets']);
    c.bowling.forEach((p) => rows.push([p.name, p.overs, p.maidens, p.runs, p.wickets]));
  });
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}
