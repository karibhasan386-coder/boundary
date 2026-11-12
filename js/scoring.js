// Pure scoring engine. No DOM. A match is a list of ball events; everything else is derived.

const names = (v) => [...new Set(String(v || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean))].slice(0, 15);
const newInnings = () => ({ balls: [], striker: null, non: null, bowler: null });

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
      wideRuns: 1,
      noBallRuns: 1,
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
  return { runs, wickets, legal, extras, overs: `${(legal / 6) | 0}.${legal % 6}` };
}

export function target(match) {
  return match.innings.length > 1 ? summarize(match.innings[0], match.cfg).runs + 1 : null;
}

export function inningsOver(match, i) {
  const s = summarize(match.innings[i], match.cfg);
  if (s.legal >= match.cfg.overs * 6 || s.wickets >= match.cfg.wickets) return true;
  return i === 1 && s.runs >= target(match);
}

export function addBall(match, ev) {
  if (match.done) throw new Error('Match is finished');
  const runs = ev.runs | 0;
  if (runs < 0 || runs > 7) throw new Error('Runs must be 0 to 7');
  if (ev.extra && !['wd', 'nb', 'b', 'lb'].includes(ev.extra)) throw new Error('Unknown extra');
  const inn = match.innings[match.current];
  const pos = [inn.striker || null, inn.non || null, inn.bowler || null];
  const ball = { runs, extra: ev.extra || null, wicket: ev.wicket || null, t: Date.now(), batter: pos[0], bowler: pos[2], pos };
  const legalBefore = summarize(inn, match.cfg).legal;
  inn.balls.push(ball);
  // Who is on strike next: new batter needed after a wicket, swap on odd runs and at the end of the over.
  if (ball.wicket) inn.striker = null;
  if (runs % 2 === 1) [inn.striker, inn.non] = [inn.non || null, inn.striker || null];
  if (isLegal(ball, match.cfg) && (legalBefore + 1) % 6 === 0) {
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
    if (legal === 6) { out = []; legal = 0; }
    out.push(ballLabel(b));
    if (isLegal(b, cfg)) legal++;
  }
  return out;
}

export const outBatters = (inn) => inn.balls.filter((b) => b.wicket && b.batter).map((b) => b.batter);

// Career numbers per player name across every match stored on this phone.
export function playerStats(matches) {
  const P = {};
  const get = (n) => (P[n] ||= { name: n, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, bowled: 0, conceded: 0, wickets: 0, ids: new Set() });
  for (const m of matches) for (const inn of m.innings) for (const b of inn.balls) {
    if (b.batter) {
      const p = get(b.batter); p.ids.add(m.id);
      if (b.extra !== 'wd') p.balls++;
      if (!b.extra || b.extra === 'nb') { p.runs += b.runs; if (b.runs === 4) p.fours++; if (b.runs === 6) p.sixes++; }
      if (b.wicket) p.outs++;
    }
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
