# aot CLI — Technical Dossier (v3.1.0 evaluation)

Date: 2026-07-06. Scope: `@dioptx/mcp-atom-of-thoughts` working copy (live-edited under nvm global node_modules, own git repo). Baseline: 219 vitest tests green.

## 1. What it is

A stateful CLI (built on `incur`) wrapping an Atom-of-Thoughts reasoning engine originally shipped as an MCP server. Atoms (premise/reasoning/hypothesis/verification/conclusion) form a dependency DAG per session, persisted to `~/.local/state/aot-cli/state.json`. The CLI layers pipelines over external tools:

- **br/beads** — atoms sync to issues via `external_ref aot:<session>:<atomId>`; auto-sync on every atom create (`AOT_BR_AUTO`).
- **bv** — robot analysis (`--robot-triage` etc.) over the synced beads graph.
- **pex** — CICM/ANZCA exam retrieval bundles converted into seed atom scaffolds.
- **Linear** — optional issue/relation sync from `aot dag` with dedupe-by-external-ref.

Architecture is clean: `cli.ts` (910 LOC, command surface + state/lock plumbing) → `atom-server.ts` (engine, session-scoped) → `integrations/*` (subprocess adapters, all through `shell-json.ts` with structured error payloads). Light server (`AoT-fast`) shares state with the full server by object-reference aliasing — a deliberate hack, documented, works.

## 2. Engine semantics (integrated understanding)

- Depth auto-derives as `max(dep depths)+1`; termination = any atom depth ≥ maxDepth OR a verified conclusion with confidence ≥ 0.9. On termination the session auto-archives (`completed`) and the next zero-dep, session-less atom auto-spawns `default-N`.
- Verified `verification` atoms propagate `isVerified` to hypothesis dependencies; full server then runs decomposition **contraction**: when all sub-atoms of a completed decomposition are verified, the original atom's confidence becomes the sub-atom mean and, for hypotheses ≥ 0.8, a conclusion is auto-suggested.
- Fast server (depth 3) skips decomposition and auto-suggests conclusions directly from hypotheses ≥ 0.8.
- Every CLI mutation runs under a `state.json.lock` file lock (5s deadline, 50ms Atomics.wait spins), full-file read → mutate → full-file rewrite.

## 3. Critical findings

### Correctness
| # | Finding | Severity |
|---|---------|----------|
| C1 | **Dependency cycles are constructible.** Deps must pre-exist, but atom overwrite is silent: create A, create B←A, then re-create A←B → cycle. Depth calc and any future traversal can loop/misreport. | High |
| C2 | **Stale lock deadlocks all commands.** Lock file records PID but nothing checks liveness; a crashed holder bricks the CLI for every future call (EEXIST rethrown after 5s). | High |
| C3 | **Corrupt state file is fatal and unrecoverable.** `makeServer()` does bare `JSON.parse`; a truncated write (disk full, kill mid-write) permanently crashes every command. `version: 1` is written but never checked. | High |
| C4 | **`suggestConclusion` ID collision.** New conclusion ID = `C<count of ids starting with "C">+1` — collides with user IDs like `CACHE1` or after C-atoms are interleaved (overwrites silently). | Med |
| C5 | Silent data mangling: out-of-range confidence coerced to 0.7, invalid deps arrays coerced to `[]` in `validateAtomData`. | Low |
| C6 | Non-atomic state writes (no tmp+rename) — the very source of C3 risk. | Med |

### Capability gaps (the real ceiling)
- **The graph is write-only from the CLI.** No `list`, `show`, no way to see an atom, its dependents, or the frontier without exporting whole-graph JSON and post-processing. For an agent-facing reasoning tool this is the dominant limitation.
- **Zero graph intelligence.** No cycle/orphan detection, no topological order, no confidence propagation (an atom's stated confidence ignores the weakness of its support chain), no contradiction surfacing outside per-call `conflictingAtoms`, no critical-path/weakest-link analysis. All evaluation is outsourced to bv, which only sees the beads projection.
- **No mutation ops.** Can't update confidence/verification/content, can't delete an atom. The only correction path is silent full overwrite (which is what enables C1).
- **Renders only to D3 HTML or raw JSON.** No mermaid/dot/ASCII for terminals and docs, no Obsidian JSON Canvas despite the primary user living in Obsidian.
- **State grows forever.** Auto-spawned `default-N` sessions accumulate; every command pays O(total state) read+write. No gc/prune.

### Design observations (non-blocking)
- Auto-beads spawns a `br` subprocess *per atom* on `aot fast/full` (batch amortizes); `br list` is re-fetched per sync, O(issues).
- `maybeAutoCreateBeads` re-reads state from disk inside the same lock that just saved it — double parse per atom call.
- Only `dag` wraps its pipeline in try/catch → structured `errorToPayload`; `bv`/`plan`/`prep`/`audit` leak raw exceptions on br/bv failure.
- `SERVER_BIN` via `new URL(...).pathname` breaks on Windows; acceptable for a personal macOS tool.
- `firstJson` brace-scanner is a solid pragmatic choice for mixed text/JSON CLI output.
- Uncommitted working-tree change (br.ts `brDependencyType` + test) is a strict improvement — semantic non-blocking edges map to `related` instead of leaking raw relation names into br.

## 4. Improvement plan (orthogonal axes)

| Axis | Deliverable |
|------|-------------|
| **A. Introspection** | `aot list` (filter by type/verified/min-confidence/session), `aot show <id>` (atom + direct/transitive deps and dependents) |
| **B. Graph intelligence** | `aot analyze`: cycles, dangling deps, topo order, roots/leaves/frontier, effective (propagated) confidence = own × weakest support chain, weakest links, contradiction candidates, unsupported-conclusion lint, per-type stats |
| **C. Rendering** | `aot graph --format tree\|mermaid\|dot\|canvas` — ASCII tree for terminals, mermaid/dot for docs, Obsidian JSON Canvas for the vault |
| **D. Mutation** | `aot set <id>` (confidence/verified/content/deps with cycle+existence guards), `aot rm <id>` (refuses while dependents exist unless `--force`, which detaches) |
| **E. Robustness** | Cycle guard on atom create/overwrite (C1); stale-lock PID liveness breaking (C2); corrupt-state quarantine to `state.json.corrupt-<ts>` + fresh start (C3); atomic tmp+rename writes (C6); collision-free conclusion IDs (C4) |
| **F. Hygiene** | `aot gc` — prune completed/empty sessions with age/keep filters |

Engine changes land in `atom-server.ts` (guarded, event-emitting); analysis/render are pure modules (`graph-analysis.ts`, `graph-render.ts`) over `GraphData`/atom maps so the MCP server and TUI can reuse them. All new logic test-covered; existing 219 tests must stay green.

## 5. Post-implementation status

All six axes shipped (see `CHANGELOG.md` Unreleased):

- New commands: `list`, `show`, `analyze`, `graph` (tree/mermaid/dot/Obsidian canvas, `--out`), `set`, `rm`, `gc`.
- New pure modules: `src/graph-analysis.ts` (cycle detection, topo sort, effective-confidence propagation `eff(a) = conf(a) × min(eff(deps))`, contradictions, critical path, lint issues) and `src/graph-render.ts`.
- Engine: `updateAtom`/`removeAtom` with guards, `assertNoCycle` on create/overwrite in both servers, collision-free auto-conclusion IDs.
- Fixed C1–C4 and C6 from §3. C5 (silent coercion) deliberately left — MCP-side behavior is pinned by upstream payload-shape tests.
- Verification: 240 vitest tests green (219 baseline + 21 new), `tsc --noEmit` clean, full end-to-end smoke of every new command against an isolated `AOT_STATE`, including corrupt-state quarantine and stale-lock breaking.

## 6. Friction burn-down (2026-07-07)

The 63-friction backlog harvested by the self-improvement workflow was deduplicated into ~15 orthogonal work items and resolved in one pass (294 tests green, up from 279):

- **Polarity** (worst class, frictions 0/1/20/21/27/28/43/51): `polarity: refutes` on verification atoms; refuted targets get `isRefuted`, eff conf 0, `refuted_support`/`refuted_conclusion` lints; refuting a conclusion revokes termination.
- **Propagation unification** (31/53/54): one verifyAtom path for create and set; premises/reasoning never silently verified; creation-verified conclusions register immediately; auto-conclusion gated on VERIFIED >= 0.8 with dedup.
- **fast/full parity** (2/13/22/23/30/45/48/60): shared prepareAtomForInsert (dep validation, cycle guard, depth) in both servers.
- **Analysis semantics** (14/15/39/40/50/57/58/62): verified atoms anchor effective confidence; weakestLinks selective with stated criterion; contradictions = supported AND refuted, sibling noise removed; low_effective_conclusion lint bridges raw-confidence termination vs propagated confidence.
- **CLI robustness/UX**: domain error codes via IncurError; lockless read commands; --state flag; gc --yes guard; archive/reopen; ISO timestamps; --no-X kebab rewrite; positional hints; overwrite/confidence-default/auto-spawn markers; set changed-fields + NO_FIELDS; dag dry-run labeling; structured validation errors.
- **Capabilities**: analyze --gate/--failOn (CI exit codes), import (export round-trip), analyze/graph --from file, --evidence attachments.

Remaining known ceilings (deliberate): termination still uses raw confidence (surfaced by low_effective_conclusion rather than changed — MCP behavior pin); C5 silent coercion in validateAtomData unchanged for MCP payload-shape compatibility.

## 7. Systems-thinking integration (2026-07-07)

A signed-causal layer over the same atoms, built by a 3-round self-improving workflow (grok composer-2.5-fast design/critique subagents, Claude implementers, validator gate, meta-agent prompt evolution). Unification principle: the AoT DAG is epistemic ("what we believe and why"), the causal graph is dynamical ("how the believed system behaves") — they share atoms, AoT effective confidence weights loop analysis, refuted atoms drop out, verification atoms double as control sensors.

- `src/systems-analysis.ts` (pure, like graph-analysis.ts): causal adjacency, bounded loop enumeration with canonical rotation ids (12/500 bounds, `truncated`), reinforcing/balancing classification (even `-` parity), loop gain (GAIN_NUMERIC 0.5/1.0/2.0), control-loop role mapping + open-loop risk, `computeLeverage` (40/25/35 weighting × effConf, min-max normalized), `simulate` (0.85 damping, MIN_STRENGTH 0.1, per-linkId traversal cap, first-order/loop-mediated/emergent provenance, permutation-invariant), `analyzeSystems` emergence lint.
- CLI: `aot sys link/unlink/loops/leverage/simulate/lint` — mutations locked, reads lockless, lint `--gate/--failOn` like `analyze`.
- Rendering: causal edges in mermaid/dot/canvas/tree, byte-identical output when no causal links; export/import round-trips the layer.

Rounds: R1 causal links + loops + control view (324 tests); R2 leverage + simulation + emergence lint (355); R3 rendering + `sys link --update` + polish (370). Session-limit and credit exhaustion interrupted rounds 2 and 3 mid-flight; resumed from the workflow journal cache and the final round implemented directly.

## 8. sgt skill-graph bridge (2026-07-07)

A three-round integration with the external `sgt` skill-graph-traversal CLI (7114-skill ontology; spec `docs/sgt-integration-spec.md`, Status: implemented v1). Unification principle: sgt is a deterministic, budget-disciplined *retrieval* module with no memory or epistemic layer; AoT supplies exactly that half — traversal decisions become atoms, judge verdicts steer the next traversal. Loose coupling throughout: subprocess via `SGT_BIN` (JSON in/out, 16 MB maxBuffer, SIGKILL timeout, argv never shell-interpolated), fixture SGT_BIN scripts in CI, no corpus in the repo.

- **R1 — route + judge**: `sgt route plan` materialized as premise → reasoning chain (axis-keyed ids) → skill hypotheses with `skillRef` provenance under the deterministic `sgt:q{sha256[:8]}:` namespace. Idempotent re-routes (updateAtom-only patches, supersede-prefix drop-outs at confidence ≤ 0.35, judged atoms never overwritten), polarity verdicts `j:{slug}:{polarity}` on the standard verifyAtom path, SGT_UNAVAILABLE taxonomy with byte-identical state on every failure.
- **R2 — expand + advise (metacognitive loop)**: progressive disclosure via single-slug `sgt context pack` into a polarity-free `e:{slug}` verification scaffold carrying excerpt provenance (`sgt:packet:{slug}:{headingKey}:{index}` / `sgt:ref:{slug}:{kind}:{basename}`); refusal matrix (refuted > verified > superseded) gates BEFORE any subprocess; `aot sgt advise` emits a ranked, byte-stable 4-tier action table (expand/judge/related/refine) from session state alone — zero subprocess; judge inherits scaffold evidence at creation only.
- **R3 — unified trace + polish**: `aot sgt trace` reuses the `aot graph` renderers with skill atoms tagged `[sgt:slug]` (canvas: trailing `sgt:{slug}` text line), byte-identical output when no skill atoms exist (pinned against pre-change goldens); `GraphNode.skillRef` round-trips export/import so `analyze --from` matches live sessions; informational `advise_pending` analyze lint (gate-exempt by default, `--failOn advise_pending` opts in, gate payload reports the exemption honestly); exported `SGT_PROVENANCE_REF_RE` with golden-vector + reconstructed-negative-control tests; adversarial edge suite; e2e contract test through the built CLI (fail-fast when unbuilt, `pretest` builds); `npm run smoke:sgt` operator script with a byte-compared mermaid snapshot; spec §6 traceability matrix for the six Round-2 must-fixes and §7 ship/no-ship checklist (S1-S11, deferrals D1-D7).
