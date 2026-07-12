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

export function lessonId(now) {
  return `les_${ulid(now)}`;
}

export function evidenceId(now) {
  return `ev_${ulid(now)}`;
}
