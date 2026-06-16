# Personal Workflow Applications for the AoT CLI

This guide turns prior session history and durable memory into five concrete projects where the AoT CLI is more than a note-taking tool. Each project has a runnable DAG example under `examples/personal-workflows/` and is intended to be run first with `--dryRun`, so agents can inspect planned AoT, br/beads, and Linear writes before mutating anything.

## Evidence base

The applications were selected from repeated patterns in session history and memory:

- MAK95/ANZCA SAQ generation repeatedly combines local SAQ notes, PEX routes, PageIndex evidence, validator contracts, and non-polluting AoT audit graphs.
- PageIndex work repeatedly involves R2L enablement, PDF segmentation, upload smoke tests, document-name drift, and vault evidence crosswalks.
- MCQ work repeatedly uses bounded recursive-research workers, clustering, five-gate validation, terminal/manual closure, and citation banks.
- Memex is a durable cross-session memory graph with recurring maintenance needs: scored recall, atomic cards, hub repair, and topology health.
- Agent tooling work repeatedly requires real workflow smoke tests, TDD, Caliber sync, br/bv/Linear previews, private remote hygiene, and durable learnings.

## Homoiconic use pattern

The CLI can organize its own adoption work:

```bash
node build/cli.js dag @examples/personal-workflows/portfolio-meta.dag.json --dryRun --linear --noGit --noBv --format json
```

This emits a pipeline envelope with `schemaVersion`, `runId`, `dag`, dry-run atoms, br preview, Linear preview, and skipped bv reason. Agents can attach that output to a work log, br issue, or Linear project without first creating tracker state.

## 1. ANZCA SAQ Syntopical Model-Answer Factory

**Why this is yours:** Repeated sessions show high-value work around MAK95/ANZCA model answers that combine local SAQ notes, PEX examiner routes, PageIndex textbook evidence, validator-visible route/audit sections, and non-polluting AoT audit graphs.

**Target outcome:** A repeatable command workflow that turns a batch of SAQ IDs into examiner-fit markdown answer sets with explicit evidence provenance, route/audit metadata, validation logs, and an optional br/bv project graph.

**Runnable DAG:** `examples/personal-workflows/anzca-saq-syntopical-factory.dag.json`

```bash
node build/cli.js dag @examples/personal-workflows/anzca-saq-syntopical-factory.dag.json --dryRun --linear --noGit --noBv --format json
```

### Implementation architecture

- **Inputs:** SAQ IDs, MAK95 source note paths, PEX outputs, PageIndex anchors, Enzyme/vault retrieval snippets, validator scripts.
- **AoT role:** turn the work into typed atoms where blocking prerequisites become hard dependencies, while rubric constraints, safety rules, and provenance requirements remain explicit `constrains`/`entails` edges.
- **br/beads role:** create durable issue rows keyed by `external_ref=aot:<session>:<node>` only after the dry-run preview is accepted.
- **bv role:** evaluate ready/blocked work after br sync, especially when the project fans out into multiple bounded workers.
- **Linear role:** optionally mirror high-level project nodes and relations for cross-device/project planning, with stable AoT external refs for dedupe.

### Execution phases

1. **Resolve SAQ batch and canonical vault paths:** Input AP/CP question IDs are resolved to canonical MAK95 note paths, existing model-answer destinations, and validator expectations.
2. **Retrieve PEX, PageIndex, and vault evidence:** Run PEX scope/examiner/brief/layers, PageIndex source orientation, Enzyme/vault retrieval, and local textbook import lookups.
3. **Derive answer route and mark allocation:** Convert evidence into route primitives, mark budget, examiner traps, and 8-minute answer shape.
4. **Generate model answer set:** Write model-answer-set markdown with source wikilinks, BORROW, answer, examiner-fitness audit, defect class, regression note, and reviewer sign-off.
5. **Run validator and coverage audit:** Run the MAK95 answer validator and a citation/link checker; only then optionally sync AoT/br and run bv triage.
6. **Preserve non-polluting reasoning graph:** Export AoT atoms or dry-run br plan as an audit trail without polluting issue trackers by default.

### Validation gates

- Run the DAG command above with `--dryRun` and inspect `dag.blockingEdgeCount`, planned br creates, and planned Linear relations.
- Run the domain validator before any replay: `validate_answer_markdown.py <answer-set> --vault-root <mak95-root>` plus link/citation checks
- Confirm every output artifact has resumable provenance: command, source paths, run ID, and validation result.
- Only then replay without `--dryRun` or sync to br/Linear.

### Deliverables

- Model-answer-set markdown
- Evidence bundle manifest
- Validator log
- AoT/br/bv dry-run or replay output
- Memex summary card

## 2. PageIndex R2L Evidence Crosswalk and PDF Ingestion

**Why this is yours:** Prior sessions repeatedly handled PageIndex folder browsing, R2L enabling, PDF segmentation, upload validation, document-name drift, and PageIndex-to-vault SAQ/LO crosswalks.

**Target outcome:** A safe ingestion project that segments local PDFs, uploads/updates PageIndex documents with R2L, records document IDs and page anchors, and emits a vault-facing crosswalk for SAQ, LO, and MCQ grounding.

**Runnable DAG:** `examples/personal-workflows/pageindex-r2l-evidence-crosswalk.dag.json`

```bash
node build/cli.js dag @examples/personal-workflows/pageindex-r2l-evidence-crosswalk.dag.json --dryRun --linear --noGit --noBv --format json
```

### Implementation architecture

- **Inputs:** Local PDFs, PageIndex folder/document manifests, R2L status, segmentation indexes, vault SAQ/LO/MCQ identifiers.
- **AoT role:** turn the work into typed atoms where blocking prerequisites become hard dependencies, while rubric constraints, safety rules, and provenance requirements remain explicit `constrains`/`entails` edges.
- **br/beads role:** create durable issue rows keyed by `external_ref=aot:<session>:<node>` only after the dry-run preview is accepted.
- **bv role:** evaluate ready/blocked work after br sync, especially when the project fans out into multiple bounded workers.
- **Linear role:** optionally mirror high-level project nodes and relations for cross-device/project planning, with stable AoT external refs for dedupe.

### Execution phases

1. **Inventory local PDFs and remote PageIndex folders:** List local PDFs, existing remote docs, R2L status, folder IDs, and deletion/reupload constraints.
2. **Segment large PDFs into topic-level documents:** Use the PageIndex CLI segmentation plan to split high-density notes into stable topic PDFs with deterministic names and page ranges.
3. **Upload or update with R2L enabled:** Perform one-document apply smoke test, then batch upload with R2L and folder placement; avoid destructive deletion unless API behavior is proven.
4. **Capture PageIndex IDs, R2L state, and anchors:** Persist document IDs, fileName, folder, page ranges, and OCR/R2L readiness into a local manifest.
5. **Build SAQ/LO/MCQ evidence crosswalk:** Map PageIndex documents and page anchors onto vault SAQs, learning objectives, MCQs, and future answer generation bundles.
6. **Audit drift and unresolved sources:** Detect missing file names, API remove failures, unmapped documents, duplicate IDs, and stale R2L statuses.

### Validation gates

- Run the DAG command above with `--dryRun` and inspect `dag.blockingEdgeCount`, planned br creates, and planned Linear relations.
- Run the domain validator before any replay: one-document upload/R2L smoke test, manifest diff, duplicate ID checks, and unmapped-source report
- Confirm every output artifact has resumable provenance: command, source paths, run ID, and validation result.
- Only then replay without `--dryRun` or sync to br/Linear.

### Deliverables

- Segmentation plan
- Upload/R2L manifest
- PageIndex document ID map
- SAQ/LO/MCQ crosswalk
- Drift/unmapped-source report

## 3. MAK95 MCQ Five-Gate Closure and Cluster Governance

**Why this is yours:** History shows repeated MCQ deduplication, clustering, bounded-worker finish-runs, recursive research batches, terminalization, and validator pressure around every row in a batch needing explicit closure.

**Target outcome:** A controlled MCQ workflow where every row is either repaired, grounded, deduplicated, clustered, or terminal/manual with a machine-readable reason, then merged only after validator success.

**Runnable DAG:** `examples/personal-workflows/mak95-mcq-five-gate-closure.dag.json`

```bash
node build/cli.js dag @examples/personal-workflows/mak95-mcq-five-gate-closure.dag.json --dryRun --linear --noGit --noBv --format json
```

### Implementation architecture

- **Inputs:** MCQ markdown/CSV corpus, latest five-gate ledger, assigned batch JSON, validator command, PageIndex citation banks.
- **AoT role:** turn the work into typed atoms where blocking prerequisites become hard dependencies, while rubric constraints, safety rules, and provenance requirements remain explicit `constrains`/`entails` edges.
- **br/beads role:** create durable issue rows keyed by `external_ref=aot:<session>:<node>` only after the dry-run preview is accepted.
- **bv role:** evaluate ready/blocked work after br sync, especially when the project fans out into multiple bounded workers.
- **Linear role:** optionally mirror high-level project nodes and relations for cross-device/project planning, with stable AoT external refs for dedupe.

### Execution phases

1. **Load MCQ corpus, ledgers, and batch schema:** Read MCQ markdown/CSV sources, latest five-gate ledger, batch JSON, assigned result path, and validator command.
2. **Deduplicate and cluster stems/options:** Normalize stems/options, cluster keyed-answer variants, and group by subtopic/frontmatter plus semantic near-duplicates.
3. **Route each row through five gates:** For each MCQ row, classify as repairable, needs citation-bank grounding, duplicate merge, terminal placeholder, or manual review.
4. **Ground option explanations with PageIndex anchors:** Prefer PageIndex page anchors and local evidence banks over generic web citations; reuse cluster-level citation banks for speed.
5. **Write bounded result JSON only:** Write the assigned result file without editing ledgers or canonical CSVs; include every original batch row or a valid terminal/manual status.
6. **Run validator and merge dry-run:** Run the supplied validator, then dry-run merge/fast-closure before any canonical mutation.

### Validation gates

- Run the DAG command above with `--dryRun` and inspect `dag.blockingEdgeCount`, planned br creates, and planned Linear relations.
- Run the domain validator before any replay: the supplied five-gate result validator and merge dry-run, requiring every original row to be represented
- Confirm every output artifact has resumable provenance: command, source paths, run ID, and validation result.
- Only then replay without `--dryRun` or sync to br/Linear.

### Deliverables

- Cluster report
- Citation bank
- Assigned result JSON
- Validator log
- Merge dry-run summary

## 4. Memex Agentic Memory Graph Maintenance Loop

**Why this is yours:** The user relies on memex as durable cross-session memory, with known risks around verbose output, orphan cards, dangling hubs, direct index sprawl, and recall packets needing scoring rather than dumps.

**Target outcome:** A scheduled or on-demand maintenance project that converts session learnings into atomic cards, repairs graph topology, keeps semantic spines healthy, and validates graph health before sync.

**Runnable DAG:** `examples/personal-workflows/memex-graph-maintenance.dag.json`

```bash
node build/cli.js dag @examples/personal-workflows/memex-graph-maintenance.dag.json --dryRun --linear --noGit --noBv --format json
```

### Implementation architecture

- **Inputs:** Session summaries, memex recall packets, doctor/organize/topology output, unresolved aliases, candidate durable learnings.
- **AoT role:** turn the work into typed atoms where blocking prerequisites become hard dependencies, while rubric constraints, safety rules, and provenance requirements remain explicit `constrains`/`entails` edges.
- **br/beads role:** create durable issue rows keyed by `external_ref=aot:<session>:<node>` only after the dry-run preview is accepted.
- **bv role:** evaluate ready/blocked work after br sync, especially when the project fans out into multiple bounded workers.
- **Linear role:** optionally mirror high-level project nodes and relations for cross-device/project planning, with stable AoT external refs for dedupe.

### Execution phases

1. **Start with scored recall packet:** Retrieve task-specific memex cards with compact results, then read only necessary leaf cards.
2. **Observe session decisions and gotchas:** Identify durable insights from actual work: architecture decisions, root causes, conventions, and repeated mistakes.
3. **Write atomic linked cards:** Use memex_retro for one insight per card; link through semantic spines or canonical hubs rather than direct index sprawl.
4. **Repair topology and unresolved aliases:** Run scoped organize/doctor/topology scripts; create routing hubs for repeated unresolved concepts, but avoid maintenance-card PageRank bloat.
5. **Sync and verify graph health:** Run doctor/topology metrics and sync only scoped card/report files; never commit derived embeddings caches.
6. **Generate next-session wakeup brief:** Emit compact AAAK-style context for future agents: decisions, gotchas, open loops, and relevant card slugs.

### Validation gates

- Run the DAG command above with `--dryRun` and inspect `dag.blockingEdgeCount`, planned br creates, and planned Linear relations.
- Run the domain validator before any replay: `memex doctor`, scoped `memex organize --since`, topology metrics, and sync status
- Confirm every output artifact has resumable provenance: command, source paths, run ID, and validation result.
- Only then replay without `--dryRun` or sync to br/Linear.

### Deliverables

- Atomic cards
- Alias/hub repair report
- Topology metrics
- Sync log
- Next-session wakeup brief

## 5. Agent Tooling Release Orchestrator

**Why this is yours:** Sessions show ongoing work on Jcode, skills, Caliber sync, agent CLI indexes, subagent/swarm constraints, br/bv, Linear, and private repo release hygiene.

**Target outcome:** A release orchestration project that turns tool changes into an explicit reasoning DAG with tests, docs, Caliber sync, issue-tracker previews, safe pushes, and post-release memory capture.

**Runnable DAG:** `examples/personal-workflows/agent-tooling-release-orchestrator.dag.json`

```bash
node build/cli.js dag @examples/personal-workflows/agent-tooling-release-orchestrator.dag.json --dryRun --linear --noGit --noBv --format json
```

### Implementation architecture

- **Inputs:** Dirty git state, CLI help/schema, failing smoke workflows, tests, Caliber config, remotes, pre-push hooks.
- **AoT role:** turn the work into typed atoms where blocking prerequisites become hard dependencies, while rubric constraints, safety rules, and provenance requirements remain explicit `constrains`/`entails` edges.
- **br/beads role:** create durable issue rows keyed by `external_ref=aot:<session>:<node>` only after the dry-run preview is accepted.
- **bv role:** evaluate ready/blocked work after br sync, especially when the project fans out into multiple bounded workers.
- **Linear role:** optionally mirror high-level project nodes and relations for cross-device/project planning, with stable AoT external refs for dedupe.

### Execution phases

1. **Discover tool surface and constraints:** Inspect CLI help/schema, existing tests, AGENTS/Caliber rules, remotes, dirty state, and optional external tools.
2. **Write tests from real workflow friction:** Exercise the CLI as an agent would, encode failures as focused tests, and confirm red before patching.
3. **Patch through adapter layers:** Implement minimal changes in small integration adapters rather than bloating the command surface.
4. **Update agent-facing docs and examples:** Update README/agent docs/changelog/examples with command shapes, dry-run paths, and structured outputs.
5. **Run build, tests, smoke, Caliber, and diff checks:** Run full test/build, targeted smoke workflows, git diff --check, Caliber refresh or hook, and pre-push checks.
6. **Commit, push, and capture learnings:** Commit scoped changes, push to the intended private remote without disturbing upstream origin, verify remote, and save durable memex learning.

### Validation gates

- Run the DAG command above with `--dryRun` and inspect `dag.blockingEdgeCount`, planned br creates, and planned Linear relations.
- Run the domain validator before any replay: targeted red/green test, full build/test, smoke commands, `git diff --check`, Caliber refresh/hook, and remote verification
- Confirm every output artifact has resumable provenance: command, source paths, run ID, and validation result.
- Only then replay without `--dryRun` or sync to br/Linear.

### Deliverables

- Failing then passing tests
- Minimal adapter-layer patch
- Docs/changelog/examples
- Commit and push proof
- Durable learning card


## Rollout sequence

1. Start with the portfolio meta DAG dry-run.
2. Pick one project DAG and run it in dry-run mode.
3. If the preview matches intent, run the domain-specific retrieval/generation/validation steps.
4. Sync to br/beads and run bv only after local artifacts pass validators.
5. Save the project result as a memex card with links to the DAG example, output artifacts, and validation logs.

## Example validation loop

```bash
for f in examples/personal-workflows/*.dag.json; do
  node build/cli.js dag @$f --dryRun --linear --noGit --noBv --format json >/tmp/aot-$(basename "$f" .json).json
done
npm test -- tests/application-dag-examples.test.ts
```
