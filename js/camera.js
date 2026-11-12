// Video source + rolling replay buffer.
// The recorder restarts every few seconds and keeps the last segments, so an appeal
// can pull back the previous ~6-12 seconds without recording the whole match.

function pickMime() {
  if (!window.MediaRecorder) return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Synthetic delivery so the pipeline can be tried with no camera and no match.
function makeDemo() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const g = c.getContext('2d');
  let raf = 0, t0 = performance.now();
  const draw = (now) => {
    const t = ((now - t0) / 1000) % 3.2;
    g.fillStyle = '#2f6b3a'; g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#c9b27a';
    g.beginPath(); g.moveTo(280, 40); g.lineTo(360, 40); g.lineTo(470, 350); g.lineTo(170, 350); g.fill();
    g.fillStyle = '#f4f1e6';
    for (const x of [308, 320, 332]) g.fillRect(x - 1, 22, 3, 22);
    for (const x of [290, 320, 350]) g.fillRect(x - 3, 250, 6, 90);
    if (t < 1.4) {
      const p = t / 1.4, bounceAt = 0.62;
      const x = 322 + 26 * p;
      let y;
      if (p < bounceAt) y = 60 + (p / bounceAt) ** 1.6 * 200;
      else { const q = (p - bounceAt) / (1 - bounceAt); y = 260 - 90 * q + 30 * q * q; }
      g.fillStyle = '#d7263d';
      g.beginPath(); g.arc(x, y, 4 + 5 * p, 0, 7); g.fill();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return { stream: c.captureStream(30), stop: () => cancelAnimationFrame(raf) };
}

export class Camera {
  constructor(video, segMs = 6000) {
    this.video = video; this.segMs = segMs;
    this.stream = null; this.rec = null; this.segs = []; this.timer = 0; this.demo = null; this.url = null;
  }

  get canReplay() { return !!this.rec; }

  // want: { width, height, fps } asked from the phone camera. The phone gives the nearest it supports.
  async start(kind, file, want = { width: 1280, height: 720, fps: 60 }) {
    this.stop();
    const v = this.video;
    if (kind === 'camera') {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera. Open the app over https or on localhost.');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: want.width }, height: { ideal: want.height }, frameRate: { ideal: want.fps } },
      });
      v.srcObject = this.stream;
    } else if (kind === 'demo') {
      this.demo = makeDemo();
      this.stream = this.demo.stream;
      v.srcObject = this.stream;
    } else {
      this.url = URL.createObjectURL(file);
      v.srcObject = null; v.src = this.url; v.loop = true;
    }
    v.muted = true;
    await v.play();
    if (kind === 'file') this.stream = v.captureStream ? v.captureStream() : null;
    this.kind = kind;
    if (this.stream && pickMime() !== null) this._startSeg();
  }

  _startSeg() {
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      if (blob.size) { this.segs.push(blob); if (this.segs.length > 3) this.segs.shift(); }
      rec._done?.();
    };
    rec.start();
    this.rec = rec;
    this.timer = setTimeout(() => this._rotate(), this.segMs);
  }

  _rotate() {
    if (!this.rec) return;
    const old = this.rec;
    this._startSeg();
    old.stop();
  }

  // Close the current segment now and return the last two (oldest first).
  snapshot() {
    if (!this.rec) return Promise.resolve([]);
    clearTimeout(this.timer);
    const old = this.rec;
    return new Promise((resolve) => {
      old._done = () => resolve(this.segs.slice(-2));
      this._startSeg();
      old.stop();
    });
  }

  stop() {
    clearTimeout(this.timer);
    if (this.rec) { this.rec.onstop = null; if (this.rec.state !== 'inactive') this.rec.stop(); this.rec = null; }
    if (this.kind !== 'file') this.stream?.getTracks().forEach((t) => t.stop());
    this.demo?.stop(); this.demo = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.video.pause(); this.video.srcObject = null; this.video.removeAttribute('src');
    this.stream = null; this.segs = []; this.kind = null;
  }
}
