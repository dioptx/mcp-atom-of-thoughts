# mcp-atom-of-thoughts

MCP server for structured reasoning via Atom of Thoughts. Decomposes problems into atomic units (premise → reasoning → hypothesis → verification → conclusion) with confidence tracking and optional D3 visualization.

## Architecture

```
index.ts          — MCP server entry, tool dispatch
atom-server.ts    — Full AoT (depth 5, decomposition-contraction)
atom-light-server.ts — AoT-light (depth 3, fast)
tools.ts          — MCP tool definitions (6 tools)
types.ts          — AtomData, GraphNode, GraphLink, ApprovalResult
config.ts         — CLI arg parsing (--mode, --viz, --max-depth)
visualization.ts  — D3.js interactive graph renderer
graph-export.ts   — JSON export of atom graph
approval.ts       — Browser-based approval polling
d3-bundle.ts      — D3 asset bundler
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `AoT-light` | Fast structured reasoning (depth 3). Default for most tasks |
| `AoT` | Full reasoning with decomposition-contraction (depth 5) |
| `atomcommands` | Control decomposition lifecycle: decompose, complete, termination_status, best_conclusion, set_max_depth |
| `export_graph` | Export atom graph as JSON |
| `generate_visualization` | Render D3 interactive visualization and open in browser |
| `check_approval` | Poll for browser-based approval JSON in downloads dir |

## Atom Types

`premise` (P) → `reasoning` (R) → `hypothesis` (H) → `verification` (V) → `conclusion` (C)

Each atom has: `atomId`, `content`, `atomType` (required), `dependencies` (default []), `confidence` (default 0.7).

## Server Modes

- `--mode fast` — AoT-light only (depth 3)
- `--mode full` — Full AoT only (depth 5)
- `--mode both` — Both tools available (default)
- `--viz` — Enable D3 visualization + approval tools
- `--max-depth N` — Override max depth

## Development

```bash
npm run build          # tsc + copy d3 asset
npm test               # vitest (121 tests)
npm run test:watch     # vitest watch mode
```

### Testing Conventions
- Tests are in `tests/` using Vitest
- Test atom servers directly via their class methods, not through MCP transport
- Use descriptive atom IDs in tests (P1, R1, H1, V1, C1)

### Key Constraints
- Only `atomId`, `content`, `atomType` are required fields — all others have defaults
- Atoms with dependencies must reference existing atom IDs
- Confidence must be 0-1
- Depth is auto-calculated from dependencies if omitted
- Full AoT supports decomposition-contraction; AoT-light does not
