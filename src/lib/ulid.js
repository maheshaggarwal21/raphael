import { randomBytes } from 'node:crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()) {
  let ts = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = B32[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += B32[rnd[i] % 32];
  return ts + out;
}

// EVERY id prefix Raphael mints, in ONE place. scrub.js builds its
// high-entropy exemption from this list, so adding an id family can never again
// silently omit the exemption: `dec_` was minted from 16.8 onward but never
// added to the hand-maintained copy in scrub.js, so decision ids were scrubbed
// as secrets and every cross-reference to one was mangled (audit 2026-07-26).
export const ID_PREFIXES = ['les', 'ev', 'prj', 'mch', 'adp', 'dec'];

export function lessonId(now) {
  return `les_${ulid(now)}`;
}

export function evidenceId(now) {
  return `ev_${ulid(now)}`;
}

export function adoptionId(now) {
  return `adp_${ulid(now)}`;
}

export function decisionId(now) {
  return `dec_${ulid(now)}`;
}
