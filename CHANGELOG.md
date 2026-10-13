# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- `examples/` directory with two alternative HTML viewers for atom-graph exports
  and a synthetic `example-trace.json` demonstrating the V-kills-H pattern.
  - `render-review.mjs` — small graph in a left rail + stage-by-stage atom
    content; verifications stage in focus.
  - `render-focus.mjs` — verifications and conclusion only, full-bleed.
  - Both consume the unchanged output of `atomcommands export` and additionally
    honor optional `kills` / `confirms` fields on verification atoms to
    highlight which hypotheses each verification eliminates or supports. The
    default D3 viewer ignores these fields, so adding them is non-breaking.

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
