import * as S from './scoring.js';
import { QUESTIONS, decide } from './lbw.js';
import { load, save } from './store.js';
import { Camera } from './camera.js';
import { BallTracker } from './tracker.js';
import { GroundEditor, defaultGround, measure } from './ground.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const db = {
  matches: load('matches', []), grounds: load('grounds', []),
  reviews: load('reviews', []), activeId: load('activeId', null),
};
const persist = () => {
  const ok = [save('matches', db.matches), save('grounds', db.grounds), save('reviews', db.reviews), save('activeId', db.activeId)];
  if (ok.includes(false)) toast('Could not save: phone storage is full or blocked');
};
const active = () => db.matches.find((m) => m.id === db.activeId) || null;
const ui = { extra: null, wicket: false, endArmed: false };

let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- tabs ----------
function show(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${tab}`));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'score') renderScore();
  if (tab === 'history') renderHistory();
  if (tab === 'ground') editor.draw();
}
$('nav').addEventListener('click', (e) => { if (e.target.dataset.tab) show(e.target.dataset.tab); });

// ---------- score ----------
const scoreEl = $('#tab-score');

function renderScore() {
  const m = active();
  if (!m) {
    scoreEl.innerHTML = `
      <h2>New match</h2>
      <form id="setup">
        <label>Batting first<input name="teamA" value="Team A" maxlength="30"></label>
        <label>Their players, one per line (optional)<textarea name="playersA" rows="3" placeholder="Leave empty to score by team only"></textarea></label>
        <label>Batting second<input name="teamB" value="Team B" maxlength="30"></label>
        <label>Their players, one per line (optional)<textarea name="playersB" rows="3"></textarea></label>
        <div class="grid2">
          <label>Overs<input name="overs" type="number" min="1" max="50" value="5"></label>
          <label>Wickets<input name="wickets" type="number" min="1" max="10" value="10"></label>
        </div>
        <label>Ball<select name="ballType">
          <option value="tape">Tape ball</option><option value="tennis">Tennis ball</option><option value="leather">Leather ball</option>
        </select></label>
        <label>Ground<select name="groundId"><option value="">No saved ground</option>
          ${db.grounds.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
        </select></label>
        <label class="check"><input type="checkbox" name="reball" checked> Wides and no-balls are bowled again</label>
        <button class="primary big">Start match</button>
      </form>`;
    return;
  }
  const { cfg } = m, i = m.current, inn = m.innings[i], s = S.summarize(inn, cfg);
  const rr = s.legal ? ((s.runs * 6) / s.legal).toFixed(2) : '0.00';
  const tgt = S.target(m);
  let chase = '';
  if (i === 0 && m.innings.length === 1) chase = '';
  if (tgt && !m.done) {
    const need = tgt - s.runs, left = cfg.overs * 6 - s.legal;
    chase = `<div class="chase">Need ${need} from ${left} ball${left === 1 ? '' : 's'} · target ${tgt}</div>`;
  }
  const first = i === 1 ? S.summarize(m.innings[0], cfg) : null;
  const chips = S.thisOver(inn, cfg).map((l) => {
    const cls = l.startsWith('W') ? 'w' : l === '4' ? 'b4' : l === '6' ? 'b6' : '';
    return `<span class="chip ${cls}">${esc(l)}</span>`;
  }).join('');
  const wkTypes = ['Bowled', 'Caught', 'LBW', 'Run out', 'Stumped', 'Hit wicket', 'Other'];

  const bat = cfg.players?.[i] || [], bowl = cfg.players?.[1 - i] || [], gone = S.outBatters(inn);
  const pick = (pos, label, list, skip) => `<label>${label}<select data-pos="${pos}"><option value="">Choose</option>${
    list.filter((p) => p === inn[pos] || !skip.includes(p)).map((p) => `<option${p === inn[pos] ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>`;
  const players = `${bat.length ? `<div class="grid2">${pick('striker', 'On strike', bat, [...gone, inn.non])}${pick('non', 'Non-striker', bat, [...gone, inn.striker])}</div>` : ''}
    ${bowl.length ? pick('bowler', 'Bowler', bowl, []) : ''}`;
  const ground = db.grounds.find((g) => g.id === cfg.groundId);
  const groundNote = ground ? `<p class="muted">Ground: ${esc(ground.name)}${ground.rules ? ` · agreed rules: ${esc(ground.rules)}` : ''}</p>` : '';

  scoreEl.innerHTML = `
    <div class="board">
      <div class="muted">${esc(cfg.teams[i])} batting · innings ${i + 1} of 2 · ${esc(cfg.ballType)} ball</div>
      <div class="score">${s.runs}/${s.wickets}</div>
      <div class="sub">${s.overs} of ${cfg.overs} overs · run rate ${rr} · extras ${s.extras}</div>
      ${first ? `<div class="muted">${esc(cfg.teams[0])} made ${first.runs}/${first.wickets}</div>` : ''}
      ${chase}
      ${m.done ? `<div class="result">${esc(S.result(m))}</div>` : ''}
    </div>
    <div class="over">${chips || '<span class="muted">No balls this over yet.</span>'}</div>
    ${groundNote}
    ${m.done ? '<button class="primary big" data-act="new">New match</button><button class="big" data-act="share">Share scorecard</button><button class="big" data-act="undo">Undo last ball</button>' : `
      ${players}
      <div class="mods">
        ${[['wd', 'Wide'], ['nb', 'No-ball'], ['b', 'Bye'], ['lb', 'Leg bye']].map(([k, l]) =>
          `<button data-extra="${k}" class="${ui.extra === k ? 'on' : ''}">${l}</button>`).join('')}
        <button data-act="wicket" class="${ui.wicket ? 'on' : ''}">Wicket</button>
      </div>
      ${ui.wicket ? `<label>How out<select id="wkType">${wkTypes.map((w) => `<option>${w}</option>`).join('')}</select></label>` : ''}
      <p class="muted">${ui.extra || ui.wicket ? 'Now tap the runs for this ball.' : 'Tap the runs scored. Tap Wide / No-ball / Wicket first if needed.'}</p>
      <div class="runs">${[0, 1, 2, 3, 4, 6].map((n) => `<button data-runs="${n}">${n}</button>`).join('')}</div>
      <div class="row">
        <button data-act="undo">Undo</button>
        <button data-act="review" class="danger">Appeal / review</button>
        <button data-act="end">${ui.endArmed ? 'Tap again to end' : 'End match'}</button>
      </div>`}`;
}

scoreEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const m = S.newMatch({ ...f, overs: +f.overs, wickets: +f.wickets, groundId: f.groundId ? +f.groundId : null, reball: f.reball === 'on' });
  db.matches.push(m); db.activeId = m.id; persist(); renderScore();
});

scoreEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  const m = active();
  if (!b || !m) return;
  const { act, extra, runs } = b.dataset;
  if (act !== 'end') ui.endArmed = false;
  if (extra) ui.extra = ui.extra === extra ? null : extra;
  else if (act === 'wicket') ui.wicket = !ui.wicket;
  else if (act === 'share') { share(m); return; }
  else if (runs !== undefined) {
    const inn = m.innings[m.current], i = m.current;
    if (m.cfg.players?.[i]?.length && !inn.striker) { toast('Pick who is on strike first'); return; }
    if (m.cfg.players?.[1 - i]?.length && !inn.bowler) { toast('Pick the bowler first'); return; }
    const wicket = ui.wicket ? ($('#wkType')?.value || 'Other') : null;
    S.addBall(m, { runs: +runs, extra: ui.extra, wicket });
    ui.extra = null; ui.wicket = false; persist();
    if (m.done) toast(S.result(m));
    else if (m.current === 1 && !m.innings[1].balls.length) toast(`Innings over. ${m.cfg.teams[1]} need ${S.target(m)}`);
  } else if (act === 'undo') { S.undo(m); persist(); }
  else if (act === 'new') { db.activeId = null; persist(); }
  else if (act === 'end') {
    if (ui.endArmed) { ui.endArmed = false; db.activeId = null; persist(); } else ui.endArmed = true;
  } else if (act === 'review') { show('camera'); appeal(); return; }
  else return;
  renderScore();
});

scoreEl.addEventListener('change', (e) => {
  const pos = e.target.dataset.pos, m = active();
  if (!pos || !m) return;
  m.innings[m.current][pos] = e.target.value || null;
  persist(); renderScore();
});

async function share(m) {
  const text = S.scorecardText(m);
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Scorecard copied'); }
  } catch (err) {
    if (err.name !== 'AbortError') toast('Could not share the scorecard');
  }
}

// ---------- camera + tracking ----------
const live = $('#live'), overlay = $('#overlay'), stage = $('#stage');
const cam = new Camera(live), tracker = new BallTracker();
const EMPTY = { trail: [], bounce: null, tracking: false };
let track = EMPTY, looping = false, infoText = '';
const camMsg = (t) => { $('#camMsg').textContent = t; };

async function startSource(kind, file) {
  closeReview();
  camMsg('Starting…');
  try {
    await cam.start(kind, file);
    if (live.videoWidth) stage.style.aspectRatio = `${live.videoWidth} / ${live.videoHeight}`;
    camMsg('');
    tracker.reset();
    $('#appeal').disabled = !cam.canReplay;
    if (!cam.canReplay) toast('Replay is not supported in this browser');
    if (!looping) { looping = true; schedule(); }
  } catch (err) {
    $('#appeal').disabled = true;
    camMsg(err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera in the browser, then tap Phone camera again.'
      : err.name === 'NotFoundError' ? 'No camera found on this device. Try Demo ball or Video file.'
      : err.message);
  }
}

const schedule = () => (live.requestVideoFrameCallback ? live.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));

function frame() {
  if (!cam.kind) { looping = false; track = EMPTY; drawOverlay(); return; }
  track = $('#trackOn').checked && live.readyState >= 2 ? tracker.process(live) : EMPTY;
  drawOverlay();
  schedule();
}

function drawOverlay() {
  const dpr = window.devicePixelRatio || 1, W = Math.round(overlay.clientWidth * dpr), H = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
  const g = overlay.getContext('2d');
  g.clearRect(0, 0, W, H);
  const { trail, bounce } = track;
  if (trail.length) {
    g.lineWidth = 3 * dpr; g.strokeStyle = '#ffb703'; g.lineJoin = 'round';
    g.beginPath();
    trail.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H)));
    g.stroke();
    const last = trail[trail.length - 1];
    g.fillStyle = '#ffb703'; g.beginPath(); g.arc(last.x * W, last.y * H, 6 * dpr, 0, 7); g.fill();
  }
  if (bounce) {
    g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(bounce.x * W, bounce.y * H, 10 * dpr, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.font = `${12 * dpr}px system-ui`; g.fillText('pitched', bounce.x * W + 14 * dpr, bounce.y * H + 4 * dpr);
  }
  const text = !cam.kind ? 'Tracker idle.' : !$('#trackOn').checked ? 'Tracking is off.'
    : trail.length ? `${track.tracking ? 'Tracking ball' : 'Last ball'} · ${trail.length} points${bounce ? ' · pitch point found' : ''}`
    : 'Watching for a ball…';
  if (text !== infoText) { infoText = text; $('#trackInfo').textContent = text; }
}

$('#tab-camera').addEventListener('click', (e) => { const k = e.target.dataset.src; if (k) startSource(k); });
$('#fileSrc').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) startSource('file', f); e.target.value = ''; });
$('#trackOn').addEventListener('change', () => tracker.reset());

// ---------- review ----------
const replay = $('#replay');
const rev = { urls: [], idx: 0, rate: 0.25, evidence: null, answers: {}, base: '', source: null };

function download(name, blob) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Labelled details for a saved clip: this is what turns match footage into AI training data later.
function clipDetails() {
  const m = active(), d = currentVerdict(), ground = m && db.grounds.find((g) => g.id === m.cfg.groundId);
  return {
    clip: `${rev.base}.webm`, recorded: new Date().toISOString(),
    ballType: m?.cfg.ballType ?? null, ground: ground?.name ?? null, surface: ground?.surface ?? null,
    cameraPosition: $('#camPos').value, source: rev.source,
    decisionType: $('#revType').value, verdict: d.verdict, answers: { ...rev.answers }, tracker: rev.evidence,
    consent: 'Confirm every player in the clip agreed to be recorded before using it for training.',
  };
}

async function appeal() {
  if (!cam.canReplay) { toast('Start a camera source first'); return; }
  const evidence = { points: track.trail.length, pitchFound: !!track.bounce };
  const segs = await cam.snapshot();
  if (!segs.length) { toast('Nothing recorded yet'); return; }
  closeReview();
  rev.urls = segs.map((b) => URL.createObjectURL(b));
  rev.evidence = evidence; rev.answers = {};
  rev.base = `boundary-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  rev.source = { kind: cam.kind, width: live.videoWidth, height: live.videoHeight };
  $('#review').hidden = false;
  renderLbwForm(); syncReviewType();
  playSeg(0);
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function playSeg(i) {
  rev.idx = i;
  replay.src = rev.urls[i];
  replay.defaultPlaybackRate = rev.rate; replay.playbackRate = rev.rate;
  replay.play().catch(() => {});
  const a = $('#dlClip');
  a.href = rev.urls[i]; a.download = `${rev.base}.webm`;
}
replay.addEventListener('ended', () => { if (rev.urls.length) playSeg((rev.idx + 1) % rev.urls.length); });

function closeReview() {
  replay.pause(); replay.removeAttribute('src');
  rev.urls.forEach((u) => URL.revokeObjectURL(u)); rev.urls = [];
  $('#review').hidden = true;
}

$('#speeds').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.rate) {
    rev.rate = +b.dataset.rate; replay.playbackRate = rev.rate;
    document.querySelectorAll('#speeds [data-rate]').forEach((x) => x.classList.toggle('on', x === b));
  } else {
    replay.pause();
    const t = replay.currentTime + (b.id === 'stepF' ? 1 : -1) / 30;
    replay.currentTime = Math.max(0, t);
  }
});

function renderLbwForm() {
  $('#lbwForm').innerHTML = QUESTIONS.map((q) => `
    <label>${q.label}<select data-q="${q.key}">${q.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`).join('');
}
$('#lbwForm').addEventListener('change', (e) => { rev.answers[e.target.dataset.q] = e.target.value; renderVerdict(); });
$('#revType').addEventListener('change', syncReviewType);
$('#manualVerdict').addEventListener('change', renderVerdict);

function syncReviewType() {
  const lbw = $('#revType').value === 'lbw';
  $('#lbwForm').hidden = !lbw; $('#manualWrap').hidden = lbw;
  renderVerdict();
}

function currentVerdict() {
  if ($('#revType').value === 'lbw') return decide(rev.answers);
  return { verdict: $('#manualVerdict').value, reasons: ['Decided by players after watching the replay.'], missing: [] };
}

function renderVerdict() {
  const d = currentVerdict(), el = $('#verdict');
  el.className = `verdict ${d.verdict === 'OUT' ? 'out' : d.verdict === 'INCONCLUSIVE' ? 'inc' : 'notout'}`;
  const ev = rev.evidence;
  el.innerHTML = `<b>${esc(d.verdict)}</b>
    ${d.reasons.length ? `<ul>${d.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${d.missing.length ? `<div class="muted">Still needed:</div><ul>${d.missing.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    <div class="muted">Tracker: ${ev && ev.points ? `${ev.points} ball points seen${ev.pitchFound ? ', pitch point found' : ''}` : 'no ball seen'}. The decision above comes from your answers, not from the tracker.</div>`;
}

$('#saveReview').addEventListener('click', () => {
  const d = currentVerdict(), m = active();
  db.reviews.push({
    id: Date.now(), t: new Date().toISOString(), matchId: m?.id ?? null,
    at: m ? `${m.cfg.teams[m.current]} ${S.summarize(m.innings[m.current], m.cfg).overs} ov` : '',
    type: $('#revType').value, verdict: d.verdict, reasons: d.reasons, answers: { ...rev.answers }, tracker: rev.evidence,
  });
  persist(); closeReview(); toast(`Saved: ${d.verdict}`);
});
$('#closeReview').addEventListener('click', closeReview);
$('#dlMeta').addEventListener('click', () =>
  download(`${rev.base}.json`, new Blob([JSON.stringify(clipDetails(), null, 2)], { type: 'application/json' })));
$('#appeal').addEventListener('click', appeal);

// ---------- ground ----------
const editor = new GroundEditor($('#gCanvas'), renderGroundStats);

function renderGroundStats() {
  const g = editor.ground, s = measure(g.points, g.widthM);
  $('#gStats').textContent = `Shortest boundary ${s.shortest.toFixed(0)} m · longest ${s.longest.toFixed(0)} m · area ${Math.round(s.area)} m² (from the middle of the pitch)`;
}

function fillGroundSelect() {
  $('#gSel').innerHTML = `<option value="">Unsaved ground</option>${db.grounds.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}`;
  $('#gSel').value = db.grounds.some((g) => g.id === editor.ground.id) ? editor.ground.id : '';
}

function loadGround(g) {
  editor.set(g);
  $('#gName').value = g.name; $('#gWidth').value = g.widthM; $('#gPitch').value = g.pitchYards;
  $('#gSurface').value = g.surface; $('#gRules').value = g.rules;
  fillGroundSelect(); renderGroundStats();
}

$('#gSel').addEventListener('change', (e) => {
  const g = db.grounds.find((x) => x.id === +e.target.value);
  loadGround(g ? structuredClone(g) : defaultGround());
});
$('#gNew').addEventListener('click', () => loadGround(defaultGround()));
$('#gAdd').addEventListener('click', () => editor.addPoint());
$('#gDel').addEventListener('click', () => { if (!editor.removePoint()) toast('A ground needs at least 3 points'); });
$('#tab-ground').addEventListener('input', (e) => {
  const g = editor.ground, id = e.target.id;
  if (id === 'gName') g.name = e.target.value;
  else if (id === 'gWidth') g.widthM = Math.max(10, +e.target.value || 60);
  else if (id === 'gPitch') g.pitchYards = Math.max(8, +e.target.value || 22);
  else if (id === 'gSurface') g.surface = e.target.value;
  else if (id === 'gRules') g.rules = e.target.value;
  else return;
  editor.draw(); renderGroundStats();
});
$('#gSave').addEventListener('click', () => {
  const g = editor.ground;
  if (!g.name.trim()) { toast('Give the ground a name first'); $('#gName').focus(); return; }
  const copy = structuredClone(g), at = db.grounds.findIndex((x) => x.id === g.id);
  if (at >= 0) db.grounds[at] = copy; else db.grounds.push(copy);
  persist(); fillGroundSelect(); toast('Ground saved');
});

// ---------- history ----------
const historyEl = $('#tab-history');

function renderHistory() {
  const line = (m, i) => {
    const s = S.summarize(m.innings[i], m.cfg);
    return `${esc(m.cfg.teams[i])} ${s.runs}/${s.wickets} (${s.overs})`;
  };
  const matches = [...db.matches].reverse().map((m) => `
    <div class="item">
      <b>${line(m, 0)}${m.innings[1] ? ` · ${line(m, 1)}` : ''}</b>
      <span class="muted">${new Date(m.created).toLocaleString()} · ${esc(m.cfg.ballType)} ball · ${m.done ? esc(S.result(m)) : m.id === db.activeId ? 'in progress' : 'not finished'}</span>
      <div class="row">
        ${!m.done && m.id !== db.activeId ? `<button data-resume="${m.id}">Resume</button>` : ''}
        <button data-share="${m.id}">Share scorecard</button>
      </div>
    </div>`).join('');
  const stats = S.playerStats(db.matches);
  const players = stats.length ? `<table class="table"><thead><tr><th>Player</th><th>Runs</th><th>SR</th><th>Wkts</th><th>Econ</th></tr></thead><tbody>${
    stats.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.runs}</td><td>${p.balls ? p.strikeRate.toFixed(0) : '-'}</td><td>${p.wickets}</td><td>${p.bowled ? p.economy.toFixed(1) : '-'}</td></tr>`).join('')
  }</tbody></table>` : '<p class="muted">Add player names when you start a match to see batting and bowling numbers here.</p>';
  const reviews = [...db.reviews].reverse().map((r) => `
    <div class="item">
      <b>${esc(r.type.toUpperCase())}: ${esc(r.verdict)}</b>
      <span class="muted">${new Date(r.t).toLocaleString()}${r.at ? ` · ${esc(r.at)}` : ''}</span>
      ${r.reasons?.length ? `<div class="muted">${r.reasons.map(esc).join(' ')}</div>` : ''}
    </div>`).join('');
  historyEl.innerHTML = `
    <h2>Matches</h2>${matches || '<p class="muted">No matches yet. Start one on the Score tab.</p>'}
    <h2>Players</h2>${players}
    <h2>Reviews</h2>${reviews || '<p class="muted">No reviews yet. Tap Appeal on the Camera tab during a match.</p>'}`;
}
historyEl.addEventListener('click', (e) => {
  const { resume, share: shareId } = e.target.dataset;
  if (resume) { db.activeId = +resume; persist(); show('score'); }
  if (shareId) { const m = db.matches.find((x) => x.id === +shareId); if (m) share(m); }
});

// ---------- themes ----------
// Premium themes are only marked, not sold: there is no payment system yet, so the
// "preview" switch stands in for a real subscription check.
const THEMES = [
  { id: 'pitch', name: 'Pitch', free: true, bar: '#F3F7EE', art: 'repeating-linear-gradient(90deg, #2C7A45 0 12px, #297241 12px 24px)' },
  { id: 'paper', name: 'Paper', free: true, bar: '#FBFBFA', art: '#FFFFFF' },
  { id: 'glass', name: 'Glass', bar: '#DCE8F7', art: 'linear-gradient(135deg, #9BD3FF, #FFC2E2 55%, #B5F2CF)' },
  { id: 'night', name: 'Night match', bar: '#06120C', art: 'radial-gradient(circle at 15% 0%, #5c6b61 0%, #06120C 60%)' },
  { id: 'whites', name: 'Test whites', bar: '#FAF5E9', art: 'linear-gradient(90deg, #FFFDF7 0 70%, #7A1F1F 70%)' },
  { id: 'tape', name: 'Tape ball', bar: '#0F0F10', art: 'repeating-linear-gradient(135deg, #FFD400 0 10px, #111111 10px 20px)' },
];
const look = { theme: load('theme', 'pitch'), preview: load('premiumPreview', false) };

function applyTheme() {
  let t = THEMES.find((x) => x.id === look.theme) || THEMES[0];
  if (!t.free && !look.preview) t = THEMES[0];
  if (t.id === 'pitch') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]').content = t.bar;
  $('#premiumPreview').checked = look.preview;
  $('#swatches').innerHTML = THEMES.map((x) => `
    <button class="swatch${x.id === t.id ? ' on' : ''}" data-theme-id="${x.id}" aria-pressed="${x.id === t.id}">
      <i style="background:${x.art}"></i><b>${x.name}</b>
      <span class="tag${x.free ? ' free' : ''}">${x.free ? 'Free' : 'Premium'}</span>
    </button>`).join('');
  editor.draw();
}

$('#themeBtn').addEventListener('click', () => {
  const p = $('#themePanel');
  p.hidden = !p.hidden; $('#themeBtn').setAttribute('aria-expanded', String(!p.hidden));
});
$('#swatches').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-id]'); if (!b) return;
  const t = THEMES.find((x) => x.id === b.dataset.themeId);
  if (!t.free && !look.preview) { toast('Premium theme. Tick "Preview premium themes" to try it.'); return; }
  look.theme = t.id; save('theme', t.id); applyTheme();
});
$('#premiumPreview').addEventListener('change', (e) => {
  look.preview = e.target.checked; save('premiumPreview', look.preview); applyTheme();
});

// ---------- boot ----------
loadGround(defaultGround());
applyTheme();
renderScore();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
