# Atom of Thoughts — Agent Quick Reference

You have 3 MCP tools. Here's when to use each and how to call them.

## Decision tree

```
Need to reason through something?
  ├── ≤5 atoms, no sub-problems → AoT-fast
  ├── >5 atoms, decomposition, multi-angle verification → AoT-full
  └── Session/lifecycle/meta operation → atomcommands
```

## AoT-fast (default)

Use for: tradeoff analysis, root cause debugging, option evaluation, architecture micro-decisions.

```
AoT-fast({atomId:"P1", content:"The constraint is X", atomType:"premise"})
AoT-fast({atomId:"H1", content:"Option A: do Y", atomType:"hypothesis", dependencies:["P1"]})
AoT-fast({atomId:"H2", content:"Option B: do Z", atomType:"hypothesis", dependencies:["P1"]})
AoT-fast({atomId:"C1", content:"Go with A because...", atomType:"conclusion", dependencies:["H1","H2"], confidence:0.9})
```

**Required**: `atomId`, `content`, `atomType`.
**Optional**: `dependencies` (default []), `confidence` (default 0.7), `viz` (default false), `sessionId` (default active).

Atom types in order: `premise` → `reasoning` → `hypothesis` → `verification` → `conclusion`.

## AoT-full

Same schema as AoT-fast. Use when you need depth 5 or decomposition-contraction (break atoms into sub-atoms via `atomcommands decompose`).

## Visualization

Set `viz: true` on an atom call to render a D3 graph and open it in the browser. Do this:
- When the user is reviewing your reasoning (planning mode)
- On your conclusion atom when the plan is large
- When the user explicitly asks to see the graph

Do NOT set `viz: true` during execution flows (writing code, running tests, etc.).

## atomcommands

| Command | Required params | What it does |
|---------|----------------|--------------|
| `new_session` | `sessionId?` | Create + activate a fresh session |
| `switch_session` | `sessionId` | Activate an existing session |
| `list_sessions` | — | List all sessions with status + atom counts |
| `reset_session` | `sessionId?` | Wipe atoms in a session (default: active) |
| `export` | `title?` | Get the atom graph as JSON |
| `check_approval` | `sessionId?` | Poll for browser approve/reject decisions |
| `decompose` | `atomId` | Break an atom into sub-atoms (AoT-full) |
| `complete_decomposition` | `decompositionId` | Finish a decomposition |
| `termination_status` | — | Check if reasoning should stop |
| `best_conclusion` | — | Get highest-confidence verified conclusion |
| `set_max_depth` | `maxDepth` | Change depth limit |

## Sessions

Sessions isolate atom graphs. You usually don't need to manage them:
- Default session `"default"` exists at startup.
- When reasoning terminates, the session archives automatically.
- Your next zero-dep atom auto-spawns `default-2`, `default-3`, etc.

Manage explicitly when you need parallel investigations:
```
atomcommands({command:"new_session", sessionId:"side-investigation"})
AoT-fast({atomId:"P1", content:"...", atomType:"premise"})
atomcommands({command:"switch_session", sessionId:"default"})
```

## Approval flow

1. Set `viz: true` on your final atom — the browser opens with an interactive graph.
2. The user clicks approve/reject — the browser POSTs back to the server.
3. Poll: `atomcommands({command:"check_approval"})`.
4. Response `approval.status` is `APPROVED`, `NEEDS_REVISION`, or `PENDING`.

## Rules of thumb

- 3-6 atoms for typical decisions. Don't overdo it.
- Present your conclusion to the user, not the raw atom JSON.
- `confidence: 0.9+` on your conclusion signals you're done.
- Skip AoT entirely for obvious answers or tasks with a dedicated skill.
