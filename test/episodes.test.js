import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines, detectEpisodes } from '../src/lib/episodes.js';

// -- synthetic transcript builders (shapes verified against real transcripts) --

function userMsg(text, extra = {}) {
  return { type: 'user', message: { role: 'user', content: text }, timestamp: '2026-07-13T10:00:00Z', ...extra };
}
function assistantText(text, extra = {}) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra };
}
function assistantTool(name, input, id, extra = {}) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, ...extra };
}
function toolResult(content, isError, toolUseId, extra = {}) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
    timestamp: '2026-07-13T10:01:00Z',
    ...extra
  };
}
function jsonl(objects) {
  return objects.map((o) => JSON.stringify(o)).join('\n');
}
function detect(objects, over = {}) {
  const { events } = parseSessionLines(jsonl(objects));
  return detectEpisodes(events, { sessionPath: 'C:\\fake\\s.jsonl', sessionId: 's1', project: 'demo', ...over });
}

const CTX = ['error-fix and correction detection'];

test('parseSessionLines: counts bad lines, keeps good ones, 1-based line numbers', () => {
  const text = `${JSON.stringify(userMsg('hello there'))}\nNOT JSON AT ALL\n\n${JSON.stringify(assistantText('hi'))}`;
  const { events, badLines } = parseSessionLines(text);
  assert.equal(badLines, 1);
  assert.equal(events.length, 2);
  assert.equal(events[0].line, 1);
  assert.equal(events[1].line, 4);
});

test('error followed by fix becomes one error-fix episode', () => {
  const eps = detect([
    userMsg('please run the tests'),
    assistantTool('Bash', { command: 'npm test' }, 'tu1'),
    toolResult('Exit code 1\nTypeError: out.designs is not iterable', true, 'tu1'),
    assistantText('The result is nested under .result — let me fix the accessor.'),
    assistantTool('Bash', { command: 'npm test' }, 'tu2'),
    toolResult('24 passing', false, 'tu2')
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, 'error-fix');
  assert.equal(eps[0].meta.tool, 'Bash');
  assert.deepEqual(eps[0].source.line_span, [3, 6]);
  assert.ok(eps[0].excerpt.includes('not iterable'));
  assert.ok(eps[0].excerpt.includes('[success]'));
  assert.match(eps[0].episode_id, /^ep_[0-9a-f]{16}$/);
});

test('error with no subsequent success is not an episode', () => {
  const eps = detect([
    assistantTool('Bash', { command: 'boom' }, 'tu1'),
    toolResult('fatal: everything broke', true, 'tu1'),
    assistantText('I could not recover from this.')
  ]);
  assert.equal(eps.length, 0);
});

test('user corrections are detected with the right markers', () => {
  const eps = detect([
    assistantText('I renamed the config file to settings.json.'),
    userMsg("that's wrong, keep the original name"),
    assistantText('Reverting the rename now.')
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, 'user-correction');
  assert.ok(eps[0].excerpt.includes('keep the original name'));
  assert.deepEqual(eps[0].source.line_span, [1, 3]);

  const eps2 = detect([assistantText('Done.'), userMsg('why did you delete the tests?')]);
  assert.equal(eps2.length, 1);
  assert.equal(eps2[0].meta.marker.toLowerCase(), 'why did you');
});

test('pleasantries starting with "no" do not trigger corrections', () => {
  const eps = detect([assistantText('Sorry for the wait.'), userMsg('no problem at all, take your time')]);
  assert.equal(eps.length, 0);
  const eps2 = detect([assistantText('Should I use tabs?'), userMsg('No, use spaces')]);
  assert.equal(eps2.length, 1);
});

test('long messages that merely open with a marker are not corrections', () => {
  const eps = detect([assistantText('Plan drafted.'), userMsg('stop ' + 'x'.repeat(450))]);
  assert.equal(eps.length, 0);
});

test('secrets in error content are scrubbed out of excerpts', () => {
  const eps = detect([
    assistantTool('Bash', { command: 'deploy' }, 'tu1'),
    toolResult('auth failed for key AKIAIOSFODNN7EXAMPLE, rotate it', true, 'tu1'),
    toolResult('deploy ok', false, 'tu2')
  ]);
  assert.equal(eps.length, 1);
  assert.ok(!eps[0].excerpt.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(eps[0].excerpt.includes('<SECRET:aws-key>'));
});

test('sidechain events are ignored entirely', () => {
  const eps = detect([
    assistantTool('Bash', { command: 'x' }, 'tu1', { isSidechain: true }),
    toolResult('boom', true, 'tu1', { isSidechain: true }),
    toolResult('fine', false, 'tu2', { isSidechain: true }),
    assistantText('main chain only.'),
    userMsg('undo that rename please')
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, 'user-correction');
});

test('episode ids are deterministic and content-addressed', () => {
  const objects = [
    assistantTool('Bash', { command: 'npm test' }, 'tu1'),
    toolResult('Exit 1: ReferenceError', true, 'tu1'),
    toolResult('all green', false, 'tu2')
  ];
  const a = detect(objects);
  const b = detect(objects);
  assert.equal(a[0].episode_id, b[0].episode_id);
});

test('excerpts respect the cap with a truncation suffix', () => {
  const eps = detect([
    assistantTool('Bash', { command: 'big' }, 'tu1'),
    toolResult('E '.repeat(2000) + 'boom', true, 'tu1'),
    assistantText('word '.repeat(1500)),
    toolResult('done', false, 'tu2')
  ]);
  assert.equal(eps.length, 1);
  assert.ok(eps[0].excerpt.length <= 6000);
});

test('success inside the same event (parallel tool results) counts as the fix', () => {
  const eps = detect([
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'first call failed' },
          { type: 'tool_result', tool_use_id: 'b', is_error: false, content: 'second call fine' }
        ]
      }
    }
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, 'error-fix');
});
