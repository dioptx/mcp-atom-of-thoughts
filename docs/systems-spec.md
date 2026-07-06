# AoT Systems-Thinking Layer — Spec (Round 3 DESIGN, v3)

Round 1 designed via grok-composer-2.5-fast + synthesis; Round 1 IMPLEMENTED and verified
in-repo (`src/systems-analysis.ts` 202 lines, sys sub-CLI mounted at cli.ts:1313, 324 tests
green). Round 2 design pass (this document, 2026-07-07): second grok-composer-2.5-fast
draft focused — per meta directive — NOT on redesigning the already-pinned Round-2
algorithms but on (a) pinning the Round-3 rendering slice to mechanical precision,
(b) `sys link --update`, (c) two small UX fixes. Synthesis corrections applied to the grok
draft: `addCausalLink` stays sync/unchanged (new `upsertCausalLink` helper instead of a
breaking return-shape change); CLI output keeps the repo idiom (`status/sessionId/link`
envelope, empty fields omitted — no `label: null`).

Repo: `/Users/mikhail/.nvm/versions/node/v22.22.0/lib/node_modules/@dioptx/mcp-atom-of-thoughts`
(symlink → `/Users/mikhail/Dev/ai-dev/mcp-atom-of-thoughts`; build output = `build/`, bin `aot`).

## Unification principle

AoT epistemic DAG = "what we believe and why". Systems layer = signed causal graph over the
SAME atoms = "how the believed system behaves". Confidence flows from AoT
(`effectiveConfidences`, computed on the FULL atom set BEFORE refuted filtering) into loop
weighting; refuted atoms drop out of causal analysis; verification atoms double as sensors.

---

## Data Model (src/types.ts) — LANDED in Round 1, no changes this round

All types below already exist in `src/types.ts` (verified): `CausalSign`, `CausalGain`,
`CausalLink` (id `cl:${from}>${to}`), `CausalGraphInput`, `LoopKind`, `LoopEdgeRef`,
`LoopAnalysis` (canonical `loop:${atoms.join('>')}` ids, full-set `confidenceWeight`),
`ControlRole`, `ControlLoopAnalysis` (with `externalDisturbances`), and the Round-2 set:
`LeverageRationaleCode`, `LeveragePoint`, `SimDirection`, `SimulationEffect`,
`SimulationResult`, `SystemsIssueCode` (incl. `LOOP_ENUMERATION_TRUNCATED`),
`SystemsIssue`, `SystemsAnalysis` (with `truncated`). `Session.causalLinks?` and
`GraphData.causalLinks?` are in. Round 2 implements against these types verbatim —
if any field mismatch surfaces during implementation, the type wins over prose.

---

## src/systems-analysis.ts — Round 1 functions LANDED (do not touch)

`MAX_LOOP_LENGTH=12`, `MAX_LOOP_COUNT=500`, `GAIN_NUMERIC {low:0.5, med:1.0, high:2.0}`,
`activeCausalGraph`, `dedupeCausalLinks` (earliest `created` wins), `buildAdjacency`
(sorted `(to asc, linkId asc)` — already the ordering `simulate` needs), `classifyLoopKind`
(even `-` = reinforcing), `computeLoopGain`, `enumerateLoops` (smallest-root DFS, canonical
rotation ids, full-set effConf, self-loops enumerated, 12/500 bounds + `truncated`),
`analyzeControlLoops` (verification→sensor, hypothesis/reasoning→actuator, conclusion→goal,
else connector; `externalDisturbances` = non-loop atoms with an active link INTO the loop),
`analyzeLoops`.

## Round 2 additions to src/systems-analysis.ts (PINNED — implement as written)

```ts
export function computeLeverage(input: CausalGraphInput, loops: LoopAnalysis[]): LeveragePoint[];
export function simulate(input: CausalGraphInput, atomId: string, direction: 'up' | 'down'): SimulationResult;
export function analyzeSystems(input: CausalGraphInput, options?: { weakThreshold?: number }): SystemsAnalysis;
```

### computeLeverage (pinned; fixes #6 #7 baked in)
```
loopDominance(a) = Σ over loops L containing a of (L.loopGain / |L.atoms|) × K(L.kind) × L.confidenceWeight
  K(reinforcing) = 1.2, K(balancing) = 1.0
norm(v) = (v - min) / (max - min) over the atom population; max === min → 0 for all
raw(a) = 0.40·norm(loopParticipationCount) + 0.25·norm(causalOutDegree) + 0.35·norm(loopDominance)·effConf(a)
score(a) = max_b raw(b) === 0 ? 0 : raw(a)/max_b raw(b)   // never NaN
rank: score desc, ties atomId asc; all-zero case ranks purely by atomId asc
```
Population = active (non-refuted) atoms that appear in ≥1 active causal link or ≥1 loop.
effConf from the FULL-set `effectiveConfidences` map (same discipline as `enumerateLoops`).
Rationale codes: `LOOP_HUB` (loopCount ≥ 2), `HIGH_CAUSAL_OUT_DEGREE` (≥ p90 nearest-rank
over sorted NONZERO out-degrees), `REINFORCING_DRIVER`/`BALANCING_DRIVER` (kind with the
larger summed dominance contribution for that atom; tie → reinforcing),
`HIGH_EFFECTIVE_CONFIDENCE` (≥0.8) / `LOW_EFFECTIVE_CONFIDENCE` (<0.5),
`ACTUATOR_ROLE`/`SENSOR_ROLE` (from `analyzeControlLoops` role of the atom in any loop).

### simulate (pinned; fix #8 baked in)
- Sign algebra: `+` preserves direction, `-` flips up<->down.
- Deterministic FIFO worklist; adjacency via existing `buildAdjacency` (already sorted
  `(to asc, linkId asc)`); seed = (atomId, direction, strength 1.0, path []).
- strength' = min(1, strength × 0.85 × GAIN_NUMERIC[gain]); drop if < 0.1 (MIN_STRENGTH).
- Per-linkId traversal cap: ≤ 2 (loop damping).
- Per-direction reachability sets decide `ambiguous` (atom reached with strength ≥ 0.1 in
  BOTH directions) — never traversal-cap racing. On repeat arrival same direction keep max
  strength; witness `pathLinkIds` = first path found under the fixed order.
- Emergence: feedbackEdgeSet = union of linkIds over `enumerateLoops(input).loops`;
  acyclicReach = propagate with feedback edges removed; fullReach = full graph.
  `emergent` = fullReach \ acyclicReach; `loop-mediated` = witness uses a feedback edge but
  atom ∈ acyclicReach; else `first-order`. `loopsTraversed` = ids of loops all of whose
  edges were traversed at least once, sorted.
- MUST have a permutation-invariance test: shuffle `causalLinks` input → deep-equal
  `SimulationResult`.
- Source atom itself is not an effect; `ATOM_NOT_FOUND`-style error if atomId missing or
  refuted (message "refuted atom" reuses existing regex row).

### analyzeSystems (pinned; fixes #4 #10 #16 baked in)
Returns `{ loops, controlLoops, leveragePoints, issues, truncated }`.
| Code | Trigger |
|------|---------|
| REINFORCING_COMPOUNDING_RISK | reinforcing loop, all loop-atom effConf ≥ 0.7, loopGain ≥ 4 |
| LOOP_CONTRADICTS_CONCLUSION | `simulate()` from any loop actuator assigns `down` to a conclusion with `isVerified === true`, or `up` to a conclusion with `isRefuted === true` (latter reachable only via `--from` files) |
| BALANCING_LOOP_NO_SENSOR | balancing, no sensor, AND no actuator (specific-over-general, #16) |
| OPEN_LOOP_BALANCING_RISK | balancing, no sensor, has actuator |
| ORPHAN_CAUSAL_LINK | link endpoint missing from atoms (pre-filter check on raw input) |
| SELF_LOOP | from === to |
| DUPLICATE_CAUSAL_LINK | duplicate (from,to) in raw input (fires on `--from` files only; sessions are normalized) |
| LOOP_ENUMERATION_TRUNCATED | `truncated === true` (so gate mode can fail on incomplete analysis) |
Issues sorted: code asc, then atomIds/loopIds asc. `weakThreshold` (default 0.7) is the
effConf floor used by REINFORCING_COMPOUNDING_RISK — expose for tuning, don't add a flag yet.

---

## CLI — Round 2 commands (sys sub-CLI, existing mount at cli.ts:1313)

All three read-only: `withDomainErrors` only, no state lock; `atomsForInspection` for
`--sessionId`/`--from` resolution (already returns `causalLinks` for both paths).

**`sys leverage`** — options `sessionId?`, `from?`, `top?: number` (default all).
Output: `{ source, truncated, totalAtoms, leveragePoints }` (truncated from enumerateLoops).

**`sys simulate <atomId>`** — options `direction: z.enum(['up','down'])` (required, but see
UX-A pattern: keep it schema-required — unlike `--sign` there is no atom-first ordering
concern worth the relaxation; the enum error is self-explanatory), `sessionId?`, `from?`.
Output: `SimulationResult` + `{ source, truncated }`.

**`sys lint`** — options `gate?: boolean`, `failOn?: string` (comma-separated codes),
`sessionId?`, `from?`. Mirrors `analyze` gate idiom exactly (cli.ts:1163-1188):
`process.exitCode = 1` when gate && failing issues; output
`{ source, truncated, issues, counts: Record<SystemsIssueCode, number>, ...(gate ? { gate: { failed, failingIssueCount, failOn } } : {}) }`.
Truncation gates: LOOP_ENUMERATION_TRUNCATED is an issue like any other — `--gate` fails on
it unless `--failOn` lists codes that exclude it.

examples via `exampleOptions` per repo idiom; new withDomainErrors rows (if any new messages)
PREPENDED before `/cycle/i`, messages say "causal loop" never bare "cycle".

## Round 2 UX fixes (small, land with Round 2)

### UX-A: friendly missing `--sign` on `sys link`
Today `aot sys link A B` (no `--sign`) dumps raw zod VALIDATION_ERROR before atom existence
is checked (verified by probe). Fix:
1. `sign: CausalSignSchema.optional()` in the `sys link` options schema (describe: "(required) …").
2. Inside `run()`: call `server.addCausalLink`/atom validation FIRST (existing ATOM_NOT_FOUND
   path) — concretely: validate atoms via server lookup, THEN
   `if (options.sign === undefined) throw new Error('missing required option --sign (use --sign plus, --sign minus, or --sign=-)')`.
3. New withDomainErrors row (prepended): `/missing required option --sign/i` → `MISSING_SIGN`,
   hint "Causal sign is + (same direction) or - (opposite): --sign plus | --sign minus | --sign=-".
Rationale: unknown atom ids are the first thing to fix before any link can succeed;
schema-optional is the only way to reach run() and emit a domain error instead of a zod dump.
Tests: (1) missing atom + no sign → ATOM_NOT_FOUND; (2) valid atoms, no sign → MISSING_SIGN,
no zod dump; (3) `--sign plus` still succeeds (regression).
Implementation note: atom-existence-before-sign requires the existence check to run before
addCausalLink needs the sign — either a lightweight `server.getAtoms(sessionId)` lookup for
both ids first, or split validation inside addCausalLink; pick the former (2 lines in cli).

### UX-B: `sys <cmd> --help` exit-0 regression pin
Probe result: `aot sys --help`, `sys link --help`, `sys loops --help` ALL already exit 0 in
the current build — no code change. Add cheap insurance only: built-CLI regression test
asserting exit 0 + usage-text substring for `sys --help` and `sys link --help`
(spawnSync against `build/cli.js`, same harness as existing built-CLI tests in
tests/sys-commands.test.ts). No help-plumbing refactor.

---

## Round 3 spec (PINNED NOW — implementation is mechanical)

### 3.0 Bug fix: `aot graph` drops session causal links
`cli.ts` graph command (≈line 1276) calls `exportGraph(atoms, atomOrder, options.title)`
without the 4th param on the session path (the `--from` path is fine). Fix: destructure
`causalLinks` from `atomsForInspection` and pass it through. Renderer signatures unchanged —
all four read `graph.causalLinks`.

### 3.1 Shared preprocessing — `normalizeCausalLinksForRender(graph: GraphData): CausalLink[]`
(private helper in graph-render.ts)
- absent/undefined/empty → `[]` (output byte-identical to today — snapshot-safe).
- Sort `(from asc, to asc, id asc)`; drop links with either endpoint not in `graph.nodes`
  (silent); self-loops still rendered.
- EDGE_LABEL composition (single rule, all formats):

| link.label | gain | EDGE_LABEL |
|---|---|---|
| absent | med/undefined | `+` or `-` |
| present | med/undefined | `+ increases demand` |
| absent | low/high | `+/high` |
| present | low/high | `-/low inhibits` |

- Label sanitization: trim; empty→sign-only; collapse whitespace; truncate at 40 chars with `…`;
  ASCII `-` for minus everywhere (grep/terminal consistency).

### 3.2 Mermaid (`renderMermaid`)
Causal edges appended AFTER all dep edges, BEFORE the verified `classDef` block:
```
  FROM -.->|EDGE_LABEL| TO
```
Escapes in edge label: `\` → `\\`, `|` → `&#124;`, `"` → `&quot;`, newlines → space;
never escape `+`/`-`. Example: `  A -.->|+/high drives| B`.

### 3.3 DOT (`renderDot`)
```
  "FROM" -> "TO" [style=dashed, label="EDGE_LABEL", color="#9467bd"];
```
Purple `#9467bd` — distinct from `darkgreen` verified nodes. Label escapes: `"`→`\"`, `\`→`\\`.

### 3.4 Canvas (`renderCanvas`)
Dep edges first (`edge-0…`), then causal:
```json
{ "id": "causal-edge-0", "fromNode": "A", "fromSide": "bottom",
  "toNode": "B", "toSide": "top", "color": "2", "label": "+/high drives" }
```
Color `"2"` (orange) — the only Obsidian preset color unused by node TYPE_COLOR (1/3/4/5/6).
`bottom`→`top` routing keeps causal edges visually orthogonal to dep `right`→`left`.
Omit `label` key never — sign-only labels are still informative; keep `label` always present
for causal edges (sign at minimum).

### 3.5 Tree (`renderTree`)
Dependency tree body UNCHANGED (no cycle weaving). When ≥1 causal link, append:
```

Causal links:
  A --(+/high)--> B  drives growth
  B --(-)--> C
```
Line format: `  {from} --({sign}{/gain if low|high})--> {to}{two spaces + label if present}`,
sorted `(from, to, id)`. No header when zero links (today's output byte-identical).

### 3.6 `sys link --update`
`aot sys link A B --sign minus [--gain ...] [--label ...] --update`
- Pair exists → update sign/gain/label in place, PRESERVE `id` and `created`.
- Pair absent + `--update` → plain create (idempotent upsert). Rationale: `--update` means
  "ensure this signed edge state" — scriptable without an existence probe.
- Without `--update`: behavior unchanged (CAUSAL_LINK_EXISTS).
- Server: do NOT change `addCausalLink` (Round-1 callers/tests pin its shape). Add:
  `public upsertCausalLink(link: Omit<CausalLink,'id'|'created'>, sessionId?: string): { link: CausalLink; updated: boolean }`
  (sync, same validation: ATOM_NOT_FOUND / REFUTED_ATOM; `causalLinks ??=` materialization).
- CLI output: existing envelope + flag:
  `{ status:'success', sessionId, link:{...link, createdIso}, updated: boolean }`
  (empty fields omitted per repo idiom — no `label: null`).
- Tests: update preserves id/created + changes sign; upsert-create path (`updated:false`);
  no `--update` duplicate still errors; JSON shape has `updated`.

### 3.7 Round 3 test list
R3-CLI-01 session graph render includes causal links; R3-CLI-02 `--from` regression;
R3-MER-01 `-.->|…|` syntax + placement before classDef; R3-MER-02 pipe-escape;
R3-DOT-01 dashed+color; R3-CVS-01 `causal-edge-N`, color "2", bottom→top;
R3-TRE-01 section present/format; R3-TRE-02 no header when empty (byte-identical);
R3-ORD-01 deterministic ordering; R3-FIL-01 orphan endpoint dropped silently;
R3-UPD-01..04 update suite. Golden-fixture snapshot (≥2 atoms, 1 dep, 2 causal links with
mixed sign/gain/label) across all four formats.

---

## State & Compat (unchanged from Round 1)

Old state files load unchanged (`causalLinks ?? []`); MCP payloads untouched all rounds;
export/import round-trips causal layer (landed Round 1); `aot analyze` never reports causal
cycles as dependency-cycle issues.

---

## Test Plan

### Round 2 — tests/systems-analysis.test.ts additions (≥14)
computeLeverage: empty-loop graph (all scores 0, atomId rank — fix #6); single dominant
reinforcing driver ranks first; norm degenerate max==min→0 (fix #7); tie-break atomId asc;
p90 out-degree code threshold; each rationale code fires on a minimal fixture.
simulate: `-` flips direction; strength decay ×0.85×gain and clamp; drop <0.1; linkId ≤2 cap
terminates a tight loop; ambiguous via both-direction reachability; emergent vs loop-mediated
vs first-order on a fixture with one loop + one chain; PERMUTATION INVARIANCE (shuffle links);
refuted/missing source atom errors.
analyzeSystems: each lint code positive+negative fixture; specific-over-general (no double
NO_SENSOR+OPEN_LOOP fire); truncated propagation (501-loop generator → LOOP_ENUMERATION_TRUNCATED).

### Round 2 — tests/sys-commands.test.ts additions (≥7)
`sys leverage`/`sys simulate`/`sys lint` output shapes (server-level via built CLI);
`sys lint --gate` exit 1 on issue; `--failOn` filtering incl. excluding truncation;
UX-A three cases (ATOM_NOT_FOUND ordering, MISSING_SIGN, regression);
UX-B help exit-0 pins (`sys --help`, `sys link --help`).

Gate: all 324 existing tests stay green; `npm run build` clean under strict TS.

---

## Round Plan

### DONE (Rounds 1+2 — Round 2 implemented 2026-07-07, verified in-repo)
Round 1: types.ts full systems type set incl. Round-2 declarations; systems-analysis.ts
Round-1 functions; atom-server.ts helpers (add/remove/get, reset clear, rm sweep, import
dedupe); graph-export.ts causalLinks param; cli.ts sys sub-CLI (link/unlink/loops), sign
aliases, prepended error rows, atomsForInspection causalLinks, import restore; 30 new tests.
All critique-round-1 MUST-FIXes #1-#10 and NICE #11-#16 that applied to Round 1 landed.

Round 2 (landed, all C2 MUST-FIXes applied, NICE C2-8..C2-12 also applied):
1. src/systems-analysis.ts: `computeLeverage` (pinned formula, fixes #6 #7; C2-8 p90
   degenerate pins, C2-9 K-free driver comparison, C2-10 in-loop-only role codes),
   `simulate` (pinned deterministic FIFO per C2-2/C2-3: deduped-active input, raw-atom
   source validation, global per-linkId cap <2 as sole limiter, effects atomId asc;
   C2-4 acyclic-witness + direction-set provenance; C2-12 truncation doc note;
   permutation-invariance deep-equal test), `analyzeSystems` (pinned lint table, fixes
   #4 #10 #16; C2-5 both-direction actuator simulation, exact-direction match, deduped
   per (loopId, conclusionId); C2-11 option renamed `compoundingConfidenceFloor`).
   New exported constants SIM_DAMPING/MIN_STRENGTH/MAX_LINK_TRAVERSALS.
2. src/cli.ts: `sys leverage [--top]`, `sys simulate <atomId> --direction up|down`,
   `sys lint [--gate] [--failOn]` — all read-only/lockless, analyze-idiom gate,
   truncation gates via LOOP_ENUMERATION_TRUNCATED; CLI-side `truncated` derived from a
   separate enumerateLoops call (C2-6, SimulationResult not widened).
3. UX-A: `--sign` schema-optional + "(required)" in describe; atom existence validated
   before MISSING_SIGN domain error; new prepended withDomainErrors row.
4. UX-B: help exit-0 regression tests (`sys --help`, `sys link --help`) — no code change.
5. C2-1 applied early (safe, renderers ignore the field until Round 3): graph command
   `--from` branch now passes `causalLinks` as 4th `exportGraph` arg; session path was
   already correct.
6. Tests: +24 engine (tests/systems-analysis.test.ts, 44 total) and +6 built-CLI
   (tests/sys-commands.test.ts, 17 total); full suite 355 green (324 baseline kept);
   `tsc --noEmit` and `npm run build` clean.

### THIS ROUND (Round 3 — implement now; all pins mechanical)
1. §3.1 `normalizeCausalLinksForRender` + EDGE_LABEL rule (graph-render.ts private helper).
2. §3.2-3.5 mermaid/dot/canvas/tree causal rendering, with the Round-3 idiom deltas below
   (R3-D1..R3-D3) superseding §3.2/§3.3 escape prose where they conflict.
3. §3.6 `sys link --update` via new `upsertCausalLink` (atom-server.ts).
4. §3.7 test list + golden fixture snapshots (all four formats).
5. Polish deltas P3-1 (simulate --direction VALIDATION_ERROR wording), P3-2 (Details dedupe),
   P3-3 (first-order provenance fixture) — pinned below.
Nothing else: simulate/leverage semantics are closed; no new flags beyond `--update`.

### LATER
None planned — Round 3 completes the brief. Any Round 4 would be discretionary polish.

Decisions locked (cumulative): bounded enumeration 12/500; even-`-` = reinforcing;
GAIN_NUMERIC 0.5/1.0/2.0; leverage 40/25/35 × effConf with min-max norm and zero-max→0;
damping 0.85, MIN_STRENGTH 0.1, linkId cap 2; emergence = full minus feedback-removed reach;
one causal link per (from,to); `--update` = idempotent upsert preserving id/created;
EDGE_LABEL table + ASCII minus; mermaid `-.->|…|`, dot dashed `#9467bd`, canvas color "2"
bottom→top, tree appended "Causal links:" section; R3-D1..D3 separate escape helpers
(mermaidEscape/node escapes untouched); P3-1 zod-enum `error` string naming `--direction`;
P3-2 omit cause when message === cause.message; P3-3 disjoint-chain first-order fixture.

---

## Round 3 design pass (2026-07-07) — idiom re-check + polish deltas

Per meta directive: NO redesign. Scoped grok-composer-2.5-fast delegation (a) re-checked
§3.1-3.5 pins against current `src/graph-render.ts` (138 lines, no causal rendering yet —
as expected), (b) drafted P3-1..P3-3. Synthesis corrections: separate edge-label escape
helper instead of grok's proposal to extend `mermaidEscape` (keeps existing node-label
output byte-identical); P3-3 has no per-effect `loopsTraversed` field (top-level only —
verified against types.ts:124-139); `withDomainErrors` variable is `error`, not `err`.
All probe evidence reproduced against `build/cli.js` this session.

### Idiom re-check (§3.1-3.5 vs graph-render.ts) — pins CONFIRMED, three deltas

- §3.1 MATCH-BY-EXTENSION: reuse existing `truncate()` shape (whitespace collapse + `…`)
  for the 40-char EDGE_LABEL truncation. Helper stays private, takes `GraphData`.
- **R3-D1 (§3.2, supersedes its escape prose — restates C2-7 concretely):** do NOT modify
  `mermaidEscape` (it feeds node labels; changing it risks snapshot drift). Add a private
  `mermaidEdgeLabelEscape(text)`: `"`→`#quot;`, `|`→`#124;`, `\s+`→single space. No
  backslash rule. Causal lines `  ${from} -.->|${mermaidEdgeLabelEscape(EDGE_LABEL)}| ${to}`
  emitted after the dep-edge loop, before the `classDef verified` block (or at end when no
  verified nodes — i.e. insert where the classDef block would go).
- **R3-D2 (§3.3):** private `dotLabelEscape(text)` = `\`→`\\` THEN `"`→`\"` (order matters);
  existing node-label escape line untouched. Causal lines after dep edges, before `}`:
  `  "${from}" -> "${to}" [style=dashed, label="${dotLabelEscape(EDGE_LABEL)}", color="#9467bd"];`
- **R3-D3 (§3.4):** causal edges appended to the same `edges` array after the dep `.map()`
  (ids `causal-edge-0…` numbered over causal links only), `fromSide:'bottom'`,
  `toSide:'top'`, `color:'2'`, `label` ALWAYS present (sign at minimum) — note this
  deliberately differs from dep edges' omit-when-default idiom, per §3.4 pin.
- §3.5 MATCH: `renderTree` returns `lines.join('\n')`; when ≥1 normalized causal link push
  `''`, `'Causal links:'`, then the pinned lines before joining. Zero links → byte-identical.

### P3-1 (PINNED) `sys simulate` VALIDATION_ERROR must name `--direction`
Probe (current build): bad value (`--direction sideways`), missing, and positional
(`sys simulate H1 up` — positional silently dropped → missing) ALL emit
`VALIDATION_ERROR` with message `Invalid option: expected one of "up"|"down"` — the flag
name appears only in `fieldErrors[].path`. Fix (cli.ts:1449; schema STAYS required per
round-2 delta (e) — no optional+run() check):
```ts
direction: z.enum(['up', 'down'], {
  error: 'Required option --direction must be "up" or "down"',
}).describe('Perturbation direction at the source atom'),
```
(zod v4 via `import { z } from 'incur'`; static `error` string covers both invalid-value
and missing shapes, so one line fixes all three probe cases.) Pinned message text:
`Required option --direction must be "up" or "down"` (contains literal `--direction`).
Tests (tests/sys-commands.test.ts, built-CLI spawn):
R3-P1a bad value → output contains `VALIDATION_ERROR` AND `--direction`;
R3-P1b missing + positional `H1 up` → same assertions.

### P3-2 (PINNED) Dedupe `X\n\nDetails: X` in domain errors
Probe: `sys link NOPE1 NOPE2 --sign plus` → `message: "Atom with ID NOPE1 not found\n\n
Details: Atom with ID NOPE1 not found"`. Cause: cli.ts:74 rethrows with both `message`
(derived FROM the caught error) and `cause: error`; incur `BaseError` appends
`\n\nDetails: ${cause.message}` whenever a cause exists (node_modules — not patchable).
Fix inside `withDomainErrors` (cli.ts:74):
```ts
if (pattern.test(message)) {
  const cause = error instanceof Error && error.message !== message ? error : undefined;
  throw new Errors.IncurError({ code, message, hint, cause });
}
```
Consequence: cause chain dropped ONLY in the identical-message case (today: always for
domain rules); a future wrapped error with a distinct message still chains and still gets
a Details line — which would then be informative, not duplicated.
Tests: R3-P2a ATOM_NOT_FOUND output does NOT match `/Details:\s*Atom with ID/`;
R3-P2b message field === `Atom with ID NOPE1 not found` exactly (no `\n`).

### P3-3 (PINNED) First-order provenance fixture (fills untested C2-4 branch)
Smoke runs only ever saw `ambiguous`/`emergent` because every perturbed atom sat on a
loop. Pin an engine-level fixture where the acyclic branch is exercised: atoms
{L1,L2,X,Y,Z}; links `cl:L1>L2 (+)`, `cl:L2>L1 (+)` (loop), `cl:X>Y (+)`, `cl:Y>Z (+)`
(chain fully disjoint from the loop — no shared atom or edge).
`simulate(input,'X','up')` MUST yield exactly:
- `effects` = [Y, Z] (atomId asc; no L1/L2);
- Y: `direction:'up'`, `provenance:'first-order'`, `pathLinkIds:['cl:X>Y']`,
  `strength` ≈ 0.85 (1.0×0.85×GAIN_NUMERIC.med);
- Z: `direction:'up'`, `provenance:'first-order'`, `pathLinkIds:['cl:X>Y','cl:Y>Z']`,
  `strength` ≈ 0.7225;
- `loopsTraversed: []`, `ambiguousAtomIds: []`, `emergentAtomIds: []`.
Sign-flip variant: same graph with `cl:X>Y` sign `-` → Y and Z both `direction:'down'`,
still `provenance:'first-order'`, `loopsTraversed: []`.
(Field names verified against types.ts:124-139; effects have NO per-effect loopsTraversed.)
Tests (tests/systems-analysis.test.ts): R3-P3a fixture as above; R3-P3b sign-flip variant.
No production change expected — if the fixture fails, the C2-4 implementation is wrong
and must be fixed to match this pin (the pin wins).

---

## Critique round 1 (retained verbatim for traceability)

Adversarial review via grok-composer-2.5-fast; all items verified against the repo.
Refuted grok claims not listed (payload-shape pins sessionId only; 2^12 gain benign;
sensor/closed-loop mappings mandated by brief).

MUST-FIX (all resolved): #1 sub-CLI mount (landed); #2 resetSession clears causalLinks
(landed); #3 externalDisturbances replaces unreachable in-loop disturbance rule (landed);
#4 LOOP_CONTRADICTS_CONCLUSION defined on isVerified/isRefuted conclusions (Round 2);
#5 full-set effConf before refuted filter (landed); #6 zero-max leverage → all-0 scores
(Round 2); #7 norm() min-max with degenerate→0 (Round 2); #8 deterministic simulation +
permutation-invariance test (Round 2); #9 export/import pulled into Round 1 (landed);
#10 truncation propagates to leverage/lint + LOOP_ENUMERATION_TRUNCATED (Round 2).

NICE (all resolved): #11 prepended error rows, no bare "cycle" (landed); #12 self-loops
enumerated + SELF_LOOP lint (landed / Round 2 lint); #13 dedupe earliest-created, remove-all
pair matches (landed); #14 `??=` materialization (landed); #15 rm sweep test (landed);
#16 specific-over-general lint codes (Round 2).

## Critique round 2 — adversarial verification (grok-composer-2.5-fast refutation pass, verified against repo)

Grok raised 35 claims; 24 rejected after code verification (design choices already pinned,
factually wrong vs repo — e.g. `analyzeSystems` IS the raw-input entry point so ORPHAN lint is
unit-testable; spec 3.1 already maps `[]`→absent; classifyLoopKind even-`-`=reinforcing is the
standard loop-polarity convention). Verified issues below; spec text above is NOT retro-edited —
these deltas supersede where they conflict.

### MUST-FIX

**C2-1 (§3.0) Bug description inverted.** VERIFIED: `exportCurrentGraph` (cli.ts:434) already
passes `server.getCausalLinks(...)` — the SESSION path is fine. It is the `--from` branch of the
graph command (cli.ts:1275-1276) that calls `exportGraph(atoms, atomOrder, options.title)` and
drops `causalLinks` even though `atomsForInspection` returns them. Fix 3.0: on the `--from`
branch destructure `causalLinks` and pass as 4th arg. Session path: no change.

**C2-2 (simulate) Input discipline unpinned.** Spec never says simulate uses the active/deduped
graph. Pin: simulate operates on `dedupeCausalLinks(activeCausalGraph(input).causalLinks)`
(same discipline as `enumerateLoops`); source-atom validation runs on RAW `input.atoms` BEFORE
filtering — missing → `Atom with ID ${id} not found` (ATOM_NOT_FOUND row), `isRefuted` →
message containing "refuted atom" (REFUTED_ATOM row). Without this, duplicate (from,to) links
from `--from` files double-propagate (they share `cl:from>to` ids, corrupting the per-linkId
cap) and a refuted source reports ATOM_NOT_FOUND instead of REFUTED_ATOM.

**C2-3 (simulate) Worklist semantics + effects ordering must be fully pinned or the mandated
permutation-invariance deep-equal test is ill-defined.** Pin: BFS from the seed; for each
dequeued (atom, direction, strength, path), iterate outgoing links in canonical adjacency order;
traverse a link iff global `traversalCount[linkId] < 2` AND `strength' ≥ 0.1`; increment count,
record arrival (keep max strength per (atom,direction), first-recorded witness path wins),
always enqueue on traversal. Termination is guaranteed by the global cap (≤ 2·|links| total
traversals). `effects` sorted `atomId asc` (one entry per atom; direction `ambiguous` when both
reached). No separate "repeat arrival" skip rule — the link cap is the only limiter.

**C2-4 (simulate) `loop-mediated` as specified is an ordering artifact, not semantics.**
Counterexample: loop A⇄B plus chain A→C→B; canonical order makes the first witness for B the
feedback edge A→B, so B is classed `loop-mediated` despite being plainly first-order reachable.
Pin instead: for atoms ∈ acyclicReach, take witness `pathLinkIds` from the ACYCLIC propagation;
provenance = `loop-mediated` iff the full-graph direction set for that atom differs from the
acyclic-only direction set (the loop added a direction / made it ambiguous), else `first-order`.
`emergent` unchanged (∉ acyclicReach). acyclicReach = identical propagation rules (C2-3) with
feedback edges skipped.

**C2-5 (analyzeSystems) LOOP_CONTRADICTS_CONCLUSION simulate direction unpinned.** "simulate()
from any loop actuator assigns down…" doesn't say which input direction. Pin: for each in-loop
actuator run BOTH `simulate(a,'up')` and `simulate(a,'down')`; fire if either run assigns `down`
(incl. via `ambiguous`? NO — direction must be exactly `down`) to an `isVerified` conclusion, or
`up` to an `isRefuted` conclusion. Dedupe issues per (loopId, conclusionId).

**C2-6 (CLI) `sys simulate` output pins `{ source, truncated }` but `SimulationResult` has no
`truncated` and `simulate()` doesn't return one.** Pin: the CLI derives it from a separate
`enumerateLoops({atoms, causalLinks}).truncated` call (cheap; do NOT widen the pinned
SimulationResult type). Same note applies to `sys leverage`'s `truncated`.

### NICE

**C2-7 (§3.2) Mermaid escape idiom mismatch.** Existing `mermaidEscape` uses mermaid entity
codes (`#quot;`, graph-render.ts:56); spec 3.2 pins HTML `&quot;`/`&#124;`. Use mermaid codes
for causal edge labels too: `"`→`#quot;`, `|`→`#124;` (no pipe survives, delimiters safe),
drop the `\`→`\\` rule (backslash is not a mermaid escape char).

**C2-8 (computeLeverage) p90 degenerate cases.** Pin: zero nonzero out-degrees → the
HIGH_CAUSAL_OUT_DEGREE code never fires; population of 1 nonzero degree → it fires for that
atom (accepted noise, document in test).

**C2-9 (computeLeverage) Driver-label K bias.** REINFORCING_DRIVER vs BALANCING_DRIVER should
compare per-kind dominance sums WITHOUT the K factor (K=1.2 pre-biases the comparison); keep K
only inside `loopDominance` itself. Tie → reinforcing (now actually reachable).

**C2-10 (computeLeverage) ACTUATOR_ROLE/SENSOR_ROLE scope.** Count only IN-LOOP roles
(`atom ∈ loop.atoms`; equivalently role derived from atomType for loop members); an atom whose
only appearance in a `roles` map is as external `disturbance` never earns either code.

**C2-11 (analyzeSystems) `weakThreshold` name collision.** `analyze --weakThreshold` defaults
0.5 (weak_support); systems option defaults 0.7 (compounding floor). Rename the library option
to `compoundingConfidenceFloor` before any CLI flag exists (none this round — cheap now).

**C2-12 (simulate) Emergence under truncation.** feedbackEdgeSet from a truncated enumeration
is incomplete → provenance is best-effort. Already surfaced via the CLI `truncated` field
(C2-6); add one doc line on `simulate` noting classification is conditional on `truncated:false`.

## Critique round 2 (design-pass deltas)

Grok round-2 draft accepted with corrections: (a) rejected its async
`addCausalLink(link, sessionId, {update})` re-signature — Round-1 helper is sync and pinned
by tests; new `upsertCausalLink` instead; (b) rejected `label: null` in output — repo omits
empty fields; (c) canvas color "2" confirmed as the sole unused preset (nodes use 1/3/4/5/6);
(d) probe contradicts the round-1 meta note that sys help exits nonzero — all sys help paths
already exit 0 in current build, so UX-B is a regression pin only; (e) `sys simulate
--direction` stays schema-required (enum error self-explanatory; no atom-ordering concern),
only `--sign` gets the optional-schema treatment.
