// Pure scoring engine. No DOM. A match is a list of ball events; everything else is derived.

export function newMatch(cfg) {
  return {
    id: Date.now(),
    created: new Date().toISOString(),
    cfg: {
      teams: [cfg.teamA || 'Team A', cfg.teamB || 'Team B'],
      overs: Math.max(1, cfg.overs | 0 || 5),
      wickets: Math.max(1, cfg.wickets | 0 || 10),
      ballType: cfg.ballType || 'tape',
      groundId: cfg.groundId || null,
      wideRuns: 1,
      noBallRuns: 1,
      reball: cfg.reball !== false, // local rule: are wides / no-balls bowled again?
    },
    innings: [{ balls: [] }],
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
  match.innings[match.current].balls.push({
    runs, extra: ev.extra || null, wicket: ev.wicket || null, t: Date.now(),
  });
  if (inningsOver(match, match.current)) {
    if (match.current === 0) { match.innings.push({ balls: [] }); match.current = 1; }
    else match.done = true;
  }
  return match;
}

export function undo(match) {
  let inn = match.innings[match.current];
  if (!inn.balls.length && match.current === 1) {
    match.innings.pop(); match.current = 0; inn = match.innings[0];
  }
  if (inn.balls.length) { inn.balls.pop(); match.done = false; }
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
