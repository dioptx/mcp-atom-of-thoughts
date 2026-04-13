# mcp-atom-of-thoughts (v3)

MCP server for structured reasoning via Atom of Thoughts. Decomposes problems into atomic units (premise → reasoning → hypothesis → verification → conclusion) with confidence tracking, session scoping, and on-demand D3 visualization.

## Architecture

```
index.ts          — MCP server entry, tool dispatch, viz attachment, approval server
atom-server.ts    — Full AoT (depth 5, decomposition-contraction) with session-scoped state
atom-light-server.ts — AoT-fast (depth 3) — extends atom-server, lighter response shape
tools.ts          — MCP tool definitions (3 tools)
types.ts          — AtomData, Session, GraphNode, GraphLink, ApprovalResult
config.ts         — CLI arg parsing (--mode, --viz, --max-depth, --output-dir, --downloads-dir)
visualization.ts  — D3.js interactive graph renderer (callback URL embedded)
graph-export.ts   — JSON export of atom graph
approval.ts       — File-based approval polling (fallback path)
approval-server.ts — Local 127.0.0.1 HTTP listener for browser → server callbacks
d3-bundle.ts      — D3 asset bundler
```

## MCP Tools (3)

| Tool | Purpose |
|------|---------|
| `AoT-fast` | Default reasoning. Depth 3, auto-suggests conclusions. Set `viz:true` during planning |
| `AoT-full` | Deep reasoning with decomposition-contraction. Depth 5. Same shape as AoT-fast, plus decomposition controls |
| `atomcommands` | Lifecycle/meta: `decompose`, `complete_decomposition`, `termination_status`, `best_conclusion`, `set_max_depth`, `export`, `check_approval`, `new_session`, `switch_session`, `list_sessions`, `reset_session` |

## Atom Types

`premise` (P) → `reasoning` (R) → `hypothesis` (H) → `verification` (V) → `conclusion` (C)

Each atom: `atomId`, `content`, `atomType` (required), `dependencies` (default []), `confidence` (default 0.7), optional `viz` (default false), optional `sessionId` (default active session).

## Sessions

- All atom state scoped to a `sessionId` (default `"default"`).
- Auto-archive on `shouldTerminate`; auto-spawn fresh `default-N` on next zero-dep atom.
- Two reasoning problems in the same MCP process do not collide.
- Every response includes `sessionId`.

## Visualization

- Set `viz: true` on any AoT call to render the D3 graph and open it in the browser.
- The HTML embeds a callback URL (`http://127.0.0.1:<port>/approval`) that the approve/reject UI POSTs to.
- `atomcommands check_approval` reads the in-memory store keyed by sessionId. Falls back to file polling on the configured downloads dir if the listener can't bind or the POST fails.

## Server Modes

- `--mode fast` — AoT-fast only (depth 3)
- `--mode full` — AoT-full only (depth 5)
- `--mode both` — Both registered (default)
- `--viz auto|always|never` — viz rendering policy (default `auto`)
- `--max-depth N` — Override max depth
- `--output-dir PATH` — Visualization HTML output directory
- `--downloads-dir PATH` — Approval JSON fallback directory

## Development

```bash
npm run build          # tsc + copy d3 asset
npm test               # vitest (165 tests)
npm run test:watch     # vitest watch mode
```

### Testing Conventions
- Tests in `tests/` using Vitest
- Test atom servers directly via class methods, not through MCP transport
- Use descriptive atom IDs in tests (P1, R1, H1, V1, C1)
- Test files: `tools.test.ts`, `atom-server.test.ts`, `atom-light-server.test.ts`, `config.test.ts`, `integration.test.ts`, `visualization.test.ts`, `graph-export.test.ts`, `types.test.ts`, `approval.test.ts`, `approval-server.test.ts`, `sessions.test.ts`, `payload-shape.test.ts`

### Key Constraints
- Only `atomId`, `content`, `atomType` are required — all others have defaults
- Dependencies must reference existing atom IDs in the same session
- Confidence must be 0–1
- Depth is auto-calculated from dependencies if omitted
- Full AoT supports decomposition-contraction; AoT-fast does not
- Empty/null fields are omitted from response payloads
