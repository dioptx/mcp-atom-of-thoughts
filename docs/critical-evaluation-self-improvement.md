# Critical Evaluation and Self-Improvement Learnings

This document records a subagent-orchestrated critique of the five personal AoT CLI applications in `docs/personal-workflow-applications.md` and `examples/personal-workflows/`.

## Orchestration method

I attempted swarm-based parallel review first, but the active swarm had an existing coordinator in another session, so I switched to bounded read-only subagents. Each subagent reviewed one application artifact and returned: strengths, hidden assumptions, missing DAG dependencies, failure modes, validation gaps, refinements, and self-improvement lessons. The synthesis below converts those critiques into executable DAG refinements rather than leaving them as prose.

## Cross-cutting verdict

The first application portfolio was directionally strong: it mapped real user workflows to AoT DAGs, used dry-run previews, and named useful deliverables. The main weakness was that too many safety requirements existed only as prose constraints. A DAG that says “validate before mutation” is less useful than a DAG with explicit nodes for `DRY_RUN_PREVIEW`, `MANIFEST_VALIDATE`, `RETRY_OR_ESCALATE`, `PRE_SYNC_VALIDATE`, or `VERIFY_REMOTE`.

## Global self-improvement principles

1. **Promote prose safety into executable gates.** If a safety rule would cause regret when skipped, represent it as a node with dependencies and acceptance criteria.
2. **Split mega-validators.** A single `VERIFY` node hides skipped checks. Split tests, smoke, schema/docs, Caliber, diff scope, remote proof, and post-state verification.
3. **Baseline before mutation.** Memory graphs, remote document stores, release worktrees, and MCQ ledgers all need a before-state snapshot before writing.
4. **Treat identity preservation as first-class.** Rows, documents, SAQ IDs, cards, commits, and external refs need stable identifiers across every artifact.
5. **Model async readiness explicitly.** Upload success is not OCR/R2L readiness; sync success is not topology health; push success is not release verification.
6. **Validation feedback must become bounded retry structure.** `entails` is not enough for repair loops. Add retry counts, terminal escalation, and stopping criteria.
7. **Every produced artifact needs a schema or shape contract.** Evidence manifests, crosswalks, result JSON, topology deltas, smoke logs, and release envelopes should be machine-checkable.
8. **Capture near misses, not only successes.** Durable learning should include role-conflicts, unavailable tools, skipped providers, stale remote state, and assumptions that almost failed.

## Application-specific critique and refinements

### 1. ANZCA SAQ Syntopical Model-Answer Factory

**Critique:** Strong domain decomposition, but it assumed canonical SAQ resolution, source consistency, and validator sufficiency. It lacked explicit dry-run inspection, evidence manifest, citation audit, regression comparison, reviewer sign-off, and replay approval gates.

**Refinements applied:** `examples/personal-workflows/anzca-saq-syntopical-factory.dag.json` now includes `DRY_RUN_PREVIEW`, `EVIDENCE_MANIFEST`, `CITATION_AUDIT`, `REGRESSION_CHECK`, `REVIEW_SIGNOFF`, `REPLAY_GATE`, and richer acceptance criteria for `WRITE` and `PROVENANCE`.

**Self-improvement learning:** Separate content generation from educational-quality audit. A structurally valid answer can still be examiner-poor unless route, mark allocation, citation support, and reviewer sign-off are independently checked.

### 2. PageIndex R2L Evidence Crosswalk and PDF Ingestion

**Critique:** The original flow matched the real PageIndex lifecycle, but it assumed R2L readiness after upload and treated drift detection too late. It lacked vault identifier inventory, upload smoke test, async polling, manifest schema/idempotency validation, and rollback/reconcile paths.

**Refinements applied:** `examples/personal-workflows/pageindex-r2l-evidence-crosswalk.dag.json` now includes `VAULT_INDEX`, `SEGMENT_VALIDATE`, `UPLOAD_SMOKE_TEST`, `BATCH_UPLOAD`, `POLL_R2L_READY`, `MANIFEST_VALIDATE`, `CROSSWALK_VALIDATE`, and `ROLLBACK_OR_RECONCILE`.

**Self-improvement learning:** External-system workflows need readiness states, timeouts, and reconciliation nodes. “Command succeeded” is not enough for remote systems with background OCR, mutable folders, or eventual consistency.

### 3. MAK95 MCQ Five-Gate Closure and Cluster Governance

**Critique:** The original application captured closure intent and bounded-worker discipline, but it underspecified gate taxonomy, row identity, route-specific branching, and validator retry behavior. It risked treating all rows as needing grounding and allowing terminal/manual statuses to become escape hatches.

**Refinements applied:** `examples/personal-workflows/mak95-mcq-five-gate-closure.dag.json` now includes `ROW_INVENTORY`, `SCHEMA_LOCK`, `CLUSTER_AUDIT`, `EVIDENCE_BANK`, `ROUTE_AUDIT`, `RETRY_OR_ESCALATE`, and `MERGE_DRY_RUN`.

**Self-improvement learning:** All-rows-closed workflows are identity-preservation problems first and content-generation problems second. Every input row must have one stable output record, route, reason, and validator provenance.

### 4. Memex Agentic Memory Graph Maintenance Loop

**Critique:** The loop had good memory hygiene aims, but writing before a topology baseline was unsafe. It lacked dedup/contradiction checks, dry-run write previews, split sync validation, post-sync verification, and topology thresholds.

**Refinements applied:** `examples/personal-workflows/memex-graph-maintenance.dag.json` now includes `BASELINE`, `DEDUP`, `WRITE_DRY_RUN`, `WRITE_APPLY`, `PRE_SYNC_VALIDATE`, `SYNC_SCOPED_FILES`, and `POST_SYNC_VERIFY`.

**Self-improvement learning:** Memory writes should be governed like code changes: baseline, diff, validate, apply, post-verify. Graph repair and graph mutation are different operations.

### 5. Agent Tooling Release Orchestrator

**Critique:** The release lifecycle was correct but overcompressed. `VERIFY` and `RELEASE` hid many gates: dirty-state ownership, docs/schema sync, Caliber proof, remote target verification, scoped commit, post-push verification, and durable learning. It also assumed private remote hygiene rather than proving it.

**Refinements applied:** `examples/personal-workflows/agent-tooling-release-orchestrator.dag.json` now splits verification and release into `OWNERSHIP`, `VERIFY_TESTS`, `VERIFY_SMOKE`, `VERIFY_DOCS_SCHEMA`, `VERIFY_CALIBER`, `VERIFY_DIFF_SCOPE`, `VERIFY_REMOTE`, `COMMIT_SCOPED`, `PUSH_PRIVATE_REMOTE`, `VERIFY_REMOTE_STATE`, and `CAPTURE_LEARNING`.

**Self-improvement learning:** Release agents need ownership maps and abort criteria before editing. “Tests passed” is not release readiness unless remote target, diff scope, docs/schema consistency, and post-push state are also proven.

## Changes made from critique

- Refined all five application DAGs to include explicit gates and acceptance criteria.
- Updated `portfolio-meta.dag.json` with `SUBAGENT_REVIEW` and a critical-review constraint.
- Added regression tests that assert required gate nodes and acceptance criteria are present.
- Kept all reviewer work read-only and converted findings into versioned artifacts.

## Meta-learning about subagent orchestration

The subagents were useful because each reviewer saw only one application and therefore found local assumptions the primary agent glossed over. The orchestration failure was also instructive: swarm role state can persist across sessions, so future orchestration should first run a coordinator/readiness check and fall back to bounded subagents when swarm ownership is ambiguous.
