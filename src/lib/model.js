// The ONLY network surface in Raphael: direct calls to the Anthropic Messages
// API. No SDK dependency (Node 18+ fetch). Structured output is enforced by
// defining exactly one tool and forcing tool_choice — and because the request
// defines no other tools, the model is architecturally incapable of executing
// anything. That is the containment for adversarial episode content.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const TIMEOUT_MS = 90000;
const RETRY_DELAYS_MS = [2000, 8000];

export function apiKey() {
  return process.env.ANTHROPIC_API_KEY || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Returns the forced tool's input object. Throws E-MODEL on failure.
export async function callModel({ model, system, prompt, toolName, toolDescription, toolSchema, maxTokens = 1500 }) {
  const key = apiKey();
  if (!key) throw new Error('E-APIKEY: ANTHROPIC_API_KEY is not set');

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ name: toolName, description: toolDescription, input_schema: toolSchema }],
    tool_choice: { type: 'tool', name: toolName }
  });

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json'
        },
        body,
        signal: controller.signal
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`E-MODEL: API returned ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`E-MODEL: API returned ${res.status}: ${detail.slice(0, 300)}`);
      }
      const data = await res.json();
      const toolUse = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === toolName);
      if (!toolUse) throw new Error('E-MODEL: response contained no forced tool call');
      return toolUse.input;
    } catch (err) {
      if (err.message?.startsWith('E-MODEL: API returned 4')) throw err;
      if (err.message?.startsWith('E-MODEL: response contained')) throw err;
      lastErr = err.name === 'AbortError' ? new Error('E-MODEL: request timed out') : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error && lastErr.message.startsWith('E-MODEL')
    ? lastErr
    : new Error(`E-MODEL: ${lastErr?.message ?? 'request failed after retries'}`);
}
