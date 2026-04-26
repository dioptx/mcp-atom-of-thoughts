import { AotEvent } from './events.js';

// Scenario: "Why is /dashboard slow after Friday's deploy?"
// Classic N+1 — relatable to every backend dev, maps cleanly to P→R→H→V→C.
export const DEMO_EVENTS: AotEvent[] = [
  { kind: 'session_start', t: 0, mode: 'fast', maxDepth: 3 },
  { kind: 'atom_added', t: 100, atom: { atomId: 'P1', content: '/dashboard p95 latency: 4.2s (was 480ms before Fri deploy)', atomType: 'premise', dependencies: [], confidence: 0.95, created: 100, isVerified: false, depth: 0 } },
  { kind: 'atom_added', t: 380, atom: { atomId: 'P2', content: 'pg_stat_statements: 312 queries per request (avg)', atomType: 'premise', dependencies: [], confidence: 0.9, created: 380, isVerified: false, depth: 0 } },
  { kind: 'atom_added', t: 660, atom: { atomId: 'P3', content: "Friday's PR #847 added team name to each project card", atomType: 'premise', dependencies: [], confidence: 0.92, created: 660, isVerified: false, depth: 0 } },
  { kind: 'atom_added', t: 980, atom: { atomId: 'R1', content: 'Query count scales with projects → classic N+1, not a slow query', atomType: 'reasoning', dependencies: ['P1', 'P2'], confidence: 0.84, created: 980, isVerified: false, depth: 1 } },
  { kind: 'atom_added', t: 1280, atom: { atomId: 'H1', content: 'PR #847 fetches project.team lazily → one extra SELECT per project', atomType: 'hypothesis', dependencies: ['R1', 'P3'], confidence: 0.8, created: 1280, isVerified: false, depth: 2 } },
  { kind: 'atom_added', t: 1620, atom: { atomId: 'V1', content: 'Repro: enable SQL log on staging — 50 projects → 51 queries', atomType: 'verification', dependencies: ['H1'], confidence: 0.9, created: 1620, isVerified: false, depth: 3 } },
  { kind: 'atom_verified', t: 1880, atomId: 'V1', confidence: 0.93 },
  { kind: 'atom_verified', t: 1930, atomId: 'H1', confidence: 0.9 },
  { kind: 'atom_added', t: 2080, atom: { atomId: 'C1', content: 'Eager-load team in projects query: .include(:team) — collapses N+1 to 1', atomType: 'conclusion', dependencies: ['H1', 'V1'], confidence: 0.92, created: 2080, isVerified: false, depth: 3 } },
  { kind: 'atom_verified', t: 2300, atomId: 'C1', confidence: 0.92 },
  { kind: 'termination', t: 2400, reason: 'Strong conclusion found' },
];

export const DEMO_DELAY_MS: Record<AotEvent['kind'], number> = {
  session_start: 200,
  atom_added: 700,
  atom_verified: 350,
  conclusion_suggested: 350,
  decomposition_started: 400,
  decomposition_completed: 400,
  termination: 600,
};
