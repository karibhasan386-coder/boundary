// Turns a spoken phrase into a suggested scoring event. English and Bangla.
// It only ever suggests: the scorer must confirm before the score changes.

const RUNS = [
  [0, ['zero', 'dot', 'dot ball', 'no run', 'no runs', 'nothing', 'শূন্য', 'ডট', 'ডট বল', 'রান নেই']],
  [1, ['one', 'single', 'a single', 'one run', 'এক', 'এক রান', 'সিঙ্গেল']],
  [2, ['two', 'double', 'two runs', 'couple', 'দুই', 'দুই রান', 'ডাবল']],
  [3, ['three', 'three runs', 'তিন', 'তিন রান']],
  [4, ['four', 'four runs', 'boundary', 'চার', 'চার রান', 'বাউন্ডারি']],
  [6, ['six', 'sixer', 'six runs', 'maximum', 'ছয়', 'ছয়', 'ছক্কা', 'ছয় রান']],
];
const EXTRAS = [
  ['lb', ['leg bye', 'leg byes', 'legbye', 'লেগ বাই']],
  ['nb', ['no ball', 'noball', 'no-ball', 'নো বল', 'নোবল']],
  ['wd', ['wide', 'wide ball', 'ওয়াইড', 'ওয়াইড', 'ওয়াইড বল']],
  ['b', ['bye', 'byes', 'বাই']],
];
const WICKETS = [
  ['Run out', ['run out', 'runout', 'রান আউট']],
  ['Bowled', ['bowled', 'clean bowled', 'বোল্ড']],
  ['Caught', ['caught', 'catch', 'catch out', 'ক্যাচ', 'ক্যাচ আউট']],
  ['LBW', ['lbw', 'l b w', 'leg before', 'এলবিডব্লিউ', 'এল বি ডব্লিউ']],
  ['Stumped', ['stumped', 'stumping', 'স্টাম্পড', 'স্টাম্পিং']],
  ['Other', ['out', 'wicket', 'আউট', 'উইকেট']],
];

const has = (text, phrase) => (` ${text} `).includes(` ${phrase} `);

export function parseScore(input) {
  let text = String(input || '').toLowerCase().normalize('NFC').replace(/[.,!?;:।]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let extra = null, wicket = null, runs = null;
  const take = (table) => {
    for (const [value, phrases] of table) {
      for (const p of [...phrases].sort((a, b) => b.length - a.length)) {
        if (has(text, p)) { text = (` ${text} `).replace(` ${p} `, ' ').trim(); return value; }
      }
    }
    return null;
  };
  extra = take(EXTRAS);       // "no ball" must be removed before "no run" / "one" are looked for
  wicket = take(WICKETS);
  const digit = text.match(/(?:^| )([0-7])(?: |$)/);
  runs = digit ? +digit[1] : take(RUNS);
  if (runs == null && !extra && !wicket) return null;
  return { runs: runs ?? 0, extra, wicket };
}

export function describe(ev) {
  const names = { wd: 'Wide', nb: 'No-ball', b: 'Bye', lb: 'Leg bye' };
  const parts = [];
  if (ev.extra) parts.push(names[ev.extra]);
  if (ev.wicket) parts.push(ev.wicket === 'Other' ? 'Wicket' : `Wicket (${ev.wicket})`);
  if (ev.runs || !parts.length) parts.push(ev.runs === 0 ? 'Dot ball' : `${ev.runs} run${ev.runs === 1 ? '' : 's'}`);
  return parts.join(' + ');
}
