# Migrating from v2 to v3

v3 is a breaking release. The full picture is in `CHANGELOG.md`. This file is a quick lookup table for migration.

## Tool calls

| v2 | v3 |
|----|----|
| `mcp__atom-of-thoughts__AoT-light(...)` | `mcp__atom-of-thoughts__AoT-fast(...)` |
| `mcp__atom-of-thoughts__AoT(...)` | `mcp__atom-of-thoughts__AoT-full(...)` |
| `mcp__atom-of-thoughts__generate_visualization({title})` | `mcp__atom-of-thoughts__AoT-full({..., viz: true})` or `AoT-fast({..., viz: true})` |
| `mcp__atom-of-thoughts__check_approval({downloadsDir})` | `mcp__atom-of-thoughts__atomcommands({command: "check_approval", sessionId?})` |
| `mcp__atom-of-thoughts__export_graph({title})` | `mcp__atom-of-thoughts__atomcommands({command: "export", title})` |

## CLI flags

| v2 | v3 |
|----|----|
| `--no-viz` | `--viz never` |
| `--no-approval` | (gone — approval is always available; control viz via `--viz`) |
| `--viz` (boolean) | `--viz auto\|always\|never` (string) |
| `--mode`, `--max-depth`, `--output-dir`, `--downloads-dir` | unchanged |

## Server config (Smithery / programmatic)

| v2 field | v3 field |
|----------|----------|
| `noViz: boolean` | `vizMode: 'auto' \| 'always' \| 'never'` |
| `noApproval: boolean` | (gone) |
| everything else | unchanged |

## Tool surface

| v2 (6 tools) | v3 (3 tools) |
|--------------|--------------|
| `AoT-light` | `AoT-fast` |
| `AoT` | `AoT-full` |
| `atomcommands` | `atomcommands` (gains `export`, `check_approval`, `new_session`, `switch_session`, `list_sessions`, `reset_session` subcommands) |
| `export_graph` | folded into `atomcommands` |
| `generate_visualization` | folded into `viz: true` param |
| `check_approval` | folded into `atomcommands` |

## New in v3 — sessionId

Every AoT call now accepts an optional `sessionId: string`. If you have multiple reasoning problems in one MCP process, name your sessions to keep them isolated. Otherwise the default behavior auto-spawns fresh sessions when prior ones terminate, so most callers don't need to do anything.

```js
// Same problem
mcp__atom-of-thoughts__AoT-fast({atomId: "P1", content: "...", atomType: "premise"})
mcp__atom-of-thoughts__AoT-fast({atomId: "R1", content: "...", atomType: "reasoning", dependencies: ["P1"]})

// Different problem, same process — auto-spawns "default-2" if first terminated:
mcp__atom-of-thoughts__AoT-fast({atomId: "P1", content: "fresh problem", atomType: "premise"})

// Or scope explicitly:
mcp__atom-of-thoughts__AoT-fast({sessionId: "debug-auth", atomId: "P1", content: "...", atomType: "premise"})
```

## Response payload

Default response is leaner. Empty arrays and unactionable fields are omitted:

| Field | v2 | v3 |
|-------|----|----|
| `atomId`, `atomType`, `confidence`, `depth`, `atomsCount` | always | always |
| `sessionId` | not present | always (NEW) |
| `dependentAtoms`, `conflictingAtoms`, `verifiedConclusions` | always (`[]`) | only when non-empty |
| `currentDecomposition` | always (`null`) | only when active |
| `terminationStatus` | always | only when `shouldTerminate: true` |
| `bestConclusion` | always (`null`) | only when one exists |

If you parse responses by field-name lookup, this is a no-op (just check for absence). If you do exhaustive shape matching, update accordingly.

## Approval flow

The browser approve/reject UI now POSTs to a local `127.0.0.1:<ephemeral-port>` listener instead of writing to `~/Downloads`. `check_approval` reads the in-memory store. Falls back to file polling if the listener can't bind.

You don't need to change anything to get the new behavior. The old `~/Downloads` flow still works as a fallback.

## External references to update

If you keep your own dotfiles / skill files / docs that reference the v2 tool names directly, search-and-replace:

- `mcp__atom-of-thoughts__AoT-light` → `mcp__atom-of-thoughts__AoT-fast`
- `mcp__atom-of-thoughts__AoT` (when meaning the deep tool) → `mcp__atom-of-thoughts__AoT-full`
- `mcp__atom-of-thoughts__generate_visualization` → use `viz: true` on AoT calls
- `mcp__atom-of-thoughts__check_approval` → `atomcommands` subcommand
- `mcp__atom-of-thoughts__export_graph` → `atomcommands` subcommand

The audit doc `AUDIT_v2_to_v3_dotfiles.md` (committed at the start of the v3 work) was an inventory of one developer's specific dotfiles. Yours will differ; the patterns are the same.
