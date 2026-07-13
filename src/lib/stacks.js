// Cheap, deterministic stack detection: which manifests sit in the project
// root. No parsing, no dependency scans — this runs inside a hook with a
// 150ms latency budget, so it is file-existence checks only.

import { existsSync } from 'node:fs';
import path from 'node:path';

const MANIFESTS = [
  ['package.json', 'node'],
  ['tsconfig.json', 'typescript'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['setup.py', 'python'],
  ['go.mod', 'go'],
  ['Cargo.toml', 'rust'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['build.gradle.kts', 'java'],
  ['Gemfile', 'ruby'],
  ['composer.json', 'php'],
  ['Dockerfile', 'docker'],
  ['docker-compose.yml', 'docker'],
  ['docker-compose.yaml', 'docker']
];

export function detectStacks(cwd) {
  if (!cwd) return [];
  const found = new Set();
  for (const [file, stack] of MANIFESTS) {
    try {
      if (existsSync(path.join(cwd, file))) found.add(stack);
    } catch {
      // unreadable dir — treat as no signal, never crash a hook
    }
  }
  return [...found];
}
