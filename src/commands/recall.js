// `raph recall [quiet|normal|eager]` — the recall-assertiveness dial (18.3).
//
// Deliberately NOT the same dial as `raph auto`: that one governs what may
// ACTIVATE (a trust decision), this one governs how much of what is already
// active gets SPOKEN (a noise decision). Keeping them separate means turning
// recall down never quietly weakens a safety gate.

import { loadConfig, getRecallLevel, setRecallLevel, recallProfile, RECALL_LEVELS } from '../lib/config.js';

const BLURB = {
  quiet: 'only the strongest matches, at most 3 at session start and 1 per prompt',
  normal: 'the balanced default — up to 10 at session start, 3 per prompt',
  eager: 'widest coverage — up to 15 at session start, 5 per prompt, lower bar'
};

export default async function recall(args) {
  const wanted = args.find((a) => !a.startsWith('--'));

  if (!wanted) {
    const cfg = loadConfig();
    const level = getRecallLevel(cfg);
    const pr = recallProfile(cfg);
    console.log(`raph recall — how assertive recall is (separate from \`raph auto\`, which governs what may activate)\n`);
    for (const l of RECALL_LEVELS) {
      console.log(`  ${l === level ? '>' : ' '} ${l.padEnd(7)} ${BLURB[l]}`);
    }
    console.log(`\ncurrently: ${level} — session start ≤${pr.digestMax} lesson(s), per prompt ≤${pr.promptMax}, session cap ${pr.sessionCap} tokens`);
    console.log(`change it: raph recall <${RECALL_LEVELS.join('|')}>`);
    return 0;
  }

  try {
    const set = setRecallLevel(wanted);
    const pr = recallProfile();
    console.log(`raph: recall set to ${set} — ${BLURB[set]}`);
    console.log(`      session start ≤${pr.digestMax} lesson(s), per prompt ≤${pr.promptMax}, session cap ${pr.sessionCap} tokens`);
    return 0;
  } catch (err) {
    console.error(`raph: ${err.message}`);
    return 1;
  }
}
