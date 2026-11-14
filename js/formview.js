// The Form tab: film a shot, see your skeleton, check one moment, compare with your own best.
import { SPORTS, BONES, LM, metrics, checks, compare } from './form.js';
import { detect, loadPose } from './pose.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initForm({ toast, load, save }) {
  const video = $('#fmVideo'), canvas = $('#fmCanvas'), stage = $('#fmStage');
  const st = { kind: null, stream: null, url: null, lm: null, busy: false, loop: false, frozen: null, refs: load('formRefs', {}), timer: 0 };
  const msg = (t) => { $('#fmMsg').textContent = t; };
  const sport = () => $('#fmSport').value, hand = () => $('#fmHand').value;
  const aspect = () => (video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9);

  $('#fmSport').innerHTML = Object.entries(SPORTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const tip = () => { $('#fmTip').textContent = `Put the camera side-on to the player, about waist height, with the whole body in the picture. Check ${SPORTS[sport()].moment}.`; };
  tip();

  function stop() {
    clearTimeout(st.timer);
    st.loop = false; st.kind = null; st.lm = null; st.frozen = null;
    st.stream?.getTracks().forEach((t) => t.stop()); st.stream = null;
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    video.pause(); video.srcObject = null; video.removeAttribute('src');
    $('#fmCheck').disabled = true; $('#fmTimer').disabled = true; $('#fmCtl').hidden = true;
    draw();
  }

  async function start(kind, file) {
    stop();
    $('#fmOut').innerHTML = '';
    try {
      msg('Loading the body tracker (about 6 MB the first time, needs internet)…');
      await loadPose();
      msg('Starting…');
      if (kind === 'camera') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera. Open the app in Chrome.');
        st.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        video.srcObject = st.stream;
      } else {
        st.url = URL.createObjectURL(file);
        video.src = st.url; video.loop = true;
      }
      video.muted = true;
      await video.play();
      // Some files (old .ogv clips, some phone formats) load but show no picture in this browser.
      if (!video.videoWidth) throw new Error('This browser cannot show that video. Film it with the phone camera here, or use an MP4 or WebM file.');
      stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      st.kind = kind; msg('');
      $('#fmCheck').disabled = false; $('#fmTimer').disabled = kind !== 'camera'; $('#fmCtl').hidden = kind !== 'file';
      st.loop = true; tick();
    } catch (err) {
      stop();
      msg(err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera in the browser, then try again.'
        : err.name === 'NotFoundError' ? 'No camera found. Try a video file instead.'
        : /import|fetch|network|Failed to/i.test(err.message) ? 'Could not load the body tracker. Check your internet and try again.' : err.message);
    }
  }

  async function analyse() {
    if (st.busy || !st.kind || video.readyState < 2) return;
    st.busy = true;
    try { st.lm = await detect(video); } catch { st.lm = null; }
    st.busy = false;
    draw();
  }

  function tick() {
    if (!st.loop) return;
    if (!video.paused) analyse();
    (video.requestVideoFrameCallback ? (f) => video.requestVideoFrameCallback(f) : requestAnimationFrame)(tick);
  }
  video.addEventListener('seeked', analyse); // stepping through a paused clip

  function draw() {
    const dpr = window.devicePixelRatio || 1, W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    const skeleton = (lm, colour, width, labels) => {
      const ok = (i) => (lm[i].visibility ?? 1) > 0.4;
      g.lineCap = 'round'; g.lineWidth = width * dpr; g.strokeStyle = colour;
      for (const [a, b] of BONES) {
        if (!ok(a) || !ok(b)) continue;
        g.beginPath(); g.moveTo(lm[a].x * W, lm[a].y * H); g.lineTo(lm[b].x * W, lm[b].y * H); g.stroke();
      }
      g.fillStyle = colour;
      for (const i of Object.values(LM)) { if (!ok(i)) continue; g.beginPath(); g.arc(lm[i].x * W, lm[i].y * H, width * 1.2 * dpr, 0, 7); g.fill(); }
      if (!labels) return;
      const m = metrics(lm, hand(), aspect()), f = hand() === 'right' ? 'l' : 'r', h = hand() === 'right' ? 'r' : 'l';
      g.font = `600 ${13 * dpr}px system-ui`;
      for (const [idx, val] of [[LM[`${f}Knee`], m.kneeFront], [LM[`${h}Knee`], m.kneeHit], [LM[`${f}Elbow`], m.elbowFront], [LM[`${h}Elbow`], m.elbowHit]]) {
        if (!ok(idx)) continue;
        const text = `${Math.round(val)}°`, x = lm[idx].x * W + 10 * dpr, y = lm[idx].y * H - 8 * dpr;
        g.fillStyle = 'rgba(0, 0, 0, 0.6)'; g.fillRect(x - 3 * dpr, y - 13 * dpr, g.measureText(text).width + 6 * dpr, 17 * dpr);
        g.fillStyle = '#fff'; g.fillText(text, x, y);
      }
    };
    const ref = st.refs[sport()];
    if (st.frozen && ref?.lm) skeleton(alignTo(ref.lm, st.frozen), 'rgba(74, 163, 255, 0.85)', 3, false); // your saved reference, as a ghost
    const lm = st.frozen || st.lm;
    if (lm) skeleton(lm, '#ffd60a', 4, true);
  }

  // Move and scale a saved pose so its hips and body length match the current one.
  function alignTo(ref, cur) {
    const mid = (lm, a, b) => ({ x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 });
    const rh = mid(ref, LM.lHip, LM.rHip), rs = mid(ref, LM.lShoulder, LM.rShoulder), ch = mid(cur, LM.lHip, LM.rHip), cs = mid(cur, LM.lShoulder, LM.rShoulder);
    const k = Math.hypot(cs.x - ch.x, cs.y - ch.y) / (Math.hypot(rs.x - rh.x, rs.y - rh.y) || 1e-6);
    return ref.map((p) => ({ x: ch.x + (p.x - rh.x) * k, y: ch.y + (p.y - rh.y) * k, visibility: p.visibility }));
  }

  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

  async function check() {
    if (!st.kind) return;
    if (st.kind === 'file') video.pause();
    // Wait for the frame to be on screen and for any analysis already running, so we judge this frame and not the last one.
    for (let i = 0; i < 60 && (video.seeking || video.readyState < 2 || st.busy); i++) await sleep(50);
    st.busy = true;
    try { st.lm = await detect(video); } catch { st.lm = null; }
    st.busy = false;
    if (!st.lm) { clearReport(); draw(); toast('No player found in the picture. Get the whole body in view.'); return; }
    st.frozen = st.lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility }));
    report();
  }

  // The written report always belongs to one frozen frame. Leaving that frame removes it.
  function clearReport() { st.frozen = null; $('#fmOut').innerHTML = ''; }

  function report() {
    const m = metrics(st.frozen, hand(), aspect()), list = checks(sport(), m), good = list.filter((c) => c.ok).length, ref = st.refs[sport()];
    const diffs = ref ? compare(m, ref.m) : null;
    $('#fmOut').innerHTML = `
      <div class="verdict ${good === list.length ? 'notout' : good >= list.length / 2 ? 'inc' : 'out'}"><b>${good} of ${list.length} look good</b>
        ${m.confidence < 0.5 ? '<div class="muted">Parts of the body were hard to see, so treat this as a rough guide. Side-on, whole body in view, works best.</div>' : ''}</div>
      ${list.map((c) => `<div class="fm-check"><span class="tag ${c.ok ? 'free' : ''}">${c.ok ? 'Good' : 'Work on'}</span><div><b>${esc(c.title)}</b>${esc(c.detail)}</div></div>`).join('')}
      ${diffs ? `<h3>Against your saved reference</h3>${diffs.length ? `<ul>${diffs.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '<p class="muted">Very close to your reference. The blue outline is your saved pose.</p>'}` : ''}
      <div class="row">
        <button data-fm="saveRef">${ref ? 'Replace my reference with this' : 'Save this as my reference'}</button>
        ${ref ? '<button data-fm="clearRef">Forget my reference</button>' : ''}
        <button data-fm="resume">Back to live</button>
      </div>
      <p class="muted">General coaching pointers from body angles, not a coach. Yellow is you; the numbers are joint angles (180° is a straight limb).</p>`;
    draw();
    $('#fmOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#tab-form').addEventListener('click', (e) => {
    const act = e.target.closest('[data-fm]')?.dataset.fm; if (!act) return;
    if (act === 'camera') start('camera');
    else if (act === 'play') { if (video.paused) { clearReport(); video.play().catch(() => {}); } else video.pause(); }
    else if (act === 'slow') { video.playbackRate = video.playbackRate === 1 ? 0.25 : 1; toast(video.playbackRate === 1 ? 'Normal speed' : 'Quarter speed'); }
    else if (act === 'back' || act === 'fwd') { video.pause(); clearReport(); video.currentTime = Math.max(0, video.currentTime + (act === 'fwd' ? 1 : -1) / 30); }
    else if (act === 'resume') { clearReport(); if (st.kind === 'file') video.play().catch(() => {}); draw(); }
    else if (act === 'saveRef') {
      st.refs[sport()] = { lm: st.frozen, m: metrics(st.frozen, hand(), aspect()), hand: hand(), saved: new Date().toISOString() };
      save('formRefs', st.refs); toast('Saved as your reference'); report();
    } else if (act === 'clearRef') { delete st.refs[sport()]; save('formRefs', st.refs); toast('Reference removed'); report(); }
  });
  $('#fmCheck').addEventListener('click', check);
  $('#fmTimer').addEventListener('click', () => {
    let n = 5; clearTimeout(st.timer);
    const step = () => { if (!st.kind) return; if (n === 0) { msg(''); check(); return; } msg(`Checking in ${n}…`); n--; st.timer = setTimeout(step, 1000); };
    step();
  });
  $('#fmFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) start('file', f); });
  $('#fmSport').addEventListener('change', () => { tip(); if (st.frozen) report(); else draw(); });
  $('#fmHand').addEventListener('change', () => { if (st.frozen) report(); else draw(); });
  window.addEventListener('resize', draw);

  return { stop };
}
