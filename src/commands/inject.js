// The hook plumbing command: Claude Code hooks pipe their JSON payload to
// `raph inject --event session-start|user-prompt` and whatever this prints
// becomes context. Contract: ALWAYS exit 0, print nothing on any problem —
// a broken brain must never block or slow the user's real session.

import { safeInject } from '../lib/inject.js';

async function readStdinJson() {
  // interactive terminal (manual run): no payload is coming — don't hang
  if (process.stdin.isTTY) return {};
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default async function inject(args) {
  try {
    const i = args.indexOf('--event');
    const event = i >= 0 ? args[i + 1] : null;
    if (!event) return 0;
    const payload = await readStdinJson();
    const { text } = safeInject(event, payload);
    if (text) console.log(text);
  } catch {
    // fail-open: swallow everything
  }
  return 0;
}
