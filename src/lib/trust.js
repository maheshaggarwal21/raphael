// 18.4 — trust at the point of action.
//
// The quarantine floor used to live in the docs. But the moment a human actually
// needs it is the moment something GETS quarantined: that is when they decide
// whether to look, ignore it, or force it through. So the guarantee is stated
// in-tool, right there, every time — and the specific thing that tripped it is
// named as its own visible flag rather than folded into one opaque verdict.
//
// Pure string building. No IO, so every surface (note, pack, adopt, console) can
// say exactly the same thing without duplicating the policy wording.

// The named flags, worst-first. Each is a DISTINCT reason a human should care
// about, not a single blended "suspicious" score.
const FLAGS = {
  'E-DENY': {
    flag: 'injection-shaped',
    why: 'the text tries to instruct an AI agent (override rules, run commands, claim authority)'
  },
  'E-UNICODE': {
    flag: 'hidden-characters',
    why: 'invisible or bidirectional unicode is present, which can hide text from a human reader'
  },
  'E-SECRET': {
    flag: 'secret-shaped',
    why: 'the text contains something shaped like a credential'
  },
  'E-URL': {
    flag: 'contains-a-link',
    why: 'lessons carry no URLs, so a link here is either a mistake or a lure'
  },
  'W-IMPERATIVE': {
    flag: 'agent-directed-voice',
    why: 'it reads as an order aimed at an agent rather than a durable observation'
  }
};

// What quarantine GUARANTEES. This is the part people need at the moment of
// decision, and it is the same in every mode — say it plainly, every time.
export const QUARANTINE_FLOOR = [
  'it can never activate on its own — not in autopilot, not at any dial setting',
  'only a human who has read the full body can ever approve it',
  'left alone it expires silently after 30 days; ignoring it is a safe default'
];

// Turn validation codes into the named flags that fired (deduped, worst-first).
export function quarantineFlags(codes = []) {
  const seen = new Set();
  const out = [];
  for (const code of Object.keys(FLAGS)) {
    if (codes.includes(code) && !seen.has(code)) {
      seen.add(code);
      out.push({ code, ...FLAGS[code] });
    }
  }
  return out;
}

// The full in-tool notice. `ref` is whatever the reader would type to inspect it.
export function quarantineNotice({ codes = [], ref = '', path: file = '' } = {}) {
  const flags = quarantineFlags(codes);
  const lines = ['QUARANTINED — held for a human, never activated automatically.'];
  if (file) lines.push(`  saved: ${file}`);
  if (flags.length) {
    lines.push('  flagged:');
    for (const f of flags) lines.push(`    [${f.flag}] ${f.why}`);
  } else {
    lines.push('    [unclassified] it tripped the chokepoint but not a named flag');
  }
  lines.push('  what this guarantees:');
  for (const g of QUARANTINE_FLOOR) lines.push(`    · ${g}`);
  if (ref) lines.push(`  read the full body before deciding:  raph show ${ref}`);
  return lines.join('\n');
}
