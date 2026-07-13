# Recipe: Pre-deploy check

1. raph search "deploy <stack> migration env"  — deploy lessons become the checklist.
2. Free checks: env-var diff, migration presence, secret scan, `git status`.
3. Run the deterministic checklist; reason only about the exceptions.
4. Produce infra/CI-CD/migration/monitoring/rollback plan. Do NOT deploy or spend — hand off to a human.
5. Write back anything new that this deploy taught.
