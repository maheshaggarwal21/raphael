# Recipe: Debug a failure

1. raph search "<error keywords> <stack>"  — past root causes narrow the search first.
2. Reproduce the failure deterministically before touching code.
3. Free checks: read the stack trace, `grep` the failing symbol, `git log` the hot file.
4. Isolate the real root cause (not the nearest symptom); name the edge cases.
5. Propose the robust fix with reasoning. Write back the root-cause lesson.
