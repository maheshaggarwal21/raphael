# Recipe: Pre-deploy check

1. raph search "deploy <stack> migration env"  — deploy lessons become the checklist.
2. Run the security-audit recipe first — a build is not deploy-ready until it passes.
3. Free checks: env-var diff, migration presence, secret scan, `git status`.
4. Run the deterministic checklist; reason only about the exceptions.
5. Produce infra/CI-CD/migration/monitoring/rollback plan. Do NOT deploy or spend — hand off to a human.
6. Optional outside voice: if a different AI model is available (e.g. codex), get one independent second opinion on the plan and present any disagreement as a tension point for the human — never auto-apply it.
7. Write back anything new that this deploy taught.
