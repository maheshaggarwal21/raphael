// Episode detectors: scan a Claude Code session transcript (JSONL) for
// mineable moments. Two detectors for v1: error-fix (a tool error followed by
// an eventual success) and user-correction (the user pushing back on the
// assistant). Every excerpt is secret-scrubbed BEFORE hashing or returning —
// no unscrubbed transcript text may leave this module.

import { createHash } from 'node:crypto';
import { scrubSecrets } from './scrub.js';

const WINDOW = 12; // error-fix looks at the anchor + up to the next 12 main-chain events
const ERROR_FIX_CAP = 6000;
const CORRECTION_CAP = 4000;
const ERROR_TEXT_CAP = 1500;
const TOOL_INPUT_CAP = 200;
const SNIPPET_CAP = 300;
const CORRECTION_MAX_LEN = 400;
const TRUNCATION_SUFFIX = '…[truncated]';

// Parse raw JSONL transcript text into { events, badLines }. Line numbers are
// 1-based against the original text. Empty/whitespace-only lines are skipped
// silently; unparseable or non-object lines are counted, never thrown on.
export function parseSessionLines(text) {
  if (typeof text !== 'string') {
    throw new Error('E-EPISODES: parseSessionLines expects a string');
  }
  const lines = text.split('\n');
  const events = [];
  let badLines = 0;
  for (let i = 0; i < lines.length; i++) {
    // tolerate CRLF transcripts on Windows
    const raw = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    if (raw.trim() === '') continue;
    try {
      const json = JSON.parse(raw);
      if (json === null || typeof json !== 'object' || Array.isArray(json)) {
        badLines++;
        continue;
      }
      events.push({ line: i + 1, json });
    } catch {
      badLines++;
    }
  }
  return { events, badLines };
}

function msgContent(json) {
  return json && json.message ? json.message.content : undefined;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((it) => it && it.type === 'text' && typeof it.text === 'string')
      .map((it) => it.text)
      .join('\n');
  }
  return '';
}

function toolResultItems(json) {
  const c = msgContent(json);
  if (!Array.isArray(c)) return [];
  return c.filter((it) => it && it.type === 'tool_result');
}

// tool_result content may be a plain string or an array of {type:'text',text}
function toolResultText(item) {
  const c = item.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((x) => x && x.type === 'text' && typeof x.text === 'string')
      .map((x) => x.text)
      .join('\n');
  }
  return '';
}

function clip(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// Compact one assistant event: text snippets plus tool_use name + first 200
// chars of its stringified input.
function summarizeAssistant(json) {
  const c = msgContent(json);
  const parts = [];
  if (typeof c === 'string') {
    if (c.trim()) parts.push(clip(c, SNIPPET_CAP));
  } else if (Array.isArray(c)) {
    for (const it of c) {
      if (!it) continue;
      if (it.type === 'text' && typeof it.text === 'string' && it.text.trim()) {
        parts.push(clip(it.text, SNIPPET_CAP));
      } else if (it.type === 'tool_use') {
        let inp;
        try {
          inp = JSON.stringify(it.input ?? {});
        } catch {
          inp = '[unserializable input]';
        }
        parts.push(`${it.name ?? 'tool'}(${String(inp).slice(0, TOOL_INPUT_CAP)})`);
      }
    }
  }
  return parts.join(' | ');
}

// Scrub, THEN truncate: truncating first could split a secret across the cut
// so the regex no longer matches, leaking a partial secret. Cutting a
// placeholder in half only loses the label, never secret bytes.
function finalizeExcerpt(raw, cap) {
  const normalized = raw.replace(/\r\n/g, '\n'); // CRLF->LF before hashing
  const { text } = scrubSecrets(normalized);
  if (text.length <= cap) return text;
  return text.slice(0, cap - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

// episode_id is content-addressed over the SCRUBBED excerpt so re-mining the
// same transcript can never mint a second id for the same episode.
function makeEpisode(type, excerpt, { project, sessionId, sessionPath, lineSpan, ts, meta }) {
  const hash = createHash('sha256').update(type + '\n' + excerpt, 'utf8').digest('hex');
  const ep = {
    schema: 'raphael/episode/v1',
    episode_id: 'ep_' + hash.slice(0, 16),
    type,
    project,
    session_id: sessionId,
    source: { path: sessionPath, line_span: lineSpan }
  };
  if (ts) ep.ts = ts;
  ep.excerpt = excerpt;
  ep.meta = meta;
  return ep;
}

// Resolve the tool name for a tool_result by walking BACKWARD to the
// assistant tool_use item with a matching id.
function resolveToolName(main, anchorIdx, toolUseId) {
  if (!toolUseId) return undefined;
  for (let j = anchorIdx - 1; j >= 0; j--) {
    const { json } = main[j];
    if (json.type !== 'assistant') continue;
    const c = msgContent(json);
    if (!Array.isArray(c)) continue;
    for (const it of c) {
      if (it && it.type === 'tool_use' && it.id === toolUseId) return it.name;
    }
  }
  return undefined;
}

// Correction markers. Deliberate deviation from a naive /^no\b/: "no" only
// counts when it stands alone or is set off by punctuation ("No, use tabs"),
// because /^no\b/ would fire on pleasantries like "no problem at all".
// This trades a little recall ("no wait" without a comma is missed) for far
// fewer false episodes. Additionally the whole trimmed message must be under
// 400 chars — long messages that merely open with a marker word are usually
// new instructions, not corrections.
const START_MARKER =
  /^(nope\b|not (?:that|this)\b|that'?s (?:wrong|not right)|wrong\b|revert\b|undo\b|stop\b|don'?t\b)/i;
const BARE_NO = /^no(?=$|\s*[,.!?:;—–-])/i;
const WHY_YOU = /\bwhy (?:did|are) you\b/i;

function matchCorrectionMarker(text) {
  const m1 = text.match(START_MARKER);
  if (m1) return m1[0];
  const mNo = text.match(BARE_NO);
  if (mNo) return mNo[0];
  const m2 = text.match(WHY_YOU);
  if (m2) return m2[0];
  return null;
}

// A "plain" user message: no tool_result items, has some text.
function plainUserText(json) {
  const c = msgContent(json);
  if (Array.isArray(c) && c.some((it) => it && it.type === 'tool_result')) return null;
  const text = textFromContent(c).trim();
  return text || null;
}

export function detectEpisodes(events, { sessionPath, sessionId, project } = {}) {
  if (!Array.isArray(events)) {
    throw new Error('E-EPISODES: detectEpisodes expects an array of events');
  }

  // main chain only: user/assistant, never sidechains (subagent threads)
  const main = events.filter(
    (e) =>
      e &&
      e.json &&
      (e.json.type === 'user' || e.json.type === 'assistant') &&
      e.json.isSidechain !== true
  );

  const found = []; // { anchorLine, ep }

  // ---- error-fix ----
  let i = 0;
  while (i < main.length) {
    const ev = main[i];
    if (ev.json.type !== 'user') {
      i++;
      continue;
    }
    const results = toolResultItems(ev.json);
    const errPos = results.findIndex((r) => r.is_error === true);
    if (errPos === -1) {
      i++;
      continue;
    }
    const errItem = results[errPos];
    const windowEnd = Math.min(main.length - 1, i + WINDOW);

    // find the first eventual success: a later tool_result with falsy is_error
    // (later items in the anchor event count — parallel tool results share a line)
    let successIdx = -1;
    let successItem = null;
    for (const r of results.slice(errPos + 1)) {
      if (!r.is_error) {
        successIdx = i;
        successItem = r;
        break;
      }
    }
    for (let j = i + 1; j <= windowEnd && successIdx === -1; j++) {
      for (const r of toolResultItems(main[j].json)) {
        if (!r.is_error) {
          successIdx = j;
          successItem = r;
          break;
        }
      }
    }
    if (successIdx === -1) {
      i++; // no fix in window: not an episode; the next event may anchor its own
      continue;
    }

    const toolName = resolveToolName(main, i, errItem.tool_use_id);
    const parts = [];
    parts.push(`[error${toolName ? ':' + toolName : ''}] ${toolResultText(errItem).slice(0, ERROR_TEXT_CAP)}`);
    for (let j = i + 1; j < successIdx; j++) {
      if (main[j].json.type !== 'assistant') continue;
      const s = summarizeAssistant(main[j].json);
      if (s) parts.push(`[assistant] ${s}`);
    }
    parts.push(`[success] ${clip(toolResultText(successItem), SNIPPET_CAP)}`);

    const excerpt = finalizeExcerpt(parts.join('\n'), ERROR_FIX_CAP);
    found.push({
      anchorLine: ev.line,
      ep: makeEpisode('error-fix', excerpt, {
        project,
        sessionId: sessionId ?? ev.json.sessionId,
        sessionPath,
        lineSpan: [ev.line, main[successIdx].line],
        ts: ev.json.timestamp,
        meta: toolName ? { tool: toolName } : {}
      })
    });
    i = windowEnd + 1; // no overlapping episodes: advance past the whole window
  }

  // ---- user-correction ----
  for (let k = 0; k < main.length; k++) {
    const ev = main[k];
    if (ev.json.type !== 'user') continue;
    const text = plainUserText(ev.json);
    if (!text || text.length >= CORRECTION_MAX_LEN) continue;
    const marker = matchCorrectionMarker(text);
    if (!marker) continue;

    let prevIdx = -1;
    for (let j = k - 1; j >= 0; j--) {
      if (main[j].json.type === 'assistant') {
        prevIdx = j;
        break;
      }
    }
    let nextIdx = -1;
    for (let j = k + 1; j < main.length; j++) {
      if (main[j].json.type === 'assistant') {
        nextIdx = j;
        break;
      }
    }

    const parts = [];
    if (prevIdx !== -1) {
      const s = summarizeAssistant(main[prevIdx].json);
      if (s) parts.push(`[assistant] ${s}`);
    }
    parts.push(`[correction] ${text}`);
    if (nextIdx !== -1) {
      const s = summarizeAssistant(main[nextIdx].json);
      if (s) parts.push(`[response] ${s}`);
    }

    const excerpt = finalizeExcerpt(parts.join('\n'), CORRECTION_CAP);
    found.push({
      anchorLine: ev.line,
      ep: makeEpisode('user-correction', excerpt, {
        project,
        sessionId: sessionId ?? ev.json.sessionId,
        sessionPath,
        lineSpan: [
          prevIdx !== -1 ? main[prevIdx].line : ev.line,
          nextIdx !== -1 ? main[nextIdx].line : ev.line
        ],
        ts: ev.json.timestamp,
        meta: { marker }
      })
    });
  }

  found.sort((a, b) => a.anchorLine - b.anchorLine || (a.ep.type < b.ep.type ? -1 : 1));
  return found.map((f) => f.ep);
}
