// The recovery layer's declared table — strict escalation, no unbounded
// retry. Pure data plus the pure classifier that reads a stage result and
// names the failure class.
//
// Lives in its own module so the execution layer provably cannot see it: a
// runner that knew the failure class would have already chosen the recovery
// action, which is what the stage runner is asserted never to import.
//
// Reading the numbers back in a test proves nothing, so the tests assert
// behaviour derived from them (a non-escalatable node gets no model attempts;
// every class combined still stops at MAX_NODE_ATTEMPTS) rather than the
// table's contents.

// class    — what went wrong, named by classifyFailure() from raw facts.
// max      — how many attempts of this class are allowed, per node visit.
// per      — the scope of `max`, declared explicitly: a per-node counter
//            would make a node that escalated on visit 1 unable to escalate
//            on visit 2, its genuine second failure falling through to `failed`.
// action   — the single recovery move for this class.
export const RECOVERY = Object.freeze({
  timeout: Object.freeze({ max: 3, per: 'visit', action: 'resume',
    why: 'work is on disk and the session is live — continue it, never restart' }),
  gate: Object.freeze({ max: 1, per: 'visit', action: 'restate',
    why: 'the deliverable was shaped wrong — restate the contract' }),
  verify: Object.freeze({ max: 2, per: 'visit', action: 'repair',
    why: 'the claim was false — hand the verifier output back and repair' }),
  verdict: Object.freeze({ max: 1, per: 'visit', action: 'restate',
    why: 'the verdict was unparseable — restate the verdict contract' }),
  model: Object.freeze({ max: 1, per: 'visit', action: 'escalate',
    why: 'one stronger pass — only if the node is escalatable' }),
  // 2 rather than 1: an infra failure is transient BY DEFINITION (a network
  // flap, an expired session), and a flap commonly outlasts a single retry.
  // Cheap to allow — a transport error fails in seconds — and MAX_NODE_ATTEMPTS
  // still caps the total. A genuinely permanent one (a revoked token) burns two
  // fast failures and then reaches a human with the real reason, which is the
  // correct outcome since no amount of retrying fixes it.
  infra: Object.freeze({ max: 2, per: 'visit', action: 'retry',
    why: 'a spawn or envelope failure is environmental, not a reasoning problem' })
});

export const FAILURE_CLASSES = Object.freeze(Object.keys(RECOVERY));

// The only producer of a failure class. This is why `failureClass` is banned
// from the stage runner's return value: RECOVERY is keyed by it one-to-one
// with an action, so a runner that emitted `failureClass: 'timeout'` would
// already have chosen `resume` — a recovery decision made by the execution
// layer. The runner emits raw observations; this turns them into a class; the
// table turns the class into an action.
//
// Order matters and is deliberate:
//   1. An interruption is not a failure — work is on disk and the session lives.
//   2. A child that never produced an envelope is environmental, not reasoning.
//   3. Shape first, then claim: a deliverable that is malformed has not earned a
//      verifier run, and a verdict that cannot be parsed cannot route.
//   4. Everything left is the model getting the work wrong.
export function classifyFailure(result = {}) {
  if (result.timedOut) return 'timeout';
  if (result.spawned === false) return 'infra';
  // A transport/auth failure reported by the CLI is environmental even though
  // the envelope parsed cleanly (`spawned` is true) — the model never saw the
  // request, so it cannot be the model's failure. Without this check, a
  // revoked token or a transient DNS blip classifies as `model`, sending a
  // non-escalatable node straight to a human or burning an opus escalation
  // trying to reason past a network error.
  if (result.apiError) return 'infra';
  if (result.gateFailed) return 'gate';
  if (result.verdictFailed) return 'verdict';
  if (result.verifyFailed) return 'verify';
  return 'model';
}

// Total spawns allowed for one node visit, all classes combined. Six
// independent per-class counters with no composition rule would let a node
// burn far more spawns than any individual bound suggests — checked before
// class dispatch, so it is the ceiling no combination can climb over.
export const MAX_NODE_ATTEMPTS = 5;
