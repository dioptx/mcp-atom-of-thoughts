# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added — `aot sgt run` one-shot interleaving (latency optimization)

- **`aot sgt run <query> [--gap 0.15] [--budget N]`** — collapses `route` + `advise` + `expand <top advised hypothesis>` into a single invocation (one agent round-trip instead of three). `--gap` adds confidence-gap-gated second disclosure: the runner-up hypothesis is also expanded only when its advise score is within the gap fraction of the top (the code-level counterpart of the INT4 recommendation banked by the integration A/B loop; default 0 = top-1 only). Composition, not a fourth epistemic pathway: it reuses `materializeRoutePlan` + `adviseCandidates` + the extracted `performSgtExpand`, so refusal matrix, idempotency, and error taxonomy are byte-identical to the separate commands (pinned by `tests/sgt-run.test.ts`). Judge and trace stay explicit follow-ups — verdicts are yours, not the bridge's.

### Added — sgt skill-graph bridge round 3 (`aot sgt trace`, analyze awareness, verification hardening)

Completes the `aot sgt` bridge to the external skill-graph-traversal CLI (rounds 1-2 shipped `route`/`judge`/`expand`/`advise`; spec: `docs/sgt-integration-spec.md`, now Status: implemented v1).

- **`aot sgt trace --graphFormat tree|mermaid|dot|canvas`** — unified reasoning + traversal trace through the SAME renderers as `aot graph`: skill atoms are tagged with their slug (tree/mermaid/dot label suffix ` [sgt:{slug}]` appended after content truncation; canvas cards gain a final `sgt:{slug}` text line). Byte-identical to `aot graph` when a session has no skill atoms (pinned against pre-change goldens); zero subprocess, works with no sgt binary present.
- **skillRef export/import round-trip** — `GraphNode.skillRef` (additive): `aot export` carries skill provenance (omitted entirely for non-skill graphs), `aot import` restores it, and `aot analyze --from <export>` sees the same skill state as the live session.
- **analyze/gate awareness** — new informational `advise_pending` lint: one issue per stale skill hypothesis awaiting `expand` (tier 1) or `judge` (tier 2), derived from the same predicates as `aot sgt advise`. Always present in `issues`; exempt from the default `--gate` (payload reports `failOn: 'all'` + `exempt: ['advise_pending']`); `--failOn advise_pending` opts back in.
- **Verification hardening** — exported `SGT_PROVENANCE_REF_RE` grammar with golden-vector + reconstructed-negative-control tests; Round-2 must-fix traceability matrix (spec §6); adversarial edge suite (empty packets, ambiguous slugs, mid-chain failures, superseded-scaffold revival, `missingTokens: []` idempotency); end-to-end contract test through the built CLI; ship/no-ship checklist S1-S11 with frozen deferrals D1-D7 (spec §7).
- **Operator smoke** — `npm run smoke:sgt` drives route → advise → expand → advise → judge → trace (all four formats, mermaid byte-compared to a checked-in snapshot) → `aot analyze --gate` exit 0 against the fixture SGT_BIN.
- **Tooling** — `npm test` now builds first (`pretest`); missing `build/cli.js` FAILS the cli-sgt suites with an actionable message instead of skipping. README gains an `aot sgt` section with the command table, `SGT_BIN` env, and the full error-code inventory (`SGT_UNAVAILABLE`{`NOT_FOUND`,`TIMEOUT`,`EXIT_ERROR`,`BAD_JSON`,`SCHEMA_MISMATCH`}, `SGT_EXPAND_REFUSED`, `SGT_SLUG_UNRESOLVED`, `SGT_NOT_HYPOTHESIS`, `SGT_HYPOTHESIS_NOT_FOUND`, `SGT_AMBIGUOUS_SLUG` — all "state never modified").

### Added — systems-thinking layer (causal loops, feedback, control, emergence)

A signed-causal graph over the same atoms, complementing the epistemic AoT DAG. The DAG answers "what we believe and why"; the systems layer answers "how the believed system behaves". Confidence flows from AoT into loop weighting; refuted atoms are excluded; verification atoms double as control-loop sensors.

- **Causal links** (`Session.causalLinks`, backward-compatible): `aot sys link <from> <to> --sign +|- [--gain low|med|high] [--label ...] [--update]`, `aot sys unlink`. Signed influence (`+` same direction, `-` opposite) distinct from epistemic dependencies; one link per (from,to); `--update` idempotently upserts (preserving id/created). Refuted atoms cannot be linked.
- **Feedback-loop analysis** `aot sys loops`: bounded enumeration (≤ length 12, ≤ 500 loops, `truncated` flag), reinforcing/balancing classification (even count of `-` = reinforcing), loop gain, AoT-confidence weighting, and control-theoretic role mapping — verification→sensor, hypothesis/reasoning→actuator, conclusion→goal, external disturbances — with open-loop-risk detection.
- **Leverage analysis** `aot sys leverage [--top N]`: ranks atoms by systemic influence (loop hub-ness, causal out-degree, reinforcing/balancing driver role, effective confidence), normalized scores with rationale codes.
- **Qualitative simulation** `aot sys simulate <atomId> --direction up|down`: propagates a perturbation through signed edges with loop damping; classifies effects `first-order` / `loop-mediated` / `emergent`; reports ambiguous and emergent atoms. Deterministic and permutation-invariant.
- **Emergence/systems lint** `aot sys lint [--gate] [--failOn code,...]`: reinforcing-compounding risk, loop-contradicts-conclusion, open-loop balancing risk, orphan/self/duplicate links, loop-enumeration truncation.
- **Rendering**: `aot graph` renders causal edges in all four formats — mermaid dashed `-.->|label|`, dot dashed purple `#9467bd`, Obsidian canvas orange `bottom→top` edges, ASCII-tree `Causal links:` section. Output is byte-identical to prior versions when a graph has no causal links. Causal links round-trip through export/import.
- `aot analyze` never reports causal cycles as dependency-cycle issues — feedback loops are legal.

### Added — friction burn-down (63-item backlog from the self-improvement loop)

- **Refuting evidence is first-class.** Verification atoms carry a `polarity` (`supports`, default, or `refutes`; CLI `--refutes`, `aot set --polarity`). A verified refuting verification marks its dependencies `isRefuted` (and un-verifies them) instead of asserting the opposite of the evidence; refuting a conclusion removes it from `verifiedConclusions` and blocks termination. Refuted atoms have effective confidence 0, appear in `analyze` under `refuted`, and trigger `refuted_support`/`refuted_conclusion` lints.
- **Evidence attachments**: `--evidence a,b` on `fast`/`full`/`set` stores artifact refs (paths, URLs) on atoms, shown in `list`/`show` and preserved through export/import.
- **Import + file-based analysis**: `aot import <graph.json>` re-imports `aot export` output (round-trippable, `--replace` to reset first); `aot analyze --from file` and `aot graph --from file` inspect a graph file without touching session state.
- **CI gate mode**: `aot analyze --gate [--failOn code,code]` exits 1 when (selected) lint issues exist.
- **`aot archive [session]`** marks a session completed (eligible for gc); `--reopen` reverses it. `aot set` that pushes a session past its termination condition now archives it (reported as `sessionArchived`).
- **`--state <path>` global flag** targets any state file without `AOT_STATE` env gymnastics.
- **Machine-readable error codes**: `ATOM_NOT_FOUND`, `HAS_DEPENDENTS`, `DEPENDENCY_CYCLE`, `MISSING_DEPENDENCY`, `INVALID_CONFIDENCE`, `SESSION_NOT_FOUND`, `SESSION_EXISTS`, `INVALID_POLARITY`, `NO_FIELDS`, `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_GRAPH_FILE` — replacing blanket `UNKNOWN`; batch/plan/call payload failures return structured validation errors with field paths.

### Changed — friction burn-down

- **fast/full parity**: fast mode now validates dependency existence, derives depth (no more `depth: null`), and reports `depth` in its payload. Fast no longer auto-spawns conclusions for merely-confident *unverified* hypotheses; auto-conclusions fire only for verified hypotheses ≥ 0.8 and never duplicate (skipped when a conclusion already depends on the hypothesis).
- **Unified verification propagation** (create-time and `set --verified` now share one path): supporting verification verifies hypothesis/conclusion/nested-verification dependencies — premises and reasoning are never silently flipped; creation-time verified conclusions register in `verifiedConclusions` immediately.
- **Effective confidence semantics**: a *verified* atom anchors its chain (eff = own confidence — empirical verification resets the support discount); refuted atoms drop to 0. `weakestLinks` is now selective (all atoms below the threshold, ascending, leaves included) with an explicit `weakestLinksCriterion`, not a fixed top-5.
- **Contradictions redefined**: an atom with BOTH verified supporting and verified refuting evidence (`{atomId, supportedBy, refutedBy}`). Sibling hypotheses sharing a dependency are rivals, not contradictions — that noise is gone. New `low_effective_conclusion` lint flags termination-grade conclusions resting on weak support.
- **Read commands are read-only**: `sessions`/`status`/`export`/`list`/`show`/`analyze`/`graph` take no lock and never rewrite state; `sessions` parses state once, and both `sessions` and `list`/`show` add ISO timestamps alongside epoch ms.
- **gc data-loss guard**: deleting completed sessions that still contain atoms now requires `--yes`; without it they are listed under `kept` with the reason, and only empty sessions are pruned.
- **Termination transparency**: `status` explains itself (`Continue reasoning: depth 2/5; best verified conclusion at 0.85 (needs >= 0.9)`) plus a structured `detail` block with thresholds.
- **Flag ergonomics**: help-screen kebab forms of `no*` flags (`--no-br`, `--no-beads`, ...) now parse (rewritten to their declared camelCase names); passing a positional as a flag (`aot new --sessionId x`) hints at the positional form; help examples render kebab-case; `dag --dryRun` labels the br stage `dry-run` instead of `ok`; atom creation reports `confidenceDefaulted: true` when 0.7 was assumed; overwrites return `overwritten: true`; auto-spawned sessions are announced via `autoSpawnedSession`; empty `aot set` errors (`NO_FIELDS`) and successful sets list `changed` fields.

### Added

- Graph introspection commands: `aot list` (type/verified/min-confidence filters) and `aot show <id>` (atom with dependencies, dependents, effective confidence, and per-atom lint issues).
- `aot analyze`: cycles, dangling dependencies, topological order, roots/leaves, effective (propagated) confidence, weakest links, contradiction candidates, critical path to the best conclusion, and lint issues (`unverified_conclusion`, `unsupported_conclusion`, `untested_hypothesis`, `weak_support`).
- `aot graph --graphFormat tree|mermaid|dot|canvas [--out file]`: ASCII tree, Mermaid, Graphviz dot, and Obsidian JSON Canvas renderers over the session graph (`src/graph-render.ts`, reusable by the MCP server/TUI).
- Mutation commands: `aot set <id>` (content/confidence/verified/deps with existence and cycle guards) and `aot rm <id>` (refuses while dependents exist unless `--force`, which detaches them), backed by new `AtomOfThoughtsServer.updateAtom`/`removeAtom`.
- `aot gc`: prune completed/empty sessions from persistent state with `--dryRun`, `--olderThanDays`, and `--keepCompleted` filters; never touches the active or `default` session.

### Changed

- `aot graph` now prints the rendered tree/mermaid/dot/canvas text raw to stdout by default (metadata on stderr), so output is terminal- and doc-pasteable; the structured `{ sessionId, format, rendered }` payload remains available behind an explicit `--format json` (or any explicit `--format`), and `--out` is unchanged.
- Passing a graph render format to the global envelope flag (`aot graph --format mermaid`) now exits with a hint pointing at `--graphFormat` instead of the framework's bare `Invalid format` parse error (`src/cli-hints.ts`).

### Fixed

- `aot dag` now targets the active session by default instead of hardcoding `default`, matching every other command: resolution is explicit `--session-id` > payload `sessionId` > active session > `default`, identical for `--dryRun` and real runs. The pipeline payload states `sessionId`, `sessionSource` (`flag|payload|active|fallback`), and `sessionWarning`; a completed/archived active session is still targeted but with a loud warning, never a silent misroute to `default`. Embedded `AoT external ref: aot:<session>:<id>` strings now carry the resolved session (`resolveDagSession` in `src/integrations/dag.ts`).
- The bare-boolean-flag literal guard is now case-insensitive: `aot set H1 --verified False` (or `TRUE`, `FaLsE`, ...) hard-errors with the `=`-form hint instead of silently writing `isVerified: true`. Literal case variants on non-boolean flags (`--content True`) still pass through.
- Bool-flag footgun: a bare boolean flag followed by a literal `true`/`false` (e.g. `aot set H1 --verified false`, which used to succeed while leaving `isVerified: true`) now hard-errors with a hint pointing at the unambiguous `--verified=false` / `--no-verified` forms. Boolean flag names are derived from each command's own options schema, so the guard is scoped to the invoked command and literal `true`/`false` values of non-boolean flags (e.g. `--content true`) still pass through. Help examples now render boolean options in the `=` form. No state-format change: existing state files load unchanged.
- The `--graphFormat` misuse hint is now scoped to `aot graph`; other commands (e.g. `aot list --format mermaid`) get the framework's own envelope-format error instead of a graph-specific hint.
- Dependency cycles can no longer be constructed by overwriting an existing atom (`assertNoCycle` in both full and fast servers).
- Corrupt `state.json` no longer bricks every command: it is quarantined to `state.json.corrupt-<ts>` and the CLI starts fresh.
- State writes are atomic (tmp + rename), eliminating truncated-state corruption from interrupted writes.
- Stale `state.json.lock` files from crashed processes are detected via PID liveness and broken automatically instead of deadlocking for ever.
- Auto-suggested conclusion IDs no longer collide with user atom IDs that start with `C` (e.g. `CACHE1`).

## [3.1.0] — 2026-06-16

### Added

- Native `aot` CLI with persistent state, schema/LLM manifests, batch JSON/stdin atom creation, and explicit `aot server` MCP mode.
- br/beads and bv integrations for syncing AoT graphs to issue dependencies and evaluating ready/blocked work.
- `aot dag` for task DAGs with hard dependencies plus typed `constrains`, `entails`, and `related` edges.
- Optional Linear integration for DAG nodes/relations with dry-run preview, Git context capture, idempotent `AoT external ref: aot:<session>:<node>` markers, stdin descriptions, and structured error payloads.
- PEX retrieval seeding commands for exam-oriented atom generation.
- Personal workflow application guide plus runnable DAG examples for ANZCA SAQ synthesis, PageIndex/R2L evidence crosswalks, MAK95 MCQ five-gate closure, memex graph maintenance, and agent-tooling release orchestration.
- Critical-evaluation synthesis documenting subagent reviewer findings and self-improvement rules for turning prose-only safety guidance into executable DAG gates.
- Second-pass safety metadata schema and dry-run harness for personal workflow DAGs, including typed checkpoint, rollback, approval, privacy, timeout, and proof-artifact metadata.
- Package finalization for the workflow portfolio: tarball includes docs/examples/schemas/scripts, CI runs example dry-runs and pack smoke checks, and CLI/package versions are aligned.

### Changed

- Pipeline command outputs now include `schemaVersion`, `runId`, `generatedAt`, and `pipeline` for agent-safe auditing and replay.
- `aot dag --dryRun` now produces offline br/beads and Linear previews without requiring those CLIs to be installed or shelling out to trackers.
- CLI validation failures now return structured `validation_error` payloads with issue paths for agent repair loops.
- Graph export types support rich node/link metadata used by br/beads and DAG adapters.

### Tests

- 218 tests passing across 15 test files, including CLI integration, DAG relation semantics, dry-run tracker previews, validation payloads, personal workflow DAG examples, subagent-derived safety gate regressions, typed workflow safety metadata, package-surface finalization, external refs, and structured external-command error payloads.

## [3.0.0] — 2026-04-13

Major UX refactor. Tool surface collapsed to 3, sessions added,
visualization made on-demand, approval moved off the filesystem.
See `MIGRATION_v2_to_v3.md` for the full migration guide.

### Breaking Changes

- **Tool renames**:
  - `AoT-light` → `AoT-fast`
  - `AoT` → `AoT-full`
- **Tools removed (folded into other tools)**:
  - `generate_visualization` → set `viz: true` on `AoT-fast` / `AoT-full`
  - `check_approval` → `atomcommands` subcommand `"check_approval"`
  - `export_graph` → `atomcommands` subcommand `"export"`
- **Server flags removed**:
  - `--no-viz`, `--no-approval`, `--viz` (boolean) → use `--viz auto|always|never`
- **Config fields removed**: `vizEnabled`, `approvalEnabled` → replaced by `vizMode: 'auto' | 'always' | 'never'`
- **processAtom response shape**: now includes `sessionId`; empty
  collection fields and `terminationStatus` are omitted when not
  meaningful (callers that snapshot the JSON should expect a leaner shape)

### Added

- **Sessions**: atom state scoped per-session. Default session `"default"`.
  Two reasoning problems in one process no longer collide.
- **`atomcommands` subcommands**: `new_session`, `switch_session`,
  `list_sessions`, `reset_session`
- **Auto-archive**: session marked `completed` when reasoning terminates
- **Auto-spawn**: next zero-dep atom in a completed session
  spawns a fresh `default-N` session automatically
- **HTTP approval callback**: local 127.0.0.1 listener on an
  ephemeral port. Browser POSTs approval JSON back via XHR. Falls back
  to file polling on the configured downloads dir if the POST fails.
- **`viz: true` param** on AoT calls renders the D3 graph and opens
  the browser. Server flag `--viz auto|always|never` controls overall
  policy.
- **`sessionId` param** on AoT calls targets a specific session
  (auto-creates if unknown).

### Changed

- Tool count: 6 → 3 (`AoT-fast`, `AoT-full`, `atomcommands`)
- Default response payload: ~12 fields → ~6 (empty arrays, null
  fields, and unactionable termination status omitted)
- Tool descriptions tightened with explicit fast/full decision rule
  and planning-mode visualization heuristic
- `approval.ts` uses `os.homedir()` for cross-platform Downloads dir
  detection (was `process.env.HOME`)

### Migration

- Replace `mcp__atom-of-thoughts__AoT-light` with `mcp__atom-of-thoughts__AoT-fast`
- Replace `mcp__atom-of-thoughts__AoT` with `mcp__atom-of-thoughts__AoT-full`
- Replace `mcp__atom-of-thoughts__generate_visualization(...)`
  with `mcp__atom-of-thoughts__AoT-full({..., viz: true})`
- Replace `mcp__atom-of-thoughts__check_approval()`
  with `mcp__atom-of-thoughts__atomcommands({command: "check_approval"})`
- Replace `mcp__atom-of-thoughts__export_graph()`
  with `mcp__atom-of-thoughts__atomcommands({command: "export"})`
- Replace `--no-viz` with `--viz never`, `--no-approval` is gone
  (approval is always on; control viz via `--viz`)

### Tests

- 121 → 165 tests passing across 12 test files
- New: `tests/sessions.test.ts`, `tests/approval-server.test.ts`,
  `tests/payload-shape.test.ts`

---

## [2.1.0] — 2026-03-11

### Changed

- **Visualization off by default** — pass `--viz` to enable (was `--no-viz` to disable)
- **Lenient validation** — partial atom inputs accepted; missing fields get sensible defaults
- **Shorter tool descriptions** — improved display in Claude Code tool listings
- **Removed `isError`** from non-error response shapes for cleaner MCP compliance

### Fixed

- Tests updated to match new defaults and validation behavior

---

## [2.0.0] — 2026-02-13

Initial public release.

### Added

- **AoT** — Full decomposition with up to 5 depth levels and confidence tracking
- **AoT-light** — Quick analysis mode (max 3 levels, no visualization)
- **atomcommands** — Advanced atom manipulation (contract, merge, prune, split, reweight)
- **export_graph** — Export reasoning graphs as JSON or Mermaid
- **generate_visualization** — Interactive D3.js force-directed graph with approve/reject workflow
- **check_approval** — Poll user approval status from the visualization UI
- 5 atom types with confidence thresholds: Premise (0.9), Reasoning (0.8), Hypothesis (0.7), Verification (0.85), Conclusion (0.9)
- CLI flags: `--mode`, `--max-depth`, `--no-viz`, `--no-approval`, `--output-dir`, `--downloads-dir`
- Docker support with multi-stage build
- Smithery deployment configuration
- GitHub Actions CI across Node 18, 20, 22
- 121 tests covering all tools, atom types, and edge cases

### Technical

- Built on `@modelcontextprotocol/sdk` ^1.24.0 (MCP protocol 2025-03-26)
- TypeScript strict mode, ES2022 target
- Vitest test runner
- Bundled D3.js v7 for offline visualization
