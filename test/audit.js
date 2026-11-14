// Static checks that catch "works on my machine" bugs before a phone does:
// every file the offline cache lists must exist, every element the scripts look up must be in the page,
// and every module import must resolve.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const problems = [];

// 1. Offline cache list
const sw = read('sw.js');
const files = [...sw.matchAll(/'([^']+\.(?:js|css|html|png|svg|webmanifest))'/g)].map((m) => m[1]);
for (const f of files) if (!existsSync(new URL(f, root))) problems.push(`sw.js caches a file that does not exist: ${f}`);
const scripts = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js'));
for (const f of scripts) if (!files.includes(`js/${f}`)) problems.push(`js/${f} is not in the offline cache list, so the app would break with no signal`);

// 2. Element ids used by scripts
const html = read('index.html');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const madeInJs = new Set();
for (const f of scripts) for (const m of read(`js/${f}`).matchAll(/id="([A-Za-z][\w-]*)"/g)) madeInJs.add(m[1]);
for (const f of scripts) {
  for (const m of read(`js/${f}`).matchAll(/\$\('#([A-Za-z][\w-]*)'\)(\?)?/g)) {
    if (!ids.has(m[1]) && !madeInJs.has(m[1])) problems.push(`js/${f} looks up #${m[1]}, which is not in index.html or created by a script`);
  }
}

// 3. Imports resolve, and nothing imports a name that is not exported
for (const f of scripts) {
  for (const m of read(`js/${f}`).matchAll(/import\s+(?:\*\s+as\s+\w+|\{([^}]*)\})\s+from\s+'(\.\/[^']+)'/g)) {
    const target = `js/${m[2].slice(2)}`;
    if (!existsSync(new URL(target, root))) { problems.push(`js/${f} imports missing file ${m[2]}`); continue; }
    if (!m[1]) continue;
    const src = read(target);
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|class)\\s+${name}\\b`).test(src)) problems.push(`js/${f} imports "${name}" from ${m[2]}, which does not export it`);
    }
  }
}

// 4. Manifest icons and pages linked from the app exist
const manifest = JSON.parse(read('manifest.webmanifest'));
for (const icon of manifest.icons) if (!existsSync(new URL(icon.src, root))) problems.push(`manifest icon missing: ${icon.src}`);
for (const m of html.matchAll(/(?<![-\w])(?:href|src)="((?!https?:|#|data:)[^"]+)"/g)) if (!existsSync(new URL(m[1], root))) problems.push(`index.html links to a missing file: ${m[1]}`);

if (problems.length) { console.log(problems.map((p) => `PROBLEM - ${p}`).join('\n')); process.exit(1); }
console.log(`audit ok: ${files.length} cached files, ${scripts.length} scripts, ${ids.size} page elements`);
