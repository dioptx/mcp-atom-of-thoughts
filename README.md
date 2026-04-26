<div align="center">

# Atom of Thoughts

Structured reasoning for LLMs. Decompose, track confidence, visualize, approve.

[![npm version](https://img.shields.io/npm/v/@dioptx/mcp-atom-of-thoughts?color=0969da)](https://www.npmjs.com/package/@dioptx/mcp-atom-of-thoughts)
[![license](https://img.shields.io/npm/l/@dioptx/mcp-atom-of-thoughts?color=22c55e)](LICENSE)
[![node](https://img.shields.io/node/v/@dioptx/mcp-atom-of-thoughts)](package.json)
[![tests](https://img.shields.io/badge/tests-183%20passed-brightgreen)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](tsconfig.json)

![Atom of Thoughts — live TUI watching reasoning unfold](assets/demo.gif)

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

**3.** Ask the model to reason something through:

> *"Use AoT-fast to think through whether we should use JWT or session-based auth for the API."*

The model decomposes the problem into atoms — premise, reasoning, hypothesis, verification, conclusion — each tagged with a confidence score. You get a structured chain you can audit, not a black-box answer.

> [!TIP]
> Works with Claude Code, Cursor, Windsurf, or any MCP-aware client.

## Install

**npx** *(recommended — zero install, always latest)*
```json
{ "command": "npx", "args": ["-y", "@dioptx/mcp-atom-of-thoughts"] }
```

**npm global**
```bash
npm install -g @dioptx/mcp-atom-of-thoughts
```
```json
{ "command": "mcp-atom-of-thoughts" }
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

Chain atoms together. Each carries a confidence score (0-1). Reasoning terminates when a high-confidence conclusion is reached or max depth is hit. Sessions isolate separate problems so they don't interfere.

## Tools

Three tools:

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

Only `atomId`, `content`, and `atomType` are required. Everything else has defaults.

### Visualization

Set `viz: true` on any call to open an interactive D3 graph in the browser:

```
AoT-fast({atomId:"C1", ..., viz: true})
```

The approve/reject UI posts decisions back to the server over HTTP. No filesystem polling.

## Live TUI

Watch reasoning unfold in a second terminal while the LLM works — and feed approve/reject decisions back into the next tool call. The event feed is on by default; nothing extra to configure.

In a second pane next to your LLM client:

```bash
npx -y @dioptx/mcp-atom-of-thoughts tui
```

As atoms stream in:

| Key | Action |
|-----|--------|
| `j` / `k` | Move selection |
| `a` | Accept the selected atom |
| `r` | Reject (prompts for a one-line reason) |
| `u` | Clear feedback on the selected atom |
| `*` | Star as critical context |
| `s` | **Submit** verdict — writes `aot-approval-*.json` |
| `t` | Settings (threshold, theme, compact mode, deps) |
| `?` | Keys help |
| `space` | Pause / resume event stream |
| `q` | Quit |

**The feedback loop:** submission writes the same approval-JSON shape that `atomcommands check_approval` already polls for (file fallback path; the v3 HTTP-callback path is independent). After pressing `s`, **prompt your LLM to call `atomcommands check_approval`** — it returns `NEEDS_REVISION` with your rejection notes (or `APPROVED`), and the model adjusts. Zero new wire protocol; the existing approval contract is reused.

> [!TIP]
> Skip setup, see it in action: `npx -y @dioptx/mcp-atom-of-thoughts tui --demo`

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
| `--viz auto\|always\|never` | `auto` | `auto` = render on `viz:true`; `always` = every call; `never` = skip (CI) |
| `--max-depth <n>` | 5 / 3 | Override depth limit |
| `--output-dir <path>` | OS temp | Where to write viz HTML |
| `--downloads-dir <path>` | ~/Downloads | Approval JSON fallback |

</details>

<details>
<summary><b>Sessions</b></summary>

Each reasoning chain gets its own session. Default: `"default"`.

- `atomcommands new_session` creates and activates a new one.
- `atomcommands switch_session` / `list_sessions` / `reset_session` for management.
- When reasoning terminates, the session auto-archives. The next zero-dep atom auto-spawns `default-2`, `default-3`, etc.
- Or pass `sessionId` on any AoT call to target explicitly.

Two problems in one MCP process stay isolated without manual session management.

</details>

<details>
<summary><b>Browser visualization (alternative to the TUI)</b></summary>

If you'd rather see the graph in a browser tab than a terminal pane, set `viz: true` on any AoT call. It generates a self-contained HTML file (D3 bundled inline, works offline) and opens your browser:

- Force-directed graph colored by atom type with confidence rings
- Sidebar to approve/reject phases or individual atoms
- Approve/reject POSTs to a local `127.0.0.1` listener (ephemeral port); falls back to `~/Downloads` file scan if the listener can't bind

The TUI and the browser viz both feed `atomcommands check_approval` — pick whichever fits your workflow.

</details>

<details>
<summary><b>Install Methods</b></summary>

**npx (zero install):**
```json
{ "command": "npx", "args": ["-y", "@dioptx/mcp-atom-of-thoughts"] }
```

**npm global:**
```bash
npm install -g @dioptx/mcp-atom-of-thoughts
```

**Smithery:**
```bash
npx -y @smithery/cli install @dioptx/mcp-atom-of-thoughts --client claude
```

**Docker:**
```bash
docker build -t aot . && docker run -i --rm aot
```

</details>

<details>
<summary><b>Development</b></summary>

```bash
git clone https://github.com/dioptx/mcp-atom-of-thoughts.git
cd mcp-atom-of-thoughts
npm install
npm test        # 183 tests (unit + e2e)
npm run build
```

</details>

<details>
<summary><b>Migrating from v2</b></summary>

See [`MIGRATION_v2_to_v3.md`](MIGRATION_v2_to_v3.md) for the full lookup table. The short version:

- `AoT-light` is now `AoT-fast`
- `AoT` is now `AoT-full`
- `generate_visualization` is now `viz: true` on any AoT call
- `export_graph` and `check_approval` are now `atomcommands` subcommands
- `--no-viz` / `--no-approval` replaced by `--viz auto|always|never`

</details>

---

MIT · Based on [Atom of Thoughts](https://arxiv.org/abs/2502.12018)
