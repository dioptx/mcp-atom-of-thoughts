# Second-Pass Self-Improvement

This pass evaluated the first critical-review refinements from three cross-cutting angles: machine enforceability, operational adoption, and risk/reversibility.

## Second-pass reviewers

1. **Machine-enforceability reviewer**
   - Found that gates existed, but acceptance criteria and safety rules were still mostly free text.
   - Recommended typed safety metadata, command/proof artifacts, schema references, and tests that enforce self-improvement loops.

2. **Operational-adoption reviewer**
   - Verified that every DAG preview runs through `aot dag --dryRun`.
   - Found that the examples were preview-runnable, not end-to-end runnable workflows.
   - Recommended a dry-run harness, run outputs, command contracts, and package scripts.

3. **Risk/reversibility/privacy reviewer**
   - Found that external mutation, durable memory writes, and release pushes need typed approval/checkpoint/rollback/privacy fields.
   - Recommended pre-mutation gates, rollback metadata, privacy scans, timeout/retry bounds, and failure containment.

## Changes made

- Added `schemas/personal-workflows/safety-metadata.schema.json`.
- Added typed `metadata.safety` and `metadata.operational` to high-risk nodes in every personal workflow DAG.
- Added `scripts/run-personal-workflows.mjs` to run all workflow DAGs and persist run envelopes under `out/personal-workflows/`.
- Added `npm run examples:dry-run`.
- Added `out/` to `.gitignore` so generated run envelopes do not pollute commits.
- Strengthened `tests/application-dag-examples.test.ts` to enforce:
  - subagent-derived gate presence,
  - acceptance criteria for high-risk nodes,
  - typed safety metadata,
  - dry-run operational command templates,
  - schema and harness availability.

## Current safety metadata contract

High-risk nodes now carry:

```json
{
  "metadata": {
    "safety": {
      "riskLevel": "medium",
      "mutationSurface": ["filesystem", "br", "linear"],
      "dryRunRequired": true,
      "requiresApproval": true,
      "checkpointArtifact": "out/personal-workflows/<slug>/{runId}/<node>-checkpoint.json",
      "rollbackPlan": "Restore from checkpoint artifact or stop with a partial-failure manifest if not reversible.",
      "privacyScan": false,
      "maxRetries": 1,
      "timeoutSeconds": 120,
      "abortOnFailure": true
    },
    "operational": {
      "commandTemplate": "node build/cli.js dag @examples/personal-workflows/<slug>.dag.json --dryRun --linear --noGit --noBv --format json",
      "proofArtifact": "out/personal-workflows/<slug>/{runId}/<node>-proof.json",
      "schemaRef": "schemas/personal-workflows/safety-metadata.schema.json"
    }
  }
}
```

## Dry-run harness

After building the CLI, run:

```bash
npm run examples:dry-run
```

This writes per-workflow envelopes:

```text
out/personal-workflows/<slug>/<runId>/command.json
out/personal-workflows/<slug>/<runId>/pipeline.json
out/personal-workflows/<slug>/<runId>/summary.json
out/personal-workflows/<slug>/<runId>/stdout.txt
out/personal-workflows/<slug>/<runId>/stderr.txt
```

The harness does not execute domain side effects. It runs the AoT DAG previews and records the command/proof envelope needed for later replay or audit.

## New self-improvement rule

A workflow is not operational just because its DAG preview runs. It becomes operational when each high-risk node has:

1. typed safety metadata,
2. command/proof metadata,
3. acceptance criteria,
4. a checkpoint and rollback story,
5. privacy classification when durable or external data is involved,
6. generated run artifacts that a later agent can resume.

## Remaining frontier

The next improvement should convert named deliverables into domain-specific JSON schemas, for example:

- ANZCA evidence manifest schema,
- PageIndex R2L manifest schema,
- MCQ five-gate result schema,
- memex topology delta schema,
- release proof envelope schema.

That is a separate layer above the generic safety metadata added here.
