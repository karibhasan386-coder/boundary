// Deterministic LBW rules engine (Law 36). No AI here: it only applies the law to
// answers that people give after watching the replay. Anything not known => INCONCLUSIVE.

export const QUESTIONS = [
  { key: 'noBall', label: 'Was it a no-ball?',
    options: [['unsure', 'Not sure'], ['no', 'Legal ball'], ['yes', 'No-ball']] },
  { key: 'pitched', label: 'Where did the ball pitch?',
    options: [['unsure', 'Not sure'], ['in_line', 'In line with stumps'], ['outside_off', 'Outside off'],
      ['outside_leg', 'Outside leg'], ['full_toss', 'Full toss (did not pitch)']] },
  { key: 'batFirst', label: 'Did it hit the bat first?',
    options: [['unsure', 'Not sure'], ['no', 'No, pad/body first'], ['yes', 'Yes, bat first']] },
  { key: 'impact', label: 'Where did it hit the batter?',
    options: [['unsure', 'Not sure'], ['in_line', 'In line with stumps'], ['outside_off', 'Outside off'],
      ['outside_leg', 'Outside leg']] },
  { key: 'shot', label: 'Did the batter try to play a shot?',
    options: [['unsure', 'Not sure'], ['yes', 'Yes'], ['no', 'No shot offered']] },
  { key: 'hitting', label: 'Would it have hit the stumps?',
    options: [['unsure', 'Not sure'], ['yes', 'Yes'], ['no', 'No, missing']] },
];

export function decide(a = {}) {
  const v = (k) => a[k] || 'unsure';
  const notOut = [], missing = [], ok = [];

  if (v('noBall') === 'yes') notOut.push('No-ball: batter cannot be out LBW.');
  else if (v('noBall') === 'no') ok.push('Legal delivery.');
  else missing.push('Was it a no-ball?');

  if (v('pitched') === 'outside_leg') notOut.push('Pitched outside leg stump.');
  else if (v('pitched') === 'unsure') missing.push('Where did it pitch?');
  else ok.push(v('pitched') === 'full_toss' ? 'Full toss.' : 'Pitched in line or outside off.');

  if (v('batFirst') === 'yes') notOut.push('Hit the bat first.');
  else if (v('batFirst') === 'no') ok.push('Pad/body first.');
  else missing.push('Did it hit the bat first?');

  if (v('impact') === 'outside_leg') notOut.push('Impact outside leg stump.');
  else if (v('impact') === 'in_line') ok.push('Impact in line.');
  else if (v('impact') === 'outside_off') {
    if (v('shot') === 'yes') notOut.push('Impact outside off while playing a shot.');
    else if (v('shot') === 'no') ok.push('Impact outside off, no shot offered.');
    else missing.push('Did the batter try to play a shot?');
  } else missing.push('Where did it hit the batter?');

  if (v('hitting') === 'no') notOut.push('Ball was missing the stumps.');
  else if (v('hitting') === 'yes') ok.push('Ball was hitting the stumps.');
  else missing.push('Would it have hit the stumps?');

  if (notOut.length) return { verdict: 'NOT OUT', reasons: notOut, missing: [] };
  if (missing.length) return { verdict: 'INCONCLUSIVE', reasons: ok, missing };
  return { verdict: 'OUT', reasons: ok, missing: [] };
}
