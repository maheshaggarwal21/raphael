# Recipe: Security audit before launch

1. raph search "security <stack>"  — pull the curated security pack plus your own past breaches.
2. Secrets: scan the tree AND git history; move every hardcoded key/token to env, never behind a NEXT_PUBLIC_/VITE_ prefix, and rotate anything ever committed.
3. Personal data: trace where PII enters, travels, and lands; keep it out of logs, hash passwords with a slow KDF, and filter each API response to an allowlist.
4. Pre-deploy hardening: security headers (helmet), rate-limit auth endpoints, restrict CORS to known origins, generic errors to clients, and no debug/test backdoors.
5. Deep logic: check IDOR (ownership on every client-supplied id), recompute money server-side, verify payment-webhook signatures, and parameterize every query.
6. Attacker pass: try id manipulation, login bypass, privilege escalation, feature abuse, and content injection; report exploit + fix. Never auto-apply a security change — hand it to a human.
