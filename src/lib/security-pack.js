// Curated security starter pack (ARCHITECTURE §11 — "cold-start value").
//
// A brand-new Raphael brain is empty, so it can only help once the user has mined
// enough of their own history. This pack seeds the brain with the mistakes that
// cause most real-world breaches in shipped apps, distilled from five professional
// audit checklists (Gitleaks-style secret scanning, Bearer-style PII flow, an ECC
// pre-deploy audit, Trail-of-Bits deep-logic review, and an attacker's-perspective
// pass). It is the same shape as any other lesson and enters the brain the same
// way — every entry goes through validateLesson() via writeCandidate(), lands as a
// reviewable CANDIDATE (never auto-active), is tagged category "security" (so
// E-AUTOSEC keeps it from ever machine-activating), and carries NO URLs. The tool
// names below are attribution only; nothing here is a link or an instruction.
//
// Voice rule: lessons are declarative statements of cause + fix, never commands at
// an agent ("Trusting client prices lets attackers set their own total; recompute
// server-side" — not "you must recompute"). That keeps them past the chokepoint's
// imperative/deny filters and true to invariant #3 (lessons are advisory data).

import { lessonId } from './ulid.js';

// Each spec is the minimal human-authored core; packLesson() expands it into a full
// valid lesson. severity ∈ critical|high|medium|low. agents route the lesson to the
// right specialist lens. Keep every field free of URLs, secrets, and "you must".
export const PACK_SPECS = [
  {
    slug: 'secrets-belong-in-env-vars',
    title: 'Keep secrets in environment variables, not source code',
    severity: 'critical',
    based_on: 'Gitleaks',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['secret', 'api key', 'token', 'credential', 'env', 'stripe', 'supabase', 'database url'],
    paths: ['.env', 'config', 'settings'],
    lesson:
      'API keys, tokens, database URLs, and passwords written as string literals in source, config, or comments are exposed the moment the repo is shared or the bundle ships. Every secret lives in an environment variable read at runtime; the source holds names, never values.',
    headline: 'Hardcoded secrets in source leak on share — read them from env vars instead.'
  },
  {
    slug: 'no-public-prefix-on-secret-env-vars',
    title: 'Never put a secret behind a browser-exposed env prefix',
    severity: 'high',
    based_on: 'Gitleaks',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['env', 'frontend', 'next_public', 'react_app', 'vite', 'browser', 'client'],
    lesson:
      'Build tools inline any variable prefixed with NEXT_PUBLIC_, REACT_APP_, or VITE_ straight into the browser bundle, where anyone viewing the page can read it. Only genuinely public values take those prefixes; a service-role or secret key behind one is fully exposed.',
    headline: 'A NEXT_PUBLIC_/VITE_ prefix ships the value to the browser — never for secret keys.'
  },
  {
    slug: 'rotate-secrets-that-touched-git',
    title: 'Rotate any secret that was ever committed to git',
    severity: 'high',
    based_on: 'Gitleaks',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['git', 'history', 'secret', 'rotate', 'commit', 'leak'],
    lesson:
      'Removing a secret from current code does not remove it from git history, where anyone with the repo can still recover it. A key, token, or password that was ever committed is compromised and stays valid until rotated at its provider.',
    headline: 'Deleting a leaked secret leaves it in git history — rotate it, do not just delete.'
  },
  {
    slug: 'hash-passwords-with-a-slow-kdf',
    title: 'Store passwords with a slow hash, never plain or fast hashes',
    severity: 'critical',
    based_on: 'Bearer',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['password', 'hash', 'bcrypt', 'argon2', 'scrypt', 'auth', 'login'],
    lesson:
      'Passwords kept in plaintext, or hashed with a fast algorithm like MD5 or SHA-256 alone, fall to offline cracking within hours of a database leak. A purpose-built slow hash — bcrypt, scrypt, or argon2 — is required, and the plaintext is never stored, logged, or returned.',
    headline: 'Plain or MD5/SHA-256 passwords crack fast after a leak — use bcrypt/scrypt/argon2.'
  },
  {
    slug: 'keep-pii-and-secrets-out-of-logs',
    title: 'Redact personal data and secrets before logging',
    severity: 'high',
    based_on: 'Bearer',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['log', 'logging', 'pii', 'redact', 'email', 'observability'],
    lesson:
      'Log lines that include full requests, headers, emails, phone numbers, or tokens copy that sensitive data into log storage and any third-party log service, where it outlives its purpose. Logs carry method, path, and status; sensitive fields are redacted or omitted.',
    headline: 'Full-request logging copies PII and tokens into log storage — redact before logging.'
  },
  {
    slug: 'set-httponly-secure-samesite-cookies',
    title: 'Session cookies need httpOnly, secure, and sameSite',
    severity: 'high',
    based_on: 'Bearer',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['cookie', 'session', 'httponly', 'samesite', 'xss', 'csrf', 'localstorage'],
    lesson:
      'A session cookie without httpOnly is readable by any script through an XSS bug; without secure it crosses plaintext HTTP; without sameSite it rides cross-site requests as CSRF. Session identifiers set all three, and personal data stays out of localStorage, which every script on the page can read.',
    headline: 'Cookies missing httpOnly/secure/sameSite are stealable — set all three on sessions.'
  },
  {
    slug: 'return-only-the-fields-the-client-needs',
    title: 'Filter API responses to the fields the client needs',
    severity: 'high',
    based_on: 'Bearer',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['api', 'response', 'serializer', 'over-fetch', 'fields', 'pii'],
    lesson:
      'Returning a whole database record leaks password hashes, internal ids, moderation flags, and sometimes other users data the caller was never meant to see. Each endpoint serializes an explicit allowlist of fields rather than the raw row.',
    headline: 'Returning whole records leaks hidden fields — serialize an explicit allowlist.'
  },
  {
    slug: 'send-baseline-security-headers',
    title: 'Send the baseline security response headers',
    severity: 'medium',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['headers', 'helmet', 'csp', 'hsts', 'clickjacking', 'x-frame-options'],
    lesson:
      'Without X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, and a Content-Security-Policy, an app is open to MIME sniffing, clickjacking, protocol downgrade, and injected scripts. These headers ship on every response; on Express the helmet middleware sets a sound default set.',
    headline: 'Missing security headers invite clickjacking and injection — set the helmet baseline.'
  },
  {
    slug: 'rate-limit-authentication-endpoints',
    title: 'Rate-limit login, signup, reset, and OTP endpoints',
    severity: 'high',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['rate limit', 'login', 'signup', 'otp', 'brute force', 'credential stuffing'],
    lesson:
      'Authentication endpoints with no rate limit let an attacker try thousands of passwords or OTP codes and create accounts in bulk. Login, signup, password reset, and OTP verification cap attempts per IP and per account over a short window.',
    headline: 'Unlimited login attempts enable brute force — rate-limit auth endpoints per IP.'
  },
  {
    slug: 'restrict-cors-to-known-origins',
    title: 'Do not allow all origins in CORS on a private API',
    severity: 'medium',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['cors', 'origin', 'wildcard', 'api', 'credentials'],
    lesson:
      'A CORS policy that reflects every origin, or answers with a wildcard while still allowing credentials, lets any website call the API as the logged-in user. A private API lists only the specific front-end origins it trusts.',
    headline: 'Wildcard CORS lets any site call your API as the user — allowlist known origins.'
  },
  {
    slug: 'never-send-stack-traces-to-clients',
    title: 'Return generic errors to clients, detailed logs to the server',
    severity: 'medium',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['error', 'stack trace', 'exception', 'debug', 'correlation id'],
    lesson:
      'An error response carrying a stack trace, SQL fragment, or file path hands an attacker a map of the stack and its internals. Clients receive a generic message plus a correlation id, while full detail goes only to server-side logs.',
    headline: 'Stack traces in responses map your internals — return a generic error, log the detail.'
  },
  {
    slug: 'check-ownership-to-stop-idor',
    title: 'Verify resource ownership on every id taken from the client',
    severity: 'critical',
    based_on: 'Trail of Bits',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['idor', 'authorization', 'ownership', 'object id', 'access control'],
    lesson:
      'An endpoint that reads an id from the URL or body and returns the record without checking who is asking lets a user fetch or change another users data by changing the number — an IDOR flaw. Every such handler confirms the authenticated caller owns, or may access, that specific object.',
    headline: 'Returning a record by client id without an owner check is IDOR — verify ownership.'
  },
  {
    slug: 'server-is-the-authority-on-price',
    title: 'Recompute prices and totals on the server, never trust the client',
    severity: 'critical',
    based_on: 'Trail of Bits',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['payment', 'price', 'total', 'discount', 'cart', 'checkout'],
    lesson:
      'When the server accepts a price, total, quantity, or discount from the request body, an attacker edits those values and pays what they choose. Money is recomputed server-side from trusted catalog and rule data; the client numbers are display-only.',
    headline: 'Trusting client-sent prices lets attackers set their own total — recompute server-side.'
  },
  {
    slug: 'verify-payment-webhook-signatures',
    title: 'Verify payment webhook signatures before granting access',
    severity: 'high',
    based_on: 'Trail of Bits',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['webhook', 'payment', 'stripe', 'razorpay', 'signature', 'fulfilment'],
    lesson:
      'A payment webhook handler that acts on the request body without checking the provider signature can be called directly by anyone to forge a paid event and unlock features. The signature is verified against the shared secret, and access is granted only after the provider confirms the payment.',
    headline: 'Unverified payment webhooks forge paid events — check the provider signature first.'
  },
  {
    slug: 'use-parameterized-queries',
    title: 'Build SQL with bound parameters, never string concatenation',
    severity: 'critical',
    based_on: 'Trail of Bits',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['sql', 'sql injection', 'query', 'parameterized', 'orm', 'input'],
    lesson:
      'Assembling a query by concatenating user input lets that input change the query itself — the classic SQL injection that dumps or destroys a database. Values reach the database only as bound parameters, through parameterized queries or an ORM, and never inside the query string.',
    headline: 'Concatenating user input into SQL is injection — bind values as parameters.'
  },
  {
    slug: 'harden-password-reset-tokens',
    title: 'Make reset tokens random, single-use, and short-lived',
    severity: 'high',
    based_on: 'Trail of Bits',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['password reset', 'token', 'account takeover', 'expiry', 'jwt'],
    lesson:
      'A password-reset token that is guessable, reusable, or valid for days is a path to account takeover. Reset tokens are long random values tied to one account, usable once, and expiring in minutes; the same care applies to JWT signing secrets and token expiry.',
    headline: 'Guessable or long-lived reset tokens enable takeover — random, single-use, short expiry.'
  },
  {
    slug: 'enforce-authorization-on-the-server',
    title: 'Enforce roles and permissions on the server, not in the UI',
    severity: 'critical',
    based_on: 'ECC Security Review',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['authorization', 'role', 'admin', 'privilege escalation', 'rbac'],
    lesson:
      'Hiding an admin button while leaving its endpoint open lets a user reach admin actions by guessing the route or editing a role claim in their token. Every protected action re-checks the caller role and permission on the server, treating client-side role data as untrusted.',
    headline: 'Hiding admin UI without a server role check invites escalation — authorize server-side.'
  },
  {
    slug: 'validate-uploads-server-side',
    title: 'Validate file uploads by real type and size on the server',
    severity: 'high',
    based_on: 'ECC Security Review',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['upload', 'file', 'mime', 'size', 'malware', 'stored xss'],
    lesson:
      'Trusting a file name or client-sent type lets an attacker upload a script or an oversized file; serving uploads from the app own origin with execute rights turns that into stored XSS or code execution. Uploads are checked for real type and size on the server and served from an isolated origin without execution.',
    headline: 'Unchecked uploads become malware or stored XSS — validate type/size, isolate serving.'
  },
  {
    slug: 'test-the-app-as-an-attacker-would',
    title: 'Re-run an attacker-perspective review after each major feature',
    severity: 'medium',
    based_on: 'ECC Security Review',
    agents: ['security', 'reviewer', 'critique'],
    keywords: ['attacker', 'security review', 'abuse', 'business logic', 'audit'],
    lesson:
      'New code is new attack surface, and logic flaws — negative payments, stacked discounts, restarted free trials, self-referral, infinite promo codes — are invisible to unit tests because each step is individually valid. A deliberate attacker-perspective pass after major features catches abuse paths that normal testing misses.',
    headline: 'New features add attack surface — re-run an attacker-perspective pass to catch abuse.'
  },
  // ---- coverage gaps closed 2026-07-14 (full pass over all five checklists) ----
  {
    slug: 'encode-output-to-stop-xss',
    title: 'Escape user input on output to stop cross-site scripting',
    severity: 'high',
    based_on: 'Trail of Bits',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['xss', 'sanitize', 'escape', 'html', 'output encoding', 'injection'],
    lesson:
      'Rendering user input into HTML, attributes, or the DOM without escaping lets an attacker run script in other users\' browsers — stored or reflected XSS that steals sessions and data. Untrusted values are escaped on output for their context, and rich text is sanitized against an allowlist before it renders.',
    headline: 'Unescaped user input in HTML runs as script (XSS) — encode on output, sanitize rich text.'
  },
  {
    slug: 'give-users-a-data-deletion-path',
    title: 'Provide a way for users to delete or anonymize their data',
    severity: 'medium',
    based_on: 'Bearer',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['gdpr', 'ccpa', 'deletion', 'erasure', 'privacy', 'pii'],
    lesson:
      'An app that collects personal data but offers no deletion path strands that data forever and breaches privacy law (GDPR right-to-erasure, CCPA). An account-deletion flow that removes or anonymizes the user\'s records — including copies in logs, backups, and third-party services — closes the loop.',
    headline: 'No deletion path strands PII and breaks privacy law — offer account deletion/anonymization.'
  },
  {
    slug: 'strip-debug-code-and-test-endpoints',
    title: 'Remove debug code and test-only endpoints before deploy',
    severity: 'high',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['debug', 'test endpoint', 'backdoor', 'seed-data', 'production', 'cleanup'],
    lesson:
      'Debug logging, commented-out blocks, hardcoded test credentials, and test-only routes (/debug, /seed-data, /admin-backdoor) shipped to production leak internals and hand attackers a shortcut. These are stripped before deploy and debug mode defaults to off.',
    headline: 'Debug code and /seed-data routes in production are a backdoor — strip them before deploy.'
  },
  {
    slug: 'validate-required-env-at-startup',
    title: 'Validate required configuration at startup and refuse to boot without it',
    severity: 'medium',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['env', 'config', 'startup', 'validation', 'boot', 'fail-fast'],
    lesson:
      'An app that starts with a critical variable missing — database URL, auth signing secret, a required API key — fails later in confusing or insecure ways, sometimes falling back to an unsafe default. Required configuration is checked at startup, and the app refuses to boot with a clear error when any is absent.',
    headline: 'Booting with a critical env var missing fails unsafely — validate config at startup, fail fast.'
  },
  {
    slug: 'secure-the-production-database-connection',
    title: 'Require TLS, unique credentials, and a closed port on the production database',
    severity: 'high',
    based_on: 'ECC Production Audit',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['database', 'tls', 'ssl', 'credentials', 'network', 'production'],
    lesson:
      'A production database reachable without TLS, running on default or shared credentials, or listening on a port open to the whole internet is trivially compromised. The connection uses TLS in production, unique non-default credentials, and network rules that limit access to the app.',
    headline: 'A plaintext or open-port database with default creds is trivially owned — require TLS + lock it down.'
  },
  {
    slug: 'do-not-expose-internal-files-and-docs',
    title: 'Keep .env, .git, and internal API docs off the public surface',
    severity: 'high',
    based_on: 'ECC Security Review',
    agents: ['security', 'reviewer', 'deployer'],
    keywords: ['exposure', 'dotenv', 'git', 'swagger', 'openapi', 'health'],
    lesson:
      'Serving the .env file, the .git directory, Swagger/OpenAPI docs, or a verbose health endpoint on the public surface hands an attacker secrets, source history, and a full map of the API. These paths are blocked at the server, and internal docs and health detail sit behind authentication.',
    headline: 'A reachable .env/.git/Swagger leaks secrets and the API map — block them, gate internal docs.'
  },
  {
    slug: 'supabase-anon-key-needs-row-level-security',
    title: 'The Supabase anon key is only safe with Row Level Security on every table',
    severity: 'critical',
    based_on: 'Gitleaks',
    agents: ['security', 'reviewer', 'developer'],
    keywords: ['supabase', 'rls', 'row level security', 'anon key', 'service role'],
    lesson:
      'The Supabase anon key is designed for the browser, but only when Row Level Security is enabled on every table; without RLS it exposes the entire database to anyone who reads the page. The service_role key bypasses RLS and must never appear in client code under any circumstances.',
    headline: 'A Supabase anon key without RLS exposes the whole database — enable RLS, keep service_role server-side.'
  }
];

// Expand a spec into a complete, schema-valid lesson object. Candidates start
// inactive; a human approves them through the normal review flow (security lessons
// never machine-activate). Evidence is honestly zeroed — these are curated, not
// mined from the user's own projects.
export function packLesson(spec, { today = '(undated)', id = null } = {}) {
  const headline = spec.headline;
  return {
    schema: 'raphael/lesson/v1',
    id: id ?? lessonId(),
    slug: spec.slug,
    title: spec.title,
    status: 'candidate',
    category: 'security',
    severity: spec.severity,
    scope: {
      stacks: spec.stacks ?? [],
      task_kinds: spec.task_kinds ?? [],
      projects: [],
      agents: spec.agents ?? ['security', 'reviewer']
    },
    triggers: { keywords: spec.keywords ?? [], paths: spec.paths ?? [] },
    lesson: spec.lesson,
    evidence: {
      refs: [],
      observations: 0,
      distinct_projects: 0,
      first_seen: today,
      last_seen: today
    },
    provenance: {
      created_by: `raphael/security-pack (based on ${spec.based_on})`,
      source_kind: 'imported',
      human_edited: false,
      tier: 'curated'
    },
    injection: {
      headline,
      tokens: Math.min(60, Math.max(1, Math.ceil(headline.length / 4)))
    }
  };
}

// The whole pack as ready-to-write lesson objects.
export function buildSecurityPack(opts = {}) {
  return PACK_SPECS.map((spec) => packLesson(spec, opts));
}
