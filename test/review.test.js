import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import approve from '../src/commands/approve.js';
import reject from '../src/commands/reject.js';
import { listCandidates, resolveRef, needsConfirmation } from '../src/lib/queue.js';
import { writeCandidate } from '../src/lib/candidates.js';
import { validateLesson } from '../src/lib/validate.js';
import { distillEpisodes } from '../src/lib/distill.js';
import { parseLessonFile } from '../src/lib/frontmatter.js';
import { p } from '../src/lib/paths.js';
import { lessonId } from '../src/lib/ulid.js';

async function withSandbox(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'raph-review-'));
  const prev = process.env.RAPHAEL_HOME;
  process.env.RAPHAEL_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.RAPHAEL_HOME;
    else process.env.RAPHAEL_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function candidateData(over = {}) {
  return {
    schema: 'raphael/lesson/v1',
    id: lessonId(),
    slug: over.slug ?? 'webhook-idempotency',
    title: over.title ?? 'Webhook handlers must dedupe on event id',
    status: 'candidate',
    category: over.category ?? 'correctness',
    severity: over.severity ?? 'high',
    scope: { stacks: ['node'], task_kinds: [], projects: [], agents: [] },
    triggers: { keywords: ['webhook'], paths: [] },
    lesson:
      over.lesson ??
      'Payment providers redeliver webhook events; handlers without event-id dedup produce duplicate side effects such as double charges.',
    evidence: {
      refs: [],
      observations: 1,
      distinct_projects: 1,
      source_mix: { mined: 1 },
      first_seen: '2026-07-13',
      last_seen: '2026-07-13'
    },
    provenance: {
      created_by: 'raphael/test',
      source_kind: 'session-transcript',
      human_edited: false,
      tier: 'user'
    },
    injection: {
      headline: over.headline ?? 'Webhook redelivery caused a double charge — handler had no event-id dedup.',
      tokens: 20
    },
    ...over.extra
  };
}

function activeLessons() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(p.lessons());
  return out;
}

test('queue lists candidates sorted by severity, quarantined flagged', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData({ slug: 'low-one', severity: 'low', title: 'A perfectly fine low-severity lesson', lesson: 'Background jobs without retry backoff hammer downstream services during partial outages and worsen them.', headline: 'Background job retried without backoff and worsened the outage window.' }));
    writeCandidate(candidateData({ slug: 'crit-one', severity: 'critical', title: 'A critical lesson about migrations', lesson: 'Renaming a column and deploying app code in one step breaks the old code still running during rollout; expand-and-contract avoids it.', headline: 'Column rename during rolling deploy broke the still-running old version.' }));
    const items = listCandidates();
    assert.equal(items.length, 2);
    assert.equal(items[0].data.severity, 'critical');
    assert.equal(resolveRef(items, '1').data.slug, 'crit-one');
    assert.equal(resolveRef(items, 'low-one').data.slug, 'low-one');
    assert.throws(() => resolveRef(items, 'nope'), /E-NOTFOUND/);
  });
});

test('approve moves a candidate into the brain as an active lesson', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData());
    const code = await approve(['1']);
    assert.equal(code, 0);
    assert.equal(readdirSync(p.candidates()).filter((f) => f.endsWith('.md')).length, 0);
    const files = activeLessons();
    assert.equal(files.length, 1);
    assert.ok(files[0].includes(path.join('lessons', 'correctness')));
    const r = validateLesson(readFileSync(files[0], 'utf8'));
    assert.equal(r.ok, true);
    assert.equal(r.data.status, 'active');
    assert.ok(readFileSync(p.events(), 'utf8').includes('"approved"'));
  });
});

test('approving an already-active slug/id is a friendly no-op', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData());
    await approve(['1']);
    const again = await approve(['webhook-idempotency']);
    assert.equal(again, 0);
    assert.equal(activeLessons().length, 1);
  });
});

test('security candidates: no batch approve, no approve without --confirmed', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData({ slug: 'sec-one', category: 'security', title: 'JWT middleware must reject alg none tokens', lesson: 'JWT libraries accepting the alg none header let forged tokens pass verification unless the algorithm allowlist is explicit.', headline: 'Forged JWT with alg none passed verification — no algorithm allowlist.' }));
    writeCandidate(candidateData());

    // batch containing a security item: that item refused, other approved
    const batch = await approve(['1', '2']);
    assert.equal(batch, 1);
    assert.equal(activeLessons().length, 1); // only the correctness one landed
    assert.equal(listCandidates().length, 1); // security one still queued

    // single, but unconfirmed
    const unconfirmed = await approve(['sec-one']);
    assert.equal(unconfirmed, 1);
    assert.equal(listCandidates().length, 1);

    // single + confirmed
    const ok = await approve(['sec-one', '--confirmed']);
    assert.equal(ok, 0);
    assert.equal(listCandidates().length, 0);
    assert.equal(activeLessons().length, 2);
  });
});

test('quarantined candidates need the same confirmation path', async () => {
  await withSandbox(async () => {
    const q = writeCandidate(candidateData({
      slug: 'imperative-one',
      title: 'Imperative-voiced lesson for the quarantine test',
      lesson: 'You must always dedupe webhook events before applying any state change to the billing tables.',
      headline: 'Imperative-voiced candidate that lands in quarantine for review.'
    }));
    assert.equal(q.quarantined, true);
    const items = listCandidates();
    assert.equal(items[0].quarantined, true);
    assert.equal(needsConfirmation(items[0]), true);
    assert.equal(await approve(['1']), 1);
    assert.equal(await approve(['1', '--confirmed']), 0);
    assert.equal(activeLessons().length, 1);
  });
});

test('slug collision with an active lesson is refused', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData());
    await approve(['1']);
    writeCandidate(candidateData({ lesson: 'Payment providers redeliver webhook events again; a second phrasing of the same slug to trigger the collision path in approve.', headline: 'Second candidate with a colliding slug for the collision test.' }));
    const code = await approve(['1']);
    assert.equal(code, 1);
    assert.equal(listCandidates().length, 1); // still queued, nothing lost
  });
});

test('reject writes a tombstone that distill then uses to auto-suppress', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData());
    const code = await reject(['1', '--reason', 'dup of team convention']);
    assert.equal(code, 0);
    assert.equal(listCandidates().length, 0);

    const tomb = JSON.parse(readFileSync(p.rejectedMemory(), 'utf8').trim());
    assert.equal(tomb.slug, 'webhook-idempotency');
    assert.equal(tomb.reason, 'dup of team convention');
    assert.ok(tomb.text.includes('duplicate side effects'));

    // full circle: distill proposes a near-identical lesson -> suppressed
    const episode = {
      episode_id: 'ep_0123456789abcdef',
      type: 'error-fix',
      project: 'demo',
      session_id: 's',
      source: { path: 'C:\\fake\\s.jsonl', line_span: [1, 2] },
      ts: '2026-07-13T10:00:00Z',
      excerpt: 'x'
    };
    const fake = async () => ({
      has_lesson: true,
      reason: 'x',
      candidate: {
        title: 'Webhook handlers must dedupe on event id',
        category: 'correctness',
        severity: 'high',
        lesson:
          'Payment providers redeliver webhook events; handlers without event-id dedup produce duplicate side effects such as double charges.',
        headline: 'Webhook redelivery caused a double charge — handler had no event-id dedup.'
      }
    });
    const results = await distillEpisodes([episode], { callModel: fake, config: {} });
    assert.equal(results[0].outcome, 'suppressed');
    assert.ok(readFileSync(p.events(), 'utf8').includes('suppressed-by-rejection-memory'));
  });
});

test('reject works WITHOUT --reason (regression: flag-index math ate the first ref)', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData());
    const code = await reject(['1']);
    assert.equal(code, 0);
    assert.equal(listCandidates().length, 0);
    const tomb = JSON.parse(readFileSync(p.rejectedMemory(), 'utf8').trim());
    assert.equal(tomb.slug, 'webhook-idempotency');
    assert.equal(tomb.reason, null);
  });
});

test('approved lessons keep their body and survive a parse roundtrip', async () => {
  await withSandbox(async () => {
    writeCandidate(candidateData(), '## Notes\nHand-written context worth keeping.');
    await approve(['1']);
    const file = activeLessons()[0];
    const { body } = parseLessonFile(readFileSync(file, 'utf8'));
    assert.ok(body.includes('Hand-written context worth keeping.'));
  });
});
