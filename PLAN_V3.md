# mcp-atom-of-thoughts v3 — UX refactor plan

## Goals

1. Make tool selection obvious (rename + collapse).
2. Visualization on demand, never surprising.
3. Session boundaries that don't leak between problems.
4. Approval flow that works the same on every OS.
5. Slimmer response payloads.

Breaking changes are accepted. v3.0.0 is a clean cut — no aliases for v2 tool names.

## Final tool surface (3 tools, down from 6)

| Tool | Purpose |
|------|---------|
| `AoT-fast` | Default reasoning. Depth 3. Auto-suggests conclusions. |
| `AoT-full` | Decomposition-contraction reasoning. Depth 5. |
| `atomcommands` | All lifecycle/meta ops: sessions, decomposition controls, export, approval polling. |

`generate_visualization` → folded into `viz: true` param on `AoT-fast` / `AoT-full`.
`check_approval` → folded into `atomcommands` as `command: "check_approval"`.
`export_graph` → folded into `atomcommands` as `command: "export"`.

## Phases

Each phase is a self-contained PR. Land in order. Tests stay green at every phase boundary.

---

### Phase 1 — Tool rename + surface collapse

Files: `src/tools.ts`, `src/index.ts`, `src/config.ts`, `tests/tools.test.ts`, `tests/integration.test.ts`.

- Rename `AOT_LIGHT_TOOL` → `AOT_FAST_TOOL`, name string `"AoT-light"` → `"AoT-fast"`.
- Rename `AOT_TOOL` → `AOT_FULL_TOOL`, name string `"AoT"` → `"AoT-full"`.
- Tool descriptions rewritten to a single decision rule (see §"Tool descriptions" below).
- Delete `GENERATE_VISUALIZATION_TOOL` and `CHECK_APPROVAL_TOOL` exports.
- Delete `EXPORT_GRAPH_TOOL` export.
- Add to `ATOM_COMMANDS_TOOL` enum: `"export"`, `"check_approval"`.
- `getTools(config)` returns at most 3 tools.
- `index.ts` dispatch: route renamed names; route folded subcommands through `atomcommands`.
- Update tests for new names + new dispatch. Old tool-name tests should fail clearly.

Acceptance: 3 tools registered. All renamed tests pass. No dangling references to `AoT-light` or `generate_visualization` in `src/`.

---

### Phase 2 — Viz toggle

Files: `src/tools.ts`, `src/atom-server.ts`, `src/atom-light-server.ts`, `src/config.ts`, `src/visualization.ts`, `tests/visualization.test.ts`.

- Add `viz?: boolean` to `AoT-fast` and `AoT-full` input schemas.
- Server flag `--viz <auto|always|never>` (default `auto`):
  - `auto`: render only when `viz: true` in the call.
  - `always`: render on every atom call (override).
  - `never`: ignore `viz: true`, never render (CI/headless).
- Tool description guidance: *"Set `viz: true` when you're in planning mode or the user is reviewing your reasoning. Leave false during execution."*
- On render: write HTML to output dir, open in default browser, include `vizUrl` in the response payload.
- Drop `--no-viz`/`--no-approval` flags (replaced by `--viz never`).
- Termination does **not** auto-render (per Decision A — explicit-only).

Acceptance: `viz: true` → HTML rendered + browser opens + path in response. `--viz never` suppresses everything. `--viz always` ignores the param. `viz: false`/omitted → no render.

---

### Phase 3 — Sessions

Files: `src/atom-server.ts`, `src/atom-light-server.ts`, `src/types.ts`, `src/tools.ts`, `src/index.ts`, `tests/atom-server.test.ts`, `tests/atom-light-server.test.ts`.

- New `Session` type: `{ id: string; atoms: Record<string, AtomData>; atomOrder: string[]; verifiedConclusions: string[]; decompositionStates: Record<string, DecompositionState>; status: 'active' | 'completed'; createdAt: number }`.
- `AtomOfThoughtsServer` holds `sessions: Record<string, Session>` + `activeSessionId: string` (default `"default"`).
- All atom state moves from server fields to active session.
- AoT input schema gains optional `sessionId?: string`. If provided and unknown, auto-create. If omitted, use active.
- `atomcommands` gains:
  - `new_session` (optional `sessionId`; auto-generates if omitted; activates)
  - `switch_session` (requires `sessionId`)
  - `list_sessions` (returns all session IDs + status + atom counts)
  - `reset_session` (optional `sessionId`; defaults to active; wipes atoms)
- **Auto-archive**: when `shouldTerminate: true` fires, set session `status = 'completed'`. Active session pointer stays put.
- **Auto-spawn**: on the next atom call with `dependencies: []` and no explicit `sessionId`, if the active session is `completed`, auto-create `default-N` and activate.

Acceptance: Two sequential reasoning problems do not pollute each other's atoms. Explicit `new_session` works. Auto-spawn fires correctly after termination. `list_sessions` returns sane data.

---

### Phase 4 — Approval via local HTTP callback

Files: `src/approval.ts` (rewrite), `src/visualization.ts`, `src/index.ts`, `src/config.ts`, new `src/approval-server.ts`, `tests/approval.test.ts`.

- Rewrite `approval.ts`. Remove `~/Downloads` polling.
- New `approval-server.ts`: starts an `http` listener on `127.0.0.1` at a free port (use `0` and read assigned port). Endpoint: `POST /approval` with body `{ sessionId, atomId, status: 'approved' | 'rejected', comment?: string, timestamp }`.
- Server holds `approvals: Map<sessionId, ApprovalRecord[]>` in memory.
- `visualization.ts`: when generating HTML, embed the callback URL (`http://127.0.0.1:<port>/approval`) and `sessionId` so the browser POSTs back automatically on approve/reject.
- `atomcommands: {command: "check_approval", sessionId?}` returns approvals for the given (or active) session.
- **Fallback**: if `listen()` fails (rare — locked corp machine), use `env-paths` to write to a per-platform cache dir: `<cacheDir>/atom-of-thoughts/sessions/<sessionId>/approval.json`. `check_approval` reads from there if no HTTP server is up. Add `env-paths` to deps.
- Browser HTML keeps the existing approve/reject UI + comment field; the JS just changes from "save JSON download" to "POST to callback URL, fall back to download if fetch fails".

Acceptance: Approve in browser → `check_approval` returns it without a filesystem hop. Multiple concurrent sessions stay separated. Falls back gracefully if port bind fails.

---

### Phase 5 — Response slimming

Files: `src/atom-server.ts`, `src/atom-light-server.ts`, `tests/atom-server.test.ts`.

In `processAtom` response payloads, omit fields when empty/null:

- `dependentAtoms` — omit if `[]`
- `conflictingAtoms` — omit if `[]`
- `currentDecomposition` — omit if `null`
- `bestConclusion` — already conditional (keep)
- `verifiedConclusions` — omit if `[]`

Default response shrinks from ~12 fields to ~6 in the common case.

Acceptance: Snapshot tests updated; payload byte-size measurably smaller in benchmark fixture.

---

### Phase 6 — Docs + migration

Files: `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `package.json`.

- `package.json`: bump to `3.0.0`.
- `CHANGELOG.md`: v3.0.0 entry. **Breaking changes** subsection lists every rename + every removed tool with the new equivalent.
- `README.md`: rewrite the Tools table; add a Sessions section; add a Visualization section that explains the planning-mode heuristic.
- `CLAUDE.md`: update tool list + atom commands enum; update `~/.claude/CLAUDE.md` orchestrator section separately (out of repo) so the `mcp__atom-of-thoughts__*` references match.
- Add a `MIGRATION_v2_to_v3.md` short doc with a table of old → new.

Acceptance: Fresh reader can pick the right tool from the README in under 30 seconds. CHANGELOG enumerates every breaking change. Out-of-repo orchestrator doc updated.

---

## Tool descriptions (the one-liner decision rule)

```
AoT-fast: Structured reasoning. Use for any problem that benefits from
explicit premise → reasoning → hypothesis → verification → conclusion
chains. Up to 5 atoms per session. Most tasks belong here.
Set viz:true when in planning mode or when the user is reviewing.

AoT-full: Same shape as AoT-fast but supports decomposition-contraction —
break atoms into sub-atoms, verify independently, contract back. Use only
when you'll need >5 atoms or multi-angle verification on the same hypothesis.
```

## Out of scope for v3

- Confidence calibration (kept as self-rated; revisit in v3.x).
- Benchmark harness (deferred per Decision 5).
- Persisted sessions across MCP process restarts (sessions are in-memory only).
- Multi-tenancy / remote MCP transport (stdio only).

## Risks

- **HTTP server in MCP process**: adds a port. Mitigation: bind `127.0.0.1` only, ephemeral port, document the behavior, keep filesystem fallback.
- **Auto-spawn session magic** could surprise users. Mitigation: include the new sessionId in every response so it's always visible.
- **Tool rename breaks existing skill files**: my `~/.agents/` orchestrator config + the `aot-plan` / `aot` skill files reference `mcp__atom-of-thoughts__AoT-light`. Phase 6 must catch these — grep before merging.

## Open follow-ups (post-v3)

- Confidence: ground-truth via verification atom checks against external state (tests, docs, code).
- Persistence: optional SQLite-backed sessions for cross-process continuity.
- Benchmark suite: small custom eval against MMLU-hard / GPQA / curated real tickets.
