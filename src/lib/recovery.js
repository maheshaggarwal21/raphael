// The recovery layer's declared table (Phase 23, commitment 3 — "strict
// escalation"). Pure data plus, from 23.4, the pure classifier that reads a
// stage result and names the failure class.
//
// This lives in its own module on purpose. Commitment 2 ("separated layers")
// only means something if the EXECUTION layer cannot see the RECOVERY layer:
// a runner that knows the failure class has already chosen the recovery action.
// So the stage runner never imports this file, and a test asserts that.
//
// Reading the numbers back in a test proves nothing, so the tests assert the
// behaviour derived from them (a non-escalatable node gets no model attempts;
// every class combined still stops at MAX_NODE_ATTEMPTS) rather than the
// contents of the table.

// class    — what went wrong, named by classifyFailure() (23.4) from raw facts.
// max      — how many attempts of THIS class are allowed, per node VISIT.
// per      — the scope of `max`. Declared explicitly because the draft of this
//            design said "max: 3" without saying max per what, and a per-node
//            counter would make a node that escalated on visit 1 unable to
//            escalate on visit 2 — its genuine failure falling through to
//            `failed`. That is a real bug in the pre-graph driver
//            (`retry_escalated` is set permanently on the stage record).
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
  infra: Object.freeze({ max: 1, per: 'visit', action: 'retry',
    why: 'a spawn or envelope failure is environmental, not a reasoning problem' })
});

export const FAILURE_CLASSES = Object.freeze(Object.keys(RECOVERY));

// The ONLY producer of a failure class.
//
// This is why `failureClass` is banned from the stage runner's return value: the
// RECOVERY table above is keyed by it, one-to-one with an action, so a runner
// that emitted `failureClass: 'timeout'` would already have chosen `resume`.
// That is the execution layer making a recovery decision, which is precisely the
// separation commitment 2 asks for. The runner emits raw observations; this pure
// function turns them into a class; the table turns the class into an action.
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
  if (result.gateFailed) return 'gate';
  if (result.verdictFailed) return 'verdict';
  if (result.verifyFailed) return 'verify';
  return 'model';
}

// Total spawns allowed for one node VISIT, all classes combined.
//
// Why a second bound on top of the per-class ones: six independent counters with
// no composition rule let a single node burn 3+1+2+1+1 = 8 spawns while every
// individual bound is respected — the exact token blow-out commitment 3 exists
// to prevent, reintroduced in the seam between the classes. This is checked
// BEFORE class dispatch, so it is the ceiling no combination can climb over.
export const MAX_NODE_ATTEMPTS = 5;
