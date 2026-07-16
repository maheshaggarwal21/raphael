import os from 'node:os';
import path from 'node:path';

// RAPHAEL_HOME lets tests (and the eval harness) point at a sandbox brain.
export function raphaelHome() {
  return process.env.RAPHAEL_HOME || path.join(os.homedir(), '.raphael');
}

export const p = {
  home: () => raphaelHome(),
  config: () => path.join(raphaelHome(), 'config.yaml'),
  brain: () => path.join(raphaelHome(), 'brain'),
  lessons: () => path.join(raphaelHome(), 'brain', 'lessons'),
  retired: () => path.join(raphaelHome(), 'brain', 'retired'),
  quarantine: () => path.join(raphaelHome(), 'brain', 'quarantine'),
  evidence: () => path.join(raphaelHome(), 'brain', 'evidence'),
  maps: () => path.join(raphaelHome(), 'brain', 'maps'),
  candidates: () => path.join(raphaelHome(), 'candidates'),
  state: () => path.join(raphaelHome(), 'state'),
  events: () => path.join(raphaelHome(), 'state', 'events.jsonl'),
  minedLedger: () => path.join(raphaelHome(), 'state', 'mined.jsonl'),
  distilledLedger: () => path.join(raphaelHome(), 'state', 'distilled.jsonl'),
  rejectedMemory: () => path.join(raphaelHome(), 'state', 'rejected.jsonl'),
  adoptionsLedger: () => path.join(raphaelHome(), 'state', 'adoptions.jsonl'),
  skillDrafts: () => path.join(raphaelHome(), 'staged', 'skills'),
  episodesDir: () => path.join(raphaelHome(), 'state', 'episodes'),
  sessionsDir: () => path.join(raphaelHome(), 'state', 'sessions'),
  index: () => path.join(raphaelHome(), 'index'),
  compiledIndex: () => path.join(raphaelHome(), 'index', 'compiled.json'),
  evals: () => path.join(raphaelHome(), 'evals'),
  logs: () => path.join(raphaelHome(), 'logs'),
  academy: () => path.join(raphaelHome(), 'academy'),
  academyProject: (name) => path.join(raphaelHome(), 'academy', name)
};
