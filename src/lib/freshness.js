// Freshness lint + retire heuristics (Phase 16.6, docs/atlas-upgrade-plan.md).
// A read-only advisory pass over the brain's ACTIVE lessons that surfaces three
// kinds of rot — all HUMAN-SURFACED, never auto-deleted (a lesson is only ever
// retired by an explicit human action, 16.6b):
//
//   1. freshness  — the timeless/dated/pointer rule. A good lesson states a
//      timeless principle; one pinned to a version, a date, or "currently" will
//      rot. Warn-only, because a dated lesson is sometimes legitimately dated.
//   2. staleness  — ATLAS-PROVABLE: a lesson whose referenced file no longer
//      exists in the project's deterministic graph. Stronger than a plain fs
//      check (the graph is the project's real surface). Skipped when no atlas is
//      built for the project (capability-check: never claim staleness we can't prove).
//   3. contradiction — two active lessons on the same topic giving opposite
//      advice. Conservative + clearly labelled "possible" (it is a review aid).
//
// Pure functions over plain lesson objects (the full parsed data, incl. the
// `lesson` body) so the whole thing is testable without disk. Zero model tokens.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseLessonFile } from './frontmatter.js';
import { mapFileName } from './map.js';
import { p } from './paths.js';

// --- 1. freshness (dated / pointer) ---------------------------------------

const DATED_PATTERNS = [
  { signal: 'dated', why: 'names a specific year', re: /\b(19|20)\d{2}\b/ },
  { signal: 'dated', why: 'pins a version number', re: /\bv?\d+\.\d+(?:\.\d+)+\b/ },
  { signal: 'dated', why: 'uses time-relative wording', re: /\b(currently|as of|at the moment|right now|nowadays|these days|for now|at present|the latest|newest version|current version)\b/i }
];
const POINTER_PATTERNS = [
  { signal: 'pointer', why: 'points at a line number', re: /\b(?:line|:)\s?\d{1,5}\b/i },
  { signal: 'pointer', why: 'left an unresolved marker', re: /\b(TODO|FIXME|HACK|XXX)\b/ }
];

export function lintFreshness(lesson) {
  const text = lessonText(lesson);
  const out = [];
  for (const pat of [...DATED_PATTERNS, ...POINTER_PATTERNS]) {
    const m = pat.re.exec(text);
    if (m) out.push({ kind: 'freshness', signal: pat.signal, why: pat.why, evidence: m[0] });
  }
  return out;
}

// --- 2. staleness (atlas-provable) ----------------------------------------

// Only the file types the atlas actually indexes are "atlas-checkable" — a
// staleness claim is only honest for paths the graph could contain. Bare words
// ("config", "settings"), dotfiles (".env"), and unindexed types (.json/.yaml,
// which the atlas does not extract) are NOT checkable and never flagged stale.
const ATLAS_EXT = 'js|mjs|cjs|ts|mts|tsx|jsx|py|md|markdown|txt';
const PATH_TOKEN = new RegExp(`\\b[\\w][\\w.-]*(?:\\/[\\w.-]+)*\\.(?:${ATLAS_EXT})\\b`, 'g');
const CHECKABLE = new RegExp(`\\.(?:${ATLAS_EXT})$`, 'i');

// Every distinct atlas-checkable file path a lesson references: explicit
// triggers.paths plus any indexed-source token in the title/body. Paths the
// atlas can't verify are dropped here so staleness stays provable, not guessed.
export function referencedPaths(lesson) {
  const fromTriggers = (lesson.triggers?.paths ?? []).filter((rp) => CHECKABLE.test(String(rp)));
  const fromText = lessonText(lesson).match(PATH_TOKEN) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of [...fromTriggers, ...fromText]) {
    const rp = String(raw).trim().replace(/^\.\//, '');
    if (!rp || seen.has(rp)) continue;
    seen.add(rp);
    out.push(rp);
  }
  return out;
}

// Given the set of file labels in the atlas, classify one referenced path.
// 'present' = exact/suffix match; 'moved' = only the basename survives elsewhere;
// 'gone' = the atlas has no trace of it (the provable-stale case).
export function classifyPath(rp, atlasFiles) {
  const base = rp.split('/').pop();
  let movedHit = null;
  for (const label of atlasFiles) {
    if (label === rp || label.endsWith('/' + rp) || rp.endsWith('/' + label) || rp === label) return { status: 'present' };
    if (label.split('/').pop() === base) movedHit = label;
  }
  return movedHit ? { status: 'moved', at: movedHit } : { status: 'gone' };
}

export function lintStaleness(lesson, atlasFiles) {
  if (!atlasFiles || !atlasFiles.length) return []; // can't prove staleness with no graph
  const out = [];
  for (const rp of referencedPaths(lesson)) {
    const c = classifyPath(rp, atlasFiles);
    if (c.status === 'gone') out.push({ kind: 'staleness', severity: 'stale', path: rp, why: 'no file in the project atlas matches this path' });
    else if (c.status === 'moved') out.push({ kind: 'staleness', severity: 'moved', path: rp, at: c.at, why: `no exact match; a same-named file exists at ${c.at}` });
  }
  return out;
}

// --- 3. contradiction (conservative, human-surfaced) ----------------------

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'when', 'always', 'never', 'must', 'should', 'avoid']);
const NEG_MARKERS = "never|avoid|don't|dont|do not|no longer|without|instead of|stop|not";
const POS_MARKERS = 'always|must|should|prefer|use|require|ensure';

function keywordSet(lesson) {
  const kws = (lesson.triggers?.keywords ?? []).map((k) => k.toLowerCase());
  const slugTokens = (lesson.slug ?? '').split('-').filter((t) => t.length >= 4 && !STOP.has(t));
  return new Set([...kws, ...slugTokens].filter((t) => t.length >= 3 && !STOP.has(t)));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The polarity of the directive `text` gives ABOUT `term`: a marker must sit
// within two words BEFORE an occurrence of the term (directives precede their
// object — "never use X", "always store X"), so a negation binds to its real
// object instead of leaking to a nearby noun ("never use floats for money" is
// NEG about floats, not about money). Negation dominates a co-located positive
// ("never use" is not a use directive). Returns 'NEG' | 'POS' | null.
function polarityFor(text, term) {
  const t = escapeRe(term);
  const near = (markers) => new RegExp(`\\b(?:${markers})\\b(?:\\s+\\w+){0,2}\\s+${t}\\w*`, 'i');
  if (near(NEG_MARKERS).test(text)) return 'NEG';
  if (near(POS_MARKERS).test(text)) return 'POS';
  return null;
}

export function findContradictions(lessons) {
  const prepped = lessons.map((l) => ({ l, kws: keywordSet(l), text: lessonText(l) }));
  const out = [];
  for (let i = 0; i < prepped.length; i++) {
    for (let j = i + 1; j < prepped.length; j++) {
      const a = prepped[i];
      const b = prepped[j];
      const shared = [...a.kws].filter((k) => b.kws.has(k));
      if (shared.length < 2) continue;
      // A polarity flip on at least one shared term: both give a directive about
      // it, and the directives are opposite.
      const flip = shared.find((term) => {
        const pa = polarityFor(a.text, term);
        const pb = polarityFor(b.text, term);
        return pa && pb && pa !== pb;
      });
      if (!flip) continue;
      out.push({
        kind: 'contradiction',
        a: { id: a.l.id, slug: a.l.slug },
        b: { id: b.l.id, slug: b.l.slug },
        shared,
        term: flip,
        why: `both concern "${flip}" but give opposite advice — review which one holds`
      });
    }
  }
  return out;
}

// --- combined report -------------------------------------------------------

export function lintLessons(lessons, { atlasFiles = null } = {}) {
  const perLesson = lessons.map((l) => {
    const findings = [...lintFreshness(l), ...lintStaleness(l, atlasFiles)];
    return { id: l.id, slug: l.slug, category: l.category, severity: l.severity, findings };
  }).filter((r) => r.findings.length);

  const contradictions = findContradictions(lessons);

  return {
    lessonCount: lessons.length,
    atlasChecked: !!(atlasFiles && atlasFiles.length),
    lessons: perLesson,
    contradictions,
    counts: {
      freshness: perLesson.reduce((n, r) => n + r.findings.filter((f) => f.kind === 'freshness').length, 0),
      staleness: perLesson.reduce((n, r) => n + r.findings.filter((f) => f.kind === 'staleness').length, 0),
      contradiction: contradictions.length
    }
  };
}

export function renderLint(rep) {
  const L = [];
  L.push(`raph lint — freshness + staleness + contradiction over ${rep.lessonCount} active lesson(s)`);
  L.push(`  (advisory only — nothing is changed; retire a lesson yourself with "raph retire <id>")`);

  if (!rep.lessons.length && !rep.contradictions.length) {
    L.push('');
    L.push('  clean — no dated/pointer wording, no atlas-stale paths, no contradictions found.');
    if (!rep.atlasChecked) L.push('  (staleness skipped: no atlas built for this project — run "raph atlas" to enable it.)');
    return L.join('\n');
  }

  if (rep.counts.staleness || rep.atlasChecked === false) {
    L.push('');
    L.push('Staleness (atlas-provable)');
    if (!rep.atlasChecked) {
      L.push('  skipped — no atlas for this project. Run "raph atlas" first, then re-lint.');
    } else if (!rep.counts.staleness) {
      L.push('  none — every referenced file still exists in the atlas.');
    } else {
      for (const r of rep.lessons) {
        for (const f of r.findings.filter((x) => x.kind === 'staleness')) {
          L.push(`  ${f.severity === 'gone' || f.severity === 'stale' ? 'STALE' : 'MOVED'}  ${r.slug}  ->  ${f.path}${f.at ? ` (now ${f.at}?)` : ''}`);
        }
      }
    }
  }

  if (rep.counts.freshness) {
    L.push('');
    L.push('Freshness (timeless vs dated/pointer — warn only)');
    for (const r of rep.lessons) {
      for (const f of r.findings.filter((x) => x.kind === 'freshness')) {
        L.push(`  ${f.signal.toUpperCase().padEnd(7)} ${r.slug}  — ${f.why}: "${f.evidence}"`);
      }
    }
  }

  if (rep.counts.contradiction) {
    L.push('');
    L.push('Possible contradictions (review — not auto-resolved)');
    for (const c of rep.contradictions) {
      L.push(`  ${c.a.slug}  ⟷  ${c.b.slug}   (both on "${c.term}")`);
    }
  }

  L.push('');
  L.push(`Totals: ${rep.counts.staleness} stale/moved · ${rep.counts.freshness} freshness · ${rep.counts.contradiction} contradiction(s).`);
  L.push('Fix a stale trigger by editing the lesson, or retire a lesson that no longer holds: "raph retire <id|slug>".');
  return L.join('\n');
}

// --- disk wrappers (the CLI verb calls these) -----------------------------

function lessonText(lesson) {
  return [lesson.title, lesson.lesson, lesson.counter_indications].filter(Boolean).join('\n');
}

// Read every ACTIVE lesson's full data from the brain (the compiled index drops
// the `lesson` body, which the linter needs). Corrupt files are skipped.
export function readActiveLessons() {
  const root = p.lessons();
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.md')) {
        try {
          const { data } = parseLessonFile(readFileSync(full, 'utf8'));
          if (data.status === 'active') out.push(data);
        } catch {
          continue;
        }
      }
    }
  }
  return out.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
}

// The atlas file labels for a project dir, or null when no atlas is built.
export function atlasFileLabels(projectDir) {
  const file = path.join(p.atlas(), `${mapFileName(path.basename(projectDir))}.json`);
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    return (doc.nodes ?? []).filter((n) => n.type === 'file').map((n) => n.label);
  } catch {
    return null;
  }
}
