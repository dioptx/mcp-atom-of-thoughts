<div align="center">

# Atom of Thoughts

Structured reasoning for LLMs. Decompose, track confidence, visualize, approve.

[![npm version](https://img.shields.io/npm/v/@dioptx/mcp-atom-of-thoughts?color=0969da)](https://www.npmjs.com/package/@dioptx/mcp-atom-of-thoughts)
[![license](https://img.shields.io/npm/l/@dioptx/mcp-atom-of-thoughts?color=22c55e)](LICENSE)
[![node](https://img.shields.io/node/v/@dioptx/mcp-atom-of-thoughts)](package.json)
[![tests](https://img.shields.io/badge/tests-217%20passed-brightgreen)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](tsconfig.json)

![Atom of Thoughts: live TUI watching reasoning unfold](assets/demo-watch.gif)

</div>

---

## Quickstart

**1.** Add to your MCP config:

```json
{
  "mcpServers": {
    "atom-of-thoughts": {
      "command": "npx",
      "args": ["-y", "@dioptx/mcp-atom-of-thoughts"]
    }
  }
}
```

**2.** Restart your client.

If `npx` returns a registry 404 before this release is published, use the source install path below and set the MCP command to `mcp-atom-of-thoughts`.

**3.** Ask the model to reason something through:

> *"Use AoT-fast to think through whether we should use JWT or session-based auth for the API."*

The model breaks the problem into five kinds of atoms (premise, reasoning, hypothesis, verification, conclusion), each tagged with a confidence score. You get a structured chain you can audit, not a black-box answer.

> [!TIP]
> Works with Claude Code, Cursor, Windsurf, or any MCP-aware client.

## Install

**Source install** *(reliable when the npm registry package is not yet published)*
```bash
git clone https://github.com/dioptx/mcp-atom-of-thoughts.git
cd mcp-atom-of-thoughts
npm ci
npm run build
npm link
```

**npx** *(once published; zero install, always latest)*
```json
{ "command": "npx", "args": ["-y", "@dioptx/mcp-atom-of-thoughts"] }
```

**npm global** *(once published)*
```bash
npm install -g @dioptx/mcp-atom-of-thoughts
```
```json
{ "command": "mcp-atom-of-thoughts" }
```

Global install also exposes the agent-friendly `aot` CLI:

```bash
aot --help
aot --llms
```

**Smithery**
```bash
npx -y @smithery/cli install @dioptx/mcp-atom-of-thoughts --client claude
```

**Docker**
```bash
docker build -t aot .
```
```json
{ "command": "docker", "args": ["run", "-i", "--rm", "aot"] }
```

## How it works

```mermaid
graph LR
    P["P · Premise"]:::premise --> R["R · Reasoning"]:::reasoning
    R --> H["H · Hypothesis"]:::hypothesis
    H --> V["V · Verification"]:::verification
    V --> C["C · Conclusion"]:::conclusion

    classDef premise fill:#6b7280,stroke:#9ca3af,color:#fff,font-weight:bold
    classDef reasoning fill:#3b82f6,stroke:#60a5fa,color:#fff,font-weight:bold
    classDef hypothesis fill:#eab308,stroke:#facc15,color:#000,font-weight:bold
    classDef verification fill:#06b6d4,stroke:#22d3ee,color:#fff,font-weight:bold
    classDef conclusion fill:#22c55e,stroke:#4ade80,color:#fff,font-weight:bold
```

Atoms chain through dependencies. Each carries a confidence score from 0 to 1. Reasoning terminates when a high-confidence conclusion lands or max depth is hit. Each problem runs in its own session, so two threads of thought never bleed into each other.

## Tools

Three tools cover the full surface:

| Tool | When to reach for it |
|------|---------------------|
| **`AoT-fast`** | Default. Tradeoffs, debugging, decisions, option evaluation. Depth 3. |
| **`AoT-full`** | Plans, architecture, decomposition into sub-problems. Depth 5. |
| **`atomcommands`** | Sessions, export, approval polling, decomposition lifecycle. |

### Quick example

```
AoT-fast({atomId:"P1", content:"API returns 500 on POST /users",     atomType:"premise"})
AoT-fast({atomId:"R1", content:"Unhandled exception in route handler", atomType:"reasoning", dependencies:["P1"]})
AoT-fast({atomId:"C1", content:"Add try-catch in POST handler",       atomType:"conclusion", dependencies:["R1"], confidence:0.9})
```

Only `atomId`, `content`, and `atomType` are required. Everything else has sensible defaults.

## Agent CLI

`aot` is a native, stateful CLI for agents and humans who need the same reasoning graph outside MCP stdio. It uses the same AoT server state, emits structured output via incur (`--format json`, `--schema`, `--llms`), and keeps MCP server mode explicit with `aot server` or `aot --mcp`.

```bash
# Add atoms to persistent CLI state
aot fast premise P1 "API returns 500" --confidence 0.9
aot fast reasoning R1 "Handler likely throws" --deps P1

# Batch JSON from a file or stdin in one locked transaction
aot batch @atoms.json --noBeads

# Sync the active AoT graph to br/beads, then ask bv for next work
aot audit triage --maxResults 5
```

### DAG planning across AoT, br, bv, Git, and Linear

Use `aot dag` when an agent needs to encode a task graph with hard dependencies plus softer constraints and entailments. The command accepts JSON, `@file`, or stdin, then can create AoT atoms, sync br/beads dependencies, optionally create Linear issues/relations, capture Git context, and run bv robot triage.

```json
{
  "title": "Auth hardening",
  "sessionId": "auth-hardening",
  "constraints": ["preview before mutating external trackers"],
  "nodes": [
    { "id": "REQ", "title": "Define auth contract", "type": "constraint" },
    { "id": "IMPL", "title": "Implement auth adapter", "type": "task", "dependsOn": ["REQ"] },
    { "id": "VAL", "title": "Validate auth flow", "type": "validation" }
  ],
  "edges": [
    { "from": "IMPL", "to": "VAL", "type": "entails", "blocking": false },
    { "from": "VAL", "to": "IMPL", "type": "constrains", "description": "implementation must satisfy validation" }
  ]
}
```

```bash
# Safe preview: no AoT state, br, Linear, or bv mutations
aot dag @dag.json --dryRun --linear --format json

# Apply after inspecting dry-run output
aot dag @dag.json --linear --linearTeam ENG --brCwd . --maxResults 5
```

Relationship semantics:

| DAG relation | Scheduling effect | br/beads mapping | Linear mapping |
|--------------|-------------------|------------------|----------------|
| `depends_on`, `requires`, `blocks` | hard blocker | `blocks` dependency | `blocks` relation |
| `constrains` | guardrail/validation constraint | typed dependency metadata | `related` unless `blocking:true` |
| `entails` | downstream consequence/readiness | typed dependency metadata | `related` unless `blocking:true` |
| `related` | context only | typed dependency metadata | `related` |

Safety contract:

- Pipeline outputs include `schemaVersion`, `runId`, `generatedAt`, and `pipeline`.
- `--dryRun` returns planned AoT/br/Linear actions without external side effects.
- Linear sync follows `linear-cli` 0.3.25 conventions: labels use repeated `--labels <label>` flags; issue retries search all candidates, fetch each candidate's full details, and reuse only an exact `AoT external ref: aot:<session>:<node>` line; failed lookups abort before the corresponding create/add, and relation retries require one record matching both type and endpoint.
- Linear descriptions are sent on stdin with `--description -`, so markdown never leaks into shell argv.
- External command failures return structured `{status:"error", code, command, args, exitCode, stderrHint}` payloads.

For larger real-world patterns, see [`docs/personal-workflow-applications.md`](docs/personal-workflow-applications.md), the critique synthesis in [`docs/critical-evaluation-self-improvement.md`](docs/critical-evaluation-self-improvement.md), the second-pass safety harness in [`docs/second-pass-self-improvement.md`](docs/second-pass-self-improvement.md), and the runnable DAGs under [`examples/personal-workflows/`](examples/personal-workflows/). They show how to apply the CLI homoiconically to ANZCA SAQ synthesis, PageIndex/R2L ingestion, MAK95 MCQ closure, memex graph maintenance, and agent-tooling releases.

After building, run all personal workflow previews and persist resumable envelopes with:

```bash
npm ci
npm run build
npm run examples:dry-run
# or keep generated envelopes outside the repo
npm run examples:dry-run -- --out=/tmp/aot-personal-workflows
```

## Skill graph bridge (`aot sgt`)

Loose coupling to the external [skill-graph-traversal](https://github.com/zpankz/sgt) CLI: `aot` shells out to the `sgt` binary (`SGT_BIN` env, default `sgt`; `SGT_TIMEOUT_MS` for the subprocess timeout), materializes deterministic route plans as ordinary AoT atoms (`sgt:q{hash}:` namespace), and steers the next traversal from the session's epistemic state. Full contract: [`docs/sgt-integration-spec.md`](docs/sgt-integration-spec.md).

| Command | Purpose | Subprocess |
|---|---|---|
| `aot sgt route "<query>"` | `sgt route plan` → premise + reasoning chain + skill hypotheses with `skillRef` provenance; idempotent per (session, query) | yes |
| `aot sgt expand <atomId\|slug>` | progressive disclosure: `sgt context pack` excerpts + a pending `e:{slug}` verification scaffold; refuses settled hypotheses BEFORE spawning | yes |
| `aot sgt judge <atomId\|slug> --supports\|--refutes` | polarity verdict atom (`j:{slug}:{polarity}`) riding standard verifyAtom propagation | no |
| `aot sgt advise` | ranked `{action, command, why}` next steps from session state alone | no |
| `aot sgt trace --graphFormat tree\|mermaid\|dot\|canvas` | unified trace through the `aot graph` renderers with skill atoms tagged `[sgt:slug]`; byte-identical to `aot graph` when no skill atoms exist | no |
| `aot sgt run "<query>" [--gap F]` | one-shot `route` + `advise` + `expand <top advised>` (one round-trip instead of three); `--gap 0.15` also discloses the runner-up when advise scores it within 15% of the top | yes |

`aot analyze` lints stale skill hypotheses as informational `advise_pending` issues (`awaits expand` / `awaits judge`). They always appear in `issues`, but the default `--gate` exempts them (the gate payload reports `failOn: 'all'` plus `exempt: ['advise_pending']`); opt in explicitly with `--failOn advise_pending`.

Error-code inventory — every one of these leaves session state byte-identical (state never modified):

| Code | Meaning |
|---|---|
| `SGT_UNAVAILABLE` (`SGT_NOT_FOUND`) | sgt binary missing |
| `SGT_UNAVAILABLE` (`SGT_TIMEOUT`) | subprocess exceeded `SGT_TIMEOUT_MS` (SIGKILL) |
| `SGT_UNAVAILABLE` (`SGT_EXIT_ERROR`) | non-zero exit — wins over valid stdout JSON |
| `SGT_UNAVAILABLE` (`SGT_BAD_JSON`) | unparseable stdout |
| `SGT_UNAVAILABLE` (`SGT_SCHEMA_MISMATCH`) | JSON fails the route-plan/context-pack schema |
| `SGT_EXPAND_REFUSED` | hypothesis refuted/verified/superseded — refused before any subprocess |
| `SGT_SLUG_UNRESOLVED` | context pack did not resolve the slug |
| `SGT_NOT_HYPOTHESIS` | target atom is not an sgt skill hypothesis |
| `SGT_HYPOTHESIS_NOT_FOUND` | no hypothesis matches the bare slug |
| `SGT_AMBIGUOUS_SLUG` | bare slug matches hypotheses under multiple query hashes |

Smoke the whole loop against the fixture binary (no corpus, no network): `npm run smoke:sgt`.

### Visualization

Pass `viz: true` on any call to open an interactive D3 graph in the browser:

```
AoT-fast({atomId:"C1", ..., viz: true})
```

Approve and reject decisions POST back to the server over HTTP. No filesystem polling.

## Live TUI

Watch the model reason in a second terminal pane while it works, and feed approve/reject decisions back into the next tool call. The event feed is on by default; nothing extra to configure.

In a second pane next to your LLM client:

```bash
npx -y @dioptx/mcp-atom-of-thoughts tui
```

### 1. Watch reasoning unfold

![Watch atoms streaming in](assets/demo-watch.gif)

Atoms appear as the model emits them, walking the chain premise → reasoning → hypothesis → verification → conclusion. Confidence bars fill in real time, dependencies show as inline arrows, and a velocity sparkline tracks event rate. Auto-scroll keeps the newest atom selected.

### 2. Give granular feedback

![Accept, reject with note, submit](assets/demo-feedback.gif)

`j` / `k` move the selection. `a` accepts an atom; `*` stars it as critical context; `r` rejects it and prompts for a one-line reason. `s` submits the verdict. The submit flash tells you exactly what to do next: ask the model to call `atomcommands check_approval`. The verdict is written as the same approval JSON the existing file-fallback path already polls for, so feedback flows back through a contract the server already understands. **Zero new wire protocol.**

### 3. Customize the view

![Settings overlay and help overlay](assets/demo-customize.gif)

`t` opens settings: confidence threshold to hide low-confidence atoms, color theme (vibrant, soft, or mono), compact mode, dependency arrows toggle. `?` shows the full keymap.

### Keys reference

| Key | Action |
|-----|--------|
| `j` / `k` | Move selection |
| `a` | Accept the selected atom |
| `r` | Reject (prompts for a one-line reason) |
| `u` | Clear feedback on the selected atom |
| `*` | Star as critical context |
| `s` | Submit verdict (writes `aot-approval-*.json`) |
| `t` | Settings (threshold, theme, compact mode, deps) |
| `?` | Keys help |
| `space` | Pause / resume event stream |
| `q` | Quit |

> [!TIP]
> Skip setup and see it in action: `npx -y @dioptx/mcp-atom-of-thoughts tui --demo`

---

<details>
<summary><b>Configuration</b></summary>

```json
{
  "args": ["-y", "@dioptx/mcp-atom-of-thoughts", "--mode", "fast", "--viz", "never"]
}
```

| Flag | Default | Effect |
|------|---------|--------|
| `--mode full\|fast\|both` | `both` | Which tools to register |
| `--viz auto\|always\|never` | `auto` | `auto`: render on `viz:true`. `always`: render every call. `never`: skip (CI) |
| `--max-depth <n>` | 5 / 3 | Override depth limit |
| `--output-dir <path>` | OS temp | Where to write viz HTML |
| `--downloads-dir <path>` | ~/Downloads | Approval JSON fallback |

</details>

<details>
<summary><b>Sessions</b></summary>

Each reasoning chain gets its own session. Default ID: `"default"`.

- `atomcommands new_session` creates and activates a new one.
- `atomcommands switch_session` / `list_sessions` / `reset_session` for management.
- When reasoning terminates, the session auto-archives. The next zero-dependency atom auto-spawns `default-2`, `default-3`, and so on.
- Or pass `sessionId` on any AoT call to target one explicitly.

Two problems in one MCP process stay isolated without manual session management.

</details>

<details>
<summary><b>Browser visualization (alternative to the TUI)</b></summary>

Prefer a browser tab to a terminal pane? Pass `viz: true` on any AoT call. The server writes a self-contained HTML file (D3 inlined, works offline) and opens it:

- Force-directed graph colored by atom type with confidence rings
- Sidebar to approve or reject phases or individual atoms
- Approve / reject POSTs to a local `127.0.0.1` listener on an ephemeral port; falls back to a `~/Downloads` file scan if the listener can't bind

The TUI and the browser viz both feed `atomcommands check_approval`. Pick whichever fits your workflow.

</details>

<details>
<summary><b>Install methods</b></summary>

**npx** (zero install):
```json
{ "command": "npx", "args": ["-y", "@dioptx/mcp-atom-of-thoughts"] }
```

**npm global**:
```bash
npm install -g @dioptx/mcp-atom-of-thoughts
```

**Smithery**:
```bash
npx -y @smithery/cli install @dioptx/mcp-atom-of-thoughts --client claude
```

**Docker**:
```bash
docker build -t aot . && docker run -i --rm aot
```

</details>

<details>
<summary><b>Development</b></summary>

```bash
git clone https://github.com/dioptx/mcp-atom-of-thoughts.git
cd mcp-atom-of-thoughts
npm ci
npm run build
npm test        # 217 tests (unit + e2e + workflow DAG safety)
npm run examples:dry-run
```

</details>

<details>
<summary><b>Migrating from v2</b></summary>

See [`MIGRATION_v2_to_v3.md`](MIGRATION_v2_to_v3.md) for the full lookup table. The short version:

- `AoT-light` is now `AoT-fast`
- `AoT` is now `AoT-full`
- `generate_visualization` is now `viz: true` on any AoT call
- `export_graph` and `check_approval` are now `atomcommands` subcommands
- `--no-viz` and `--no-approval` are replaced by `--viz auto|always|never`

</details>

---

MIT. Based on [Atom of Thoughts](https://arxiv.org/abs/2502.12018).
