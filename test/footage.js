// Offline check of the ball tracker on a real video file.
// Usage: node test/footage.js <video> [width] [start seconds] [duration seconds]
// Needs ffmpeg on PATH. Prints every stretch where the tracker believed it saw a ball.
import { spawn } from 'node:child_process';
import { TrackCore } from '../js/tracker.js';

const [file, wArg = '320', ss = '0', dur = '9999'] = process.argv.slice(2);
if (!file) { console.error('usage: node test/footage.js <video> [width] [start] [duration]'); process.exit(1); }
const w = +wArg, h = Math.round((w * 9) / 16), size = w * h * 4, fps = 25;
const ff = spawn('ffmpeg', ['-v', 'error', '-ss', ss, '-t', dur, '-i', file, '-vf', `fps=${fps},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });

const core = new TrackCore(w, h), episodes = [];
let buf = Buffer.alloc(0), frame = 0, cur = null, shaky = 0;
const close = () => { if (cur) { episodes.push(cur); cur = null; } };
ff.stdout.on('data', (chunk) => {
  buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
  while (buf.length >= size) {
    const s = core.feed(new Uint8Array(buf.subarray(0, size)));
    buf = buf.subarray(size);
    const t = +ss + frame / fps; frame++;
    if (s.shaky) shaky++;
    if (s.tracking) {
      const a = s.trail[0], b = s.trail.at(-1);
      cur ||= { from: t };
      Object.assign(cur, { to: t, points: s.trail.length, start: [a.x, a.y], end: [b.x, b.y], pitched: !!s.bounce });
    } else close();
  }
});
ff.on('close', () => {
  close();
  console.log(`${file}: ${frame} frames at ${w}x${h}, camera moving in ${shaky} (${Math.round((100 * shaky) / Math.max(1, frame))}%)`);
  if (!episodes.length) console.log('  no ball paths found');
  for (const e of episodes) {
    const f = (p) => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`;
    console.log(`  ${e.from.toFixed(2)}s to ${e.to.toFixed(2)}s  ${e.points} points  ${f(e.start)} -> ${f(e.end)}${e.pitched ? '  pitched' : ''}`);
  }
});
