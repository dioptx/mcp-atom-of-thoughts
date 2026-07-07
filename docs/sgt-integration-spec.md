# SGT × AoT Integration Spec — Reasoning-Traced Progressive Disclosure

Status: implemented v1 (rounds 1-3; see §6 traceability matrix and §7 ship/no-ship checklist)
Repos: `aot` = this repo (`@dioptx/mcp-atom-of-thoughts` v3.1.0, incur CLI).
`sgt` = `zpankz/sgt` clone at `/Users/mikhail/Dev/ai-dev/sgt` (skill-graph-traversal 0.7.0, incur CLI, 7114-skill ontology bundle). Installed binary: `~/.local/bin/sgt`.

## 1. Critical evaluation of sgt (source-level, `skillhub/cli/*.ts`)

### Strengths
1. **Deterministic**: all ranking/traversal is a pure function of tracked ontology
   artifacts (`per_skill_metadata.jsonl`, `term_df.json`, `skill_relations.json`,
   `facet_discrimination.json`). Byte-identical outputs; no wall-clock/network.
2. **Budget discipline is real**: every content-emitting command runs a
   `fitToBudget` shrink ladder (trim alternatives → drop axes → drop skills →
   defer excerpts) with explicit `omittedDueToBudget` / `contextDeferred`
   reporting. Regression-tested (`test:budget`, 9 cases).
3. **Progressive disclosure is architectural, not cosmetic**: guide → group →
   command → `--json`; metadata-only by default (`route plan`), bodies only for
   selected slugs (`context pack`), single-skill max expansion (`context explain`).
4. **Ranking has measured improvements**: IDF query weighting (fixed ~100%
   alphabetical-tie collapse), typed `related_to` kNN with bidirectional closure
   (component 90.7%→99.8%), same-name dedup (+0.86 distinct/query).
5. **Decision tree exposes traversal reasoning**: `facetEvidence` emits per-axis
   `{axis, choice, why, candidatesBefore, candidatesAfter, alternatives}` — this
   is proto-reasoning-tracing and the natural join surface with AoT.

### Weaknesses (ranked by integration relevance)
1. **W1 Stateless/amnesiac**: every query starts cold. No traversal history, no
   record of which retrieved skills were actually *useful* vs noise. `query dag`
   "loop" is a fixed ≤3-iteration scripted strategy sequence, not learning.
2. **W2 No epistemic layer**: `confidence: high|medium|low` is token coverage,
   not evidence. Nothing can record "retrieved but irrelevant" (refutation) or
   "confirmed useful" (verification). Scores conflate lexical match ↔ relevance.
3. **W3 Greedy single-path decision tree**: `facetEvidence` commits to the
   largest split per axis; alternatives are listed but never explored; no
   backtracking; the `why` string is boilerplate ("largest relevant split…").
4. **W4 No cross-call composition**: `next` suggestions are command strings, not
   resumable state. An agent must re-derive context each call.
5. **W5 "MCMC" is a misnomer**: deterministic argmax over ≤4 proposal queries;
   no sampling/acceptance. Deterministic is fine — naming misleads.
6. **W6 Ad-hoc objective**: `query dag` objective = Σ score/(i+1) + coverage·15
   + diversity·3 — untested weights, no external anchor.
7. **W7 Corpus noise**: heavy same-name duplication in store (dedup mitigates at
   query time but the noise is structural); facet classification heuristic.

### Verdict
sgt is a deep, well-engineered *retrieval* module whose missing half is exactly
what AoT has: persistent sessions, an epistemic DAG (confidence propagation,
verification/refutation polarity, contradiction detection), and a causal/systems
layer. Conversely AoT reasons over its own atoms only — no external knowledge
corpus. The integration closes both gaps: **sgt traversal decisions become AoT
atoms; AoT's epistemic state steers the next sgt traversal.**

## 2. Unified architecture — the metacognitive loop

```
        ┌──────────────── aot sgt advise (metacognition) ◄─────────────┐
        ▼                                                              │
  aot sgt route "goal"          aot sgt expand <hypothesis>            │
  (traverse: metadata only) →  (disclose: budgeted excerpts) →  judge (verify/refute)
        │                             │                               │
        ▼                             ▼                               ▼
  premise + reasoning atoms     verification atoms            aot analyze / trace
  + skill-hypothesis atoms      (evidence = excerpt)          (epistemic state)
```

Loose coupling: aot shells out to the `sgt` binary (`SGT_BIN` env, default
`sgt`), JSON in/out, subprocess with timeout. No compile-time dependency; tests
use a fixture SGT_BIN emitting canned JSON (the 536 MB corpus never enters CI).

### Atom mapping (traversal → epistemic DAG)
| sgt artifact | AoT atom | confidence | evidence |
|---|---|---|---|
| query/goal | `premise` | 0.95 (or --confidence) | query text |
| decision-tree axis choice | `reasoning` (chained, dep on prev) | narrowing ratio-derived | axis, choice, candidatesBefore/After, alternatives |
| selected skill | `hypothesis` "skill <name> is relevant to <goal>" | mapped from score/coverage tier | slug, score, coverage, matched/missing tokens |
| disclosed excerpt (judged) | `verification` supports/refutes the skill hypothesis | judge-supplied | excerpt heading + text ref |
| goal resolution | `conclusion` | standard AoT rules | — |

Skill provenance on atoms: `AtomData.skillRef?: { slug: string; source: 'sgt'; score?: number; coverage?: number }` (optional, backward-compatible).

### Commands (new `aot sgt` group)
1. `aot sgt route "<query>" [--budget N] [--limit K] [--facet DIM:PATH]…` —
   run `sgt route plan --format json`; materialize premise → reasoning chain →
   skill hypotheses in the active session. Idempotent per (session, query):
   re-route updates rather than duplicates.
2. `aot sgt expand <atomId|slug> [--budget N]` — run `sgt context pack` for the
   hypothesis's slug; print excerpts; create a pending verification scaffold.
   Refuses to expand refuted or already-verified hypotheses (progressive
   disclosure = never pay context for settled questions).
3. `aot sgt judge <atomId> --supports|--refutes [--confidence C] [--evidence …]`
   — record the human/agent judgement as a polarity verification atom (reuses
   existing verifyAtom semantics; refuted skill hypotheses drop out of advise).
4. `aot sgt advise` — metacognition: inspect graph state and emit ranked next
   actions with rationale: unexpanded high-confidence hypotheses → expand;
   verified hypotheses → `sgt graph related <slug>` lateral moves; missing
   tokens from low-coverage hypotheses → refined `route` queries; refuted
   slugs → excluded. Output = machine-actionable `{action, command, why}` list.
5. `aot sgt trace [--graphFormat tree|mermaid|dot|canvas]` — unified render:
   existing graph renderers with skill atoms visually tagged (slug shown);
   traversal + reasoning interleaved in one artifact.
6. `aot sgt run "<query>" [--gap F] [--budget N]` — one-shot composition of
   1 + 4 + 2: route, advise, expand the top advised hypothesis (and, with
   `--gap`, the runner-up when its advise score is within the gap fraction of
   the top). Added by the integration A/B loop's latency critique: the
   interleaved arm paid three agent round-trips before first disclosure.
   Pure composition over `performSgtExpand`/`materializeRoutePlan`/
   `adviseCandidates` — same refusal matrix, idempotency, and error taxonomy
   as the separate commands (pinned by `tests/sgt-run.test.ts`). Judge and
   trace remain explicit follow-ups.

### Invariants
- I1: aot builds/tests green with **no sgt binary present** (bridge commands
  error cleanly with code `SGT_UNAVAILABLE`; everything else untouched).
- I2: All bridge outputs re-enter the standard aot pipeline: `analyze`,
  `graph`, gate mode, systems layer see skill atoms as ordinary atoms.
- I3: Refuted skill hypotheses are never re-suggested by `advise` and never
  re-expanded.
- I4: Determinism: same sgt JSON + same session ⇒ identical atom set (stable
  atom ids derived from slug/query hash, not counters, where feasible).
- I5: No corpus in repo: tests use fixture SGT_BIN scripts.

## 2b. Round 1 pinned semantics (implemented; later rounds MUST read these)

Implemented in `src/sgt-bridge.ts` + `aot sgt route|judge` (round 1). Pinned by
`tests/sgt-bridge.test.ts` and `tests/cli-sgt.test.ts`.

- **Real route-plan shape**: `decisionTree` is a TOP-LEVEL ARRAY of
  `{step, axis, choice, why, candidatesBefore, candidatesAfter, alternatives}`;
  skills carry `{slug, name, title, score, reasons, facets, storedAt}` and NO
  coverage. `coverage`/`matchedTokens`/`missingTokens` are optional-only
  (semantic/query-dag paths). Unknown fields pass through.
- **Deterministic ids** (Q1 resolved): namespace `sgt:q{sha256(normalized query)[:8]}:`
  with normalize = trim → collapse whitespace → lowercase → NFC. Atoms:
  `…p` (premise), `…r:{axis}` (reasoning, keyed by axis NAME so ids survive
  axis drops), `…h:{slug}` (hypothesis), `…j:{slug}:{polarity}` (judge verdict).
- **Confidence mapping** (Q2 resolved, revisable constants): score-only is the
  PRIMARY route-plan path. `mapSgtSkillConfidence`: coverage base ≥0.55→0.82,
  ≥0.30→0.68, ≥0.15→0.55, else 0.45; score-only base 0.62; both missing 0.60;
  score modifier ≥80→+0.08, ≥40→+0.04, ≥15→+0.00, <15→−0.05; clamp [0.40,0.92].
  `narrowingConfidence(before,after)`: before≤0→0.58; ratio≥1→0.56; else
  `0.56 + 0.28·(1−ratio)^0.7`, bounded [0.56,0.84].
- **Re-route/update discipline**: existing atoms are ONLY patched via
  `updateAtom` (never `processAtom` overwrite). Verified or refuted atoms are
  never rewritten by a re-route — judge verdicts outrank retrieval (I3 seed);
  they are reported under `preservedIds`.
- **Supersede**: sgt-namespace atoms (except `j:` verdicts) absent from the new
  plan get content prefix `[superseded by re-route] ` exactly once
  (check-before-prefix; re-running the same changed plan is a no-op) and
  confidence `min(prev, 0.35)`. `isVerified`/`isRefuted` are never touched.
- **Resurrect**: a later re-route whose plan contains a previously superseded
  atom restores it through the normal update path (prefix removed, confidence
  re-mapped) — UNLESS it is verified/refuted, in which case it stays exactly as
  judged (prefix and all). `advise`/`gc` rounds must treat prefixed atoms as
  inactive and judged atoms as settled.
- **planChanged**: derived purely from the materialization diff
  (`created + updated + superseded > 0`). No plan hash is persisted anywhere.
- **Judge**: `aot sgt judge <atomId|slug> --supports|--refutes` creates/updates
  `…j:{slug}:{polarity}` with `dependencies=[hypothesisId]`, default confidence
  0.85, `isVerified` at creation (unless `--pending`) so it rides the standard
  `verifyAtom` polarity propagation. Re-judging the same polarity updates in
  place; the opposite polarity creates the sibling atom and `aot analyze`
  surfaces the contradiction. Bare slugs matching hypotheses under multiple
  query hashes error with the candidate full ids; the `j:` namespace is always
  derived from the resolved hypothesis's atom id, never re-hashed.
- **Bridge failures**: every failure is `SGT_UNAVAILABLE` with detail
  `SGT_NOT_FOUND|SGT_TIMEOUT|SGT_EXIT_ERROR|SGT_BAD_JSON|SGT_SCHEMA_MISMATCH`;
  timeout is classified via kill/signal, non-zero exit wins over valid stdout
  JSON, `maxBuffer` is 16 MB, and argv is never shell-interpolated. Any bridge
  failure leaves session state byte-identical.

## 2c. Round 2 pinned semantics (implemented; later rounds MUST read these)

Implemented in `src/sgt-epistemics.ts` (shared read-only predicates),
`src/sgt-bridge.ts` (runSgtJson core + context-pack path), and
`aot sgt expand|advise` + judge evidence inheritance in `src/cli.ts`.
Pinned by `tests/sgt-epistemics.test.ts`, `tests/cli-sgt-expand.test.ts`,
`tests/cli-sgt-advise.test.ts`, and additive describes in
`tests/sgt-bridge.test.ts`. §2b is byte-untouched and remains binding.

### Live-binary verification of the context-pack envelope (D2 gating step)

Captured 2026-07-07 against sgt 0.7.0
(`sgt context pack kubernetes-deployment-creator--claude-specific--5eda8a52
--query "deploy kubernetes service" --budget 900 --format json`);
`ContextPackSchema` was frozen only after this observation:

```json
{
  "budget": { "requestedTokens": 900, "estimatedTokens": 500,
              "policy": "excerpt windows only; full source omitted" },
  "packets": [
    { "skill": { "slug": "kubernetes-deployment-creator--claude-specific--5eda8a52",
                 "name": "kubernetes-deployment-creator", "title": "|",
                 "facets": { "domain": "Infrastructure/DevOps/Deployment" },
                 "storedAt": "store/kubernetes-deployment-creator--claude-specific--5eda8a52" },
      "excerpts": [ { "heading": "intro", "score": 14, "excerpt": "--- name: ..." },
                    { "heading": "Example 1: Deploying a Web Application", "score": 6, "excerpt": "..." } ],
      "references": [] } ],
  "unresolvedSlugs": [],
  "omittedDueToBudget": []
}
```

Packets may additionally carry `contextDeferred: true` + `omittedReason`
(sgt.ts `RoutePacket`); references are `{kind, path, bytes}` from
`internalRefs`. All unknown fields pass through. A budget-starved pack can
return `packets: []` with the slug listed in `omittedDueToBudget` — the
schema treats that as valid; `aot sgt expand` maps a slug present in
`unresolvedSlugs` OR absent from `packets` to `SGT_SLUG_UNRESOLVED`.

- **runSgtJson core**: `runSgtRoutePlan` and `runSgtContextPack` are thin
  wrappers over one `runSgtJson(bin, argv, schema, opts)` core with the §2b
  error taxonomy (SGT_UNAVAILABLE + NOT_FOUND/TIMEOUT/EXIT_ERROR/BAD_JSON/
  SCHEMA_MISMATCH, SIGKILL timeout classification, non-zero-exit-wins, 16 MB
  maxBuffer, argv-array-never-shell). `runSgtContextPack` argv is pinned
  SINGLE-SLUG: `['context','pack',slug,'--query',q,'--format','json',
  ...optional --budget/--windows/--refs]` — expand never batches disclosure.
- **e:{slug} scaffold contract**: `aot sgt expand` upserts
  `sgt:q{hash}:e:{slug}` — atomType `verification`,
  `dependencies=[h:{slug}]`, confidence fixed 0.70
  (`EXPAND_SCAFFOLD_CONFIDENCE`), `isVerified:false`, NO polarity ever,
  content `sgt expand: {slug} ({N} excerpts, budget {B})`, evidence =
  provenance refs (below). The scaffold is a polarity-free disclosure
  record; `j:{slug}:{polarity}` remains the ONLY polarity carrier, so
  exactly one polarity propagation path exists and the round-1 judge
  contract (opposite-polarity sibling => analyze contradiction) is intact.
  Re-expand is diff-idempotent: identical content+evidence -> no write,
  `packChanged:false`, state file byte-identical; a changed pack patches via
  `updateAtom` (never a `processAtom` overwrite).
- **Refusal matrix**: expand refuses BEFORE spawning any subprocess
  (settled questions cost no context) with code `SGT_EXPAND_REFUSED` whose
  message contains the reason. `expandRefusal` precedence is pinned:
  `refuted` > `verified` > `superseded`; undefined = expandable.
- **Provenance string grammar** (evidence on scaffold and inherited by j:):
  `sgt:packet:{slug}:{headingKey}:{index}` per excerpt (index = position in
  the packet's excerpt array) and `sgt:ref:{slug}:{kind}:{basename}` per
  reference. Grammar regex:
  `^sgt:(?:packet:[^:]+:[^:]+:\d+|ref:[^:]+:[^:]+:[^:]+)$`.
  `headingKey` = NFC lowercase, `[^a-z0-9]+` -> `-`, trimmed of dashes, max
  48 chars (re-trimmed); symbol-only headings fall back to
  `x{sha256(heading)[:8]}`.
- **Evidence inheritance (deliverable c)**: at `j:` atom CREATION only, a
  live (non-superseded) `e:{slug}` scaffold's evidence is inherited by the
  verdict: scaffold packet refs in pack emission order, then explicit
  `--evidence` refs, deduped preserving first occurrence. Re-judges never
  re-sync: `--evidence` omitted leaves the existing `j:` evidence unchanged
  (round-1 behavior), even after a re-expand altered the scaffold.
- **Supersede exemption**: the round-1 supersede loop never emits `e:`
  scaffolds from plans, so re-routes exempt `e:{slug}` while `h:{slug}` is
  in the new plan (route -> expand -> identical re-route stays
  `planChanged:false`, byte-identical). When the hypothesis is dropped, BOTH
  `h:{slug}` and `e:{slug}` are superseded (prefix once, confidence
  min(prev, 0.35)). Superseded scaffolds are inactive for advise tier 2 and
  are revived only by a fresh expand (updateAtom path).
- **refutedSlugs is LIVE state (I3)**: the excluded-slug set derives from
  hypotheses currently `isRefuted` (any namespace) — never from mere
  `j:*:refutes` atom presence. Exclusion survives re-routes because judged
  hypotheses are preserved (§2b); a later `judge --supports` that clears
  `isRefuted` via verifyAtom makes the slug eligible again (pinned
  refute -> re-support -> advise transition).
- **Advise tier table** (`aot sgt advise`; pure session read, zero
  subprocess — works with no sgt binary, I1). One action per hypothesis
  atom, LOWEST tier wins; superseded hypotheses and refuted slugs are
  excluded from every tier:

  | tier | action | condition | score | command |
  |---|---|---|---|---|
  | 1 | expand | active, no live scaffold, conf >= `EXPAND_ADVISE_MIN_CONFIDENCE` (0.65) | confidence | `aot sgt expand {atomId} --budget 1200` |
  | 2 | judge | active, live scaffold, unsettled | confidence | `aot sgt judge {atomId}` + `argChoices: ["--supports","--refutes"]` |
  | 3 | related | verified | round4(conf*0.85) | `sgt graph related {slug}` |
  | 4 | refine | active, missingTokens non-empty, coverage undefined or < 0.30 | round4(0.50 + 0.08*min(len,6)) | `aot sgt route "{premise query} {missingTokens.join(' ')}"` |

  Total order: tier asc, score desc, atomId asc; `rank` = 1..N after
  `--limit` truncation; raw stdout is byte-stable across runs. Commands are
  directly executable — a command string never carries an `--a\|--b`
  alternation; when exactly one extra flag is required it rides in the
  separate `argChoices` array (pinned shape).
- **skillRef token extension**: `SkillRef` gains optional
  `matchedTokens`/`missingTokens` (additive); `planRouteAtoms` passes them
  through and `skillRefEquals` compares them with absent (undefined) and
  empty ([]) pinned as DISTINCT states — a re-route that adds/removes token
  arrays updates the atom exactly once, then goes quiet.
- **Resolver unification**: `resolveSgtHypothesis` (atomId | bare slug, with
  the §2b SGT_NOT_HYPOTHESIS / SGT_HYPOTHESIS_NOT_FOUND / SGT_AMBIGUOUS_SLUG
  taxonomy) lives in `sgt-epistemics.ts`; judge and expand share it —
  behavior-preserving for judge (round-1 pins pass unmodified).

## 2d. Round 3 pinned semantics (implemented)

Implemented in `src/graph-export.ts`/`src/graph-render.ts` (skillRef
carriage + tags), `src/sgt-epistemics.ts` (`advisePendingIssues`), and
`aot sgt trace` + analyze/gate awareness in `src/cli.ts`. Pinned by
`tests/cli-sgt-trace.test.ts`, `tests/cli-sgt-analyze.test.ts`,
`tests/sgt-provenance-golden.test.ts`, `tests/sgt-adversarial.test.ts`,
`tests/cli-sgt-e2e-contract.test.ts`, and additive describes in
`tests/graph-render.test.ts` / `tests/graph-export.test.ts` /
`tests/sgt-epistemics.test.ts`. §2b and §2c are byte-untouched and remain
binding.

- **`aot sgt trace`** mirrors `aot graph` exactly (`--graphFormat
  tree|mermaid|dot|canvas`, `--sessionId`, `--from`, `--title`, `--out`) and
  calls the SAME `exportGraph -> renderGraph` path — no parallel renderer.
  Zero subprocess (I1: works with `SGT_BIN` unset or pointing nowhere).
  stdout is byte-identical to `aot graph` for the same session and explicit
  `--graphFormat`; only the stderr hint label differs. Because skill atoms
  are ordinary atoms (I2), `aot graph` shows the tags too. Empty-session
  behavior is identical to `aot graph`; trace introduces NO new error codes.
- **skillRef carriage**: `GraphNode.skillRef?: SkillRef` (additive).
  `exportGraph` spreads it conditionally — payloads without skill atoms
  contain no `skillRef` key at all (byte-identical exports) — and
  `graphDataToAtoms` restores it, so export -> import -> re-export is
  byte-identical and `aot analyze --from <export>` sees the same skill state
  as the live session.
- **Tag grammar**: tree/mermaid/dot get ` [sgt:{slug}]` appended inside
  `nodeLabel()` AFTER content truncation (truncation boundaries unchanged;
  single space, literal brackets, slug verbatim). Canvas is NOT on the
  nodeLabel path: the card `text` gains a final `\nsgt:{slug}` line, content
  untouched, JSON structure unchanged. Non-skill nodes render
  character-identical to pre-round-3 output (pinned against goldens
  generated from the pre-change build in `tests/fixtures/graph-golden/`).
- **advise_pending lint**: `advisePendingIssues(atoms)` emits one issue per
  advise tier-1/tier-2 candidate — the SAME predicates as `aot sgt advise`
  (`adviseCandidates`), so analyze and advise can never disagree — with the
  pinned shape `{code: 'advise_pending', atomIds: [hypothesisId], message}`
  (message contains `awaits expand` for tier 1, `awaits judge` for tier 2;
  no severity, no notes[]). Zero subprocess. In `aot analyze` output the
  entries ride AFTER the graph-analysis issues (graph-analysis.ts stays
  sgt-free), sorted atomId asc.
- **Gate exemption (both directions, honest payload)**: the `issues` array
  ALWAYS contains the advise_pending entries; only gate selection filters
  them. With `--failOn` absent, gateIssues excludes codes in
  `GATE_EXEMPT_ISSUE_CODES = {advise_pending}` and the gate payload reports
  `failOn: 'all'` PLUS `exempt: ['advise_pending']` — 'all' is never a
  silent lie. An explicit `--failOn advise_pending` opts back in (exit 1;
  no `exempt` field when failCodes are explicit).
- **Build gap closed atomically**: every `cli-sgt*` suite calls
  `requireBuild()` (tests/helpers/sgt-cli-harness.ts) and FAILS with an
  actionable message when `build/cli.js` is absent — never a skip — and
  package.json `pretest` runs the build, so `npm test` is green from a
  clean checkout.

### Error-code inventory (all bridge failures leave state byte-identical)

| Code | Detail / condition | State |
|---|---|---|
| `SGT_UNAVAILABLE` | `SGT_NOT_FOUND` — binary missing (ENOENT) | never modified |
| `SGT_UNAVAILABLE` | `SGT_TIMEOUT` — SIGKILL after `SGT_TIMEOUT_MS` (classified via kill/signal) | never modified |
| `SGT_UNAVAILABLE` | `SGT_EXIT_ERROR` — non-zero exit (wins over valid stdout JSON) | never modified |
| `SGT_UNAVAILABLE` | `SGT_BAD_JSON` — unparseable stdout | never modified |
| `SGT_UNAVAILABLE` | `SGT_SCHEMA_MISMATCH` — JSON fails the route-plan/context-pack schema | never modified |
| `SGT_EXPAND_REFUSED` | hypothesis refuted/verified/superseded (checked BEFORE any subprocess) | never modified |
| `SGT_SLUG_UNRESOLVED` | slug in `unresolvedSlugs` or absent from `packets` | never modified |
| `SGT_NOT_HYPOTHESIS` | target atom exists but is not an sgt skill hypothesis | never modified |
| `SGT_HYPOTHESIS_NOT_FOUND` | no hypothesis matches the bare slug in the session | never modified |
| `SGT_AMBIGUOUS_SLUG` | bare slug matches hypotheses under multiple query hashes (candidates listed) | never modified |

## 3. Open design questions (for workflow rounds)
- Q1: stable atom-id scheme for idempotent re-route (hash prefix vs counter+index lookup).
- Q2: score→confidence mapping (tier table vs logistic on coverage; must be documented + tested).
- Q3: should `advise` emit causal links between co-supporting skills (systems layer tie-in) or defer?
- Q4: `sgt` side changes (private repo): optional `--trace aot` output shape, or keep aot-side adapter only? Default: adapter-only (loose coupling), revisit if adapter strains.
- Q5: `query dag` bridge (`aot sgt dag`) — worth a command, or advise-loop supersedes it?

## 4. MCP exposure strategy (documented, not implemented)

The CLI is the reference surface; MCP parity is deliberate but deferred.
Plan: extend the EXISTING `atomcommands` MCP tool (not new tools — the
3-tool surface is a deliberate constraint) with `sgt_route`, `sgt_judge`,
`sgt_expand`, and `sgt_advise` verbs that share the CLI's modules verbatim:
`sgt-bridge.ts` for subprocess + schemas, `sgt-epistemics.ts` for
predicates/resolution/advise candidates, and the same materialization
functions. Constraints carried over unchanged: refusal-before-subprocess
for `sgt_expand`, zero-subprocess `sgt_advise`, SGT_UNAVAILABLE taxonomy,
byte-identical state on failure, deterministic ids. Full parity slips to
Round 3; no MCP wiring exists in Round 2.

## 5. Round 3 deferrals (resolved)

Round 3 shipped `aot sgt trace` and the user-facing docs (README section,
CHANGELOG entry, dossier section). Everything else that was deferred here is
now frozen as the §7 won't-fix-in-v1 list D1-D7 so the final judge
adjudicates against one canonical list.

## 6. Round-2 must-fix traceability matrix

One row per Round-2 must-fix: spec clause -> source symbol -> pinning test
file -> adversarial counterexample that would have caught the original bug.

| Row | Must-fix | Spec clause | Source symbol | Test | Adversarial counterexample |
|---|---|---|---|---|---|
| MF1 | Provenance regex correction | §2c grammar | `SGT_PROVENANCE_REF_RE` (src/sgt-bridge.ts, exported) | tests/sgt-provenance-golden.test.ts | colon-bearing slug `sgt:packet:my:skill:intro:0` rejected; symbol-only-heading fallback `x{sha256[:8]}` and dotted ref basename `SKILL.md` accepted; negative-control regex is RECONSTRUCTED (verbatim Round-2 original not recoverable) encoding the documented failure mode (missing `ref:` arm, narrow headingKey charset) and must reject ≥1 golden vector |
| MF2 | `e:` diff-idempotency | §2c scaffold contract | expand upsert in `aot sgt expand` (src/cli.ts) | tests/cli-sgt-expand.test.ts | identical re-expand leaves state.json byte-identical (`packChanged:false`); changed pack patches via `updateAtom`, never a `processAtom` overwrite |
| MF3 | Refusal precedence refuted > verified > superseded | §2c refusal matrix | `expandRefusal` (src/sgt-epistemics.ts) | tests/cli-sgt-expand.test.ts, tests/sgt-adversarial.test.ts | simultaneously superseded+refuted hypothesis refuses with 'refuted'; `SGT_BIN=/nonexistent/binary` proves no subprocess is ever spawned |
| MF4 | Live `refutedSlugs` (I3) | §2c refutedSlugs-is-LIVE-state | `refutedSlugs` (src/sgt-epistemics.ts) | tests/cli-sgt-advise.test.ts | `j:*:refutes` atom still present but `isRefuted` cleared by a later `judge --supports` -> slug re-eligible (exclusion derives from live hypothesis state, never verdict-atom presence) |
| MF5 | `matchedTokens` undefined-vs-[] | §2c skillRef token extension | `skillRefEquals` (src/sgt-bridge.ts) | tests/sgt-adversarial.test.ts, tests/sgt-bridge.test.ts | re-route adding `missingTokens: []` updates the atom exactly once, then identical re-routes are byte-quiet |
| MF6 | Supersede exemption for `e:` while `h:` survives | §2c supersede exemption | supersede loop in `materializeRoutePlan` (src/cli.ts) | tests/cli-sgt-expand.test.ts | route -> expand -> identical re-route stays `planChanged:false` byte-identical; a dropped slug supersedes BOTH `h:` and `e:` with the prefix exactly once |

Note (matrix row anchors): the analyze issues shape is pinned by
`tests/graph-analysis.test.ts` and `tests/cli-sgt-analyze.test.ts` — NOT by
`tests/payload-shape.test.ts`, which pins processAtom v3 slim payloads.

## 7. Ship/no-ship checklist

### Binary gates (all must be green to ship)

| Gate | Claim | Pinned by |
|---|---|---|
| S1 | `aot sgt trace --graphFormat F` stdout byte-identical to `aot graph --graphFormat F` (explicit format, stdout only) for no-skill sessions, and both equal the pre-Round-3 goldens | tests/cli-sgt-trace.test.ts + tests/fixtures/graph-golden/ |
| S2 | trace and the advise_pending lint succeed with `SGT_BIN` unset AND `SGT_BIN=/nonexistent/binary` with identical stdout — zero subprocess (I1) | tests/cli-sgt-trace.test.ts |
| S3 | skillRef export shape guard + import round-trip (re-export byte-identical) + `analyze --from` parity with the live session | tests/graph-export.test.ts, tests/cli-sgt-analyze.test.ts |
| S4 | tag grammar in all four formats, appended after truncation, non-skill nodes character-identical | tests/graph-render.test.ts, tests/cli-sgt-trace.test.ts |
| S5 | advise_pending pinned to adviseCandidates tiers 1-2 with exact `{code, atomIds, message}` shape and atomId-asc ordering after graph-analysis issues | tests/sgt-epistemics.test.ts, tests/cli-sgt-analyze.test.ts |
| S6 | gate exemption both directions with honest payload (`failOn:'all'` + `exempt:['advise_pending']`; explicit `--failOn advise_pending` exits 1) | tests/cli-sgt-analyze.test.ts |
| S7 | provenance golden vectors, reconstructed negative control, and emitter/regex consistency through a real expand | tests/sgt-provenance-golden.test.ts |
| S8 | e2e contract loop through the BUILT CLI with byte-identical state at every refusal boundary and byte-stable final advise | tests/cli-sgt-e2e-contract.test.ts |
| S9 | adversarial suite: empty packets, unresolved slug, ambiguous slug, opposite-polarity siblings, mid-chain exit-error, superseded-scaffold revival, tokens idempotency | tests/sgt-adversarial.test.ts |
| S10 | `npm run smoke:sgt` exits 0: route -> advise -> expand -> advise -> judge -> trace (4 formats, mermaid byte-compared to snapshot, regenerable only via `UPDATE_SNAPSHOTS=1`) -> `aot analyze --gate` exit 0 | scripts/sgt-integration-smoke.sh, tests/cli-sgt-e2e-contract.test.ts |
| S11 | build gap closed atomically: `requireBuild()` fail-fast (never skip) in every cli-sgt suite + package.json `pretest` build, `npm test` green from a clean checkout | tests/helpers/sgt-cli-harness.ts, package.json |

### Won't-fix in v1 (frozen deferrals — the final judge may not re-open these)

| # | Deferral | Rationale |
|---|---|---|
| D1 | MCP `atomcommands` `sgt_route`/`sgt_judge`/`sgt_expand`/`sgt_advise` verbs (§4) | CLI is the reference surface; MCP parity is documented, deliberate, and unwired |
| D2 | `aot sgt dag` / Q5 (`query dag` bridge) | the advise loop supersedes the fixed ≤3-iteration scripted strategy |
| D3 | Q3 causal links between co-supporting skills (systems-layer tie-in in advise) | needs corpus-scale evidence before inventing edges |
| D4 | Q4 sgt-side `--trace aot` output shape | adapter-only stands until the adapter strains |
| D5 | advise_pending as a default gate failure / `--strict` flag | informational-by-default is the pinned round-3 contract; `--failOn advise_pending` already opts in |
| D6 | corpus or live sgt binary in CI (I5) | fixture SGT_BIN scripts only; the 536 MB corpus never enters CI |
| D7 | `skillRef` on non-hypothesis atom types | hypotheses are the only retrieval-claim carriers; widening dilutes I2 |

## Worked example — the interleaving, live

A single command sequence against the real sgt corpus (`SGT_BIN`), captured verbatim. It
shows sgt's progressive-disclosure graph traversal and aot's reasoning trace as **one
epistemic DAG**, not two systems: the sgt query becomes a `premise`, each decision-tree
axis a chained `reasoning` atom, each ranked skill a `hypothesis` (carrying `skillRef`
provenance), each budgeted `context pack` disclosure and each polarity judgement a
`verification` atom — all confidence-propagated by `aot analyze`.

```
$ aot sgt route "secure react api authentication with minimal context"   # sgt traversal -> atoms
$ aot sgt advise                                                          # metacognition: ranked next disclosure
$ aot sgt expand sgt:q…:h:auth-implementation-patterns…  --budget 900     # progressive disclosure -> scaffold
$ aot sgt judge  sgt:q…:h:auth-implementation-patterns…  --supports       # polarity verification
$ aot sgt trace                                                           # the unified interleaved graph:

[P] sgt:q63040425:p (95%) secure react api authentication with minimal context
└── [R] sgt:q63040425:r:domain (73%) domain: Software Engineering/Backend/APIs/Services (72->38)…
    ├── [H] …:h:building-api-authentication (70%) … [sgt:building-api-authentication]
    ├── [H] …:h:auth-implementation-patterns--claude-specific--3f524ab9 ✓ (70%) … [sgt:auth-implementation-patterns…]
    │   ├── [V] …:e:auth-implementation-patterns… (70%) sgt expand: budgeted excerpts disclosed
    │   └── [V] …:j:auth-implementation-patterns…:supports ✓ (85%) sgt judgement (supports)
    ├── [H] …:h:react-context-setup--claude-specific--0f3c8347 (66%) … [sgt:react-context-setup…]
    ├── [H] …:h:insecure-deserialization-checker--claude-specific--180f0399 (66%) … [sgt:insecure-deserialization-checker…]
    └── [H] …:h:obsidian-plugin-react-components--unknown--db996cfe (66%) … [sgt:obsidian-plugin-react-components…]
```

`aot sgt advise` closes the metacognitive loop: it reads the current epistemic state
(which hypotheses are unexpanded, which are settled, which are refuted) and emits the
ranked next action — expand high-confidence hypotheses, judge disclosed ones, explore
laterally, or refine the query — so the disclose→verify→re-route cycle is driven
programmatically from the graph, not by hand.
