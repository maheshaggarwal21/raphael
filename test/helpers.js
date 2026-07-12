import { lessonId } from '../src/lib/ulid.js';
import { serializeLessonFile } from '../src/lib/frontmatter.js';

export function makeLesson(overrides = {}) {
  const base = {
    schema: 'raphael/lesson/v1',
    id: lessonId(),
    slug: 'webhook-idempotency',
    title: 'Webhook handlers must dedupe on event id',
    status: 'active',
    category: 'correctness',
    severity: 'high',
    scope: { stacks: ['node', 'stripe'], task_kinds: ['webhook-handler'], projects: [] },
    triggers: { keywords: ['webhook', 'idempoten'], paths: ['**/webhook*/**'] },
    lesson:
      'Payment providers redeliver webhook events; handlers without event-id dedup produced duplicate charges (seen 3x across 2 projects).',
    counter_indications: 'One-shot internal webhooks with no retry policy do not need a dedup table.',
    evidence: {
      refs: [],
      observations: 3,
      distinct_projects: 2,
      source_mix: { mined: 2, user_note: 1 },
      first_seen: '2026-05-02',
      last_seen: '2026-06-30'
    },
    provenance: {
      created_by: 'raphael/miner@0.1.0 (test)',
      source_kind: 'session-transcript',
      human_edited: false,
      tier: 'user'
    },
    injection: {
      headline: 'Prior incident (3x): webhook handler processed duplicate deliveries — no event-id dedup.',
      tokens: 22
    }
  };
  const data = { ...base, ...overrides };
  return serializeLessonFile(data);
}
