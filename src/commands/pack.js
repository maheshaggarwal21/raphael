// `raph pack` — install a curated lesson pack into the brain as reviewable
// candidates. Cold-start value: a fresh brain knows nothing until the user has
// mined their own history, so a professionally-distilled pack gives the recall
// engine something worth injecting on day one.
//
// Every pack lesson goes through writeCandidate() → validateLesson() (the one
// chokepoint) exactly like a mined or hand-written lesson. Packs land as
// CANDIDATES, never active: security lessons in particular can never be
// machine-activated, so a human reviews and approves them via `raph queue` /
// `raph approve`. Nothing here bypasses a single invariant.

import { buildSecurityPack, PACK_SPECS } from '../lib/security-pack.js';
import { writeCandidate } from '../lib/candidates.js';

const PACKS = {
  security: {
    title: 'Security starter pack',
    blurb: 'The mistakes that cause most real-world breaches in shipped apps.',
    build: buildSecurityPack,
    specs: PACK_SPECS
  }
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function listPacks() {
  console.log('raph packs — curated lesson packs you can seed into the brain:\n');
  for (const [name, pack] of Object.entries(PACKS)) {
    console.log(`  ${name}  (${pack.specs.length} lessons) — ${pack.title}`);
    console.log(`      ${pack.blurb}`);
  }
  console.log('\ninstall with:  raph pack add <name>        (adds them as reviewable candidates)');
  console.log('preview with:  raph pack add <name> --dry-run');
  return 0;
}

function addPack(name, { dryRun }) {
  const pack = PACKS[name];
  if (!pack) {
    console.error(`raph: no pack "${name}" — available: ${Object.keys(PACKS).join(', ')}`);
    return 1;
  }

  const lessons = pack.build({ today: today() });

  if (dryRun) {
    console.log(`raph: ${name} pack — ${lessons.length} lesson(s) (dry run, nothing written):\n`);
    for (const l of lessons) console.log(`  [${l.severity.padEnd(8)}] ${l.title}`);
    console.log('\nremove --dry-run to add them as candidates for review.');
    return 0;
  }

  let added = 0;
  let existed = 0;
  let quarantined = 0;
  const failures = [];
  for (const data of lessons) {
    try {
      const res = writeCandidate(data);
      if (res.existed) existed++;
      else if (res.quarantined) {
        quarantined++;
        console.log(`  QUARANTINED  ${data.slug} -> ${res.path}`);
      } else added++;
    } catch (err) {
      // A pack lesson that the chokepoint rejects is a bug in the pack, surfaced
      // loudly rather than silently dropped.
      failures.push(`${data.slug}: ${err.message}`);
    }
  }

  console.log(`raph: ${name} pack installed — ${added} new candidate(s), ${existed} already present, ${quarantined} quarantined.`);
  if (failures.length) {
    console.error(`\nraph: ${failures.length} lesson(s) rejected by the chokepoint:`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log('      review them with `raph queue`, then activate with `raph approve <id>` (security needs a human).');
  return 0;
}

export default async function pack(args) {
  const sub = args[0];
  const dryRun = args.includes('--dry-run');

  if (!sub || sub === 'list') return listPacks();
  if (sub === 'add') {
    const name = args.find((a, i) => i > 0 && !a.startsWith('--'));
    if (!name) {
      console.error('raph: usage: raph pack add <name> [--dry-run]');
      return 1;
    }
    return addPack(name, { dryRun });
  }

  console.error('raph: usage: raph pack [list | add <name> [--dry-run]]');
  return 1;
}
