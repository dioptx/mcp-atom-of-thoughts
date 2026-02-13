<div align="center">

# Atom of Thoughts

Structured reasoning for LLMs. Decompose → track confidence → visualize.

[![npm version](https://img.shields.io/npm/v/@dioptx/mcp-atom-of-thoughts?color=0969da)](https://www.npmjs.com/package/@dioptx/mcp-atom-of-thoughts)
[![license](https://img.shields.io/npm/l/@dioptx/mcp-atom-of-thoughts?color=22c55e)](LICENSE)
[![node](https://img.shields.io/node/v/@dioptx/mcp-atom-of-thoughts)](package.json)
[![tests](https://img.shields.io/badge/tests-121%20passed-brightgreen)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](tsconfig.json)

![Atom of Thoughts — interactive D3 visualization](assets/demo.png)

</div>

---

## Setup

Add to your MCP config:

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

> [!TIP]
> Works with Claude Code, Cursor, Windsurf, or any MCP client.

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

Atoms depend on each other, carry confidence scores (0–1), and auto-terminate when a high-confidence conclusion is reached or max depth is hit.

## Tools

| Tool | Purpose |
|------|---------|
| `AoT` | Deep reasoning — atoms up to depth 5 |
| `AoT-light` | Fast reasoning — depth 3, auto-suggests conclusions |
| `atomcommands` | Decompose atoms, check termination, adjust depth |
| `export_graph` | Get the atom graph as JSON |
| `generate_visualization` | Open an interactive D3 graph in your browser |
| `check_approval` | Poll for approve/reject decisions from the UI |

---

<details>
<summary><b>Configuration</b></summary>

Pass flags via `args` to change behavior:

```json
{
  "args": ["-y", "@dioptx/mcp-atom-of-thoughts", "--mode", "fast", "--no-viz"]
}
```

| Flag | Default | What it does |
|------|---------|--------------|
| `--mode full\|fast\|both` | `both` | Which reasoning tools to register |
| `--no-viz` | off | Skip visualization and approval tools |
| `--no-approval` | off | Skip approval tool only |
| `--max-depth <n>` | 5 / 3 | Override reasoning depth limit |
| `--output-dir <path>` | OS temp | Where to write visualization HTML |
| `--downloads-dir <path>` | ~/Downloads | Where to scan for approval files |

</details>

<details>
<summary><b>Visualization & Approval</b></summary>

`generate_visualization` creates a self-contained HTML file (D3 bundled inline — works offline) and opens it in your browser. The UI shows:

- Force-directed graph of all atoms and their dependencies
- Color-coded nodes by type with confidence rings
- Sidebar to approve/reject each phase or individual atom
- JSON export that `check_approval` can poll

No internet connection required — everything is inlined into a single HTML file.

</details>

<details>
<summary><b>Install Methods</b></summary>

**npx (recommended — zero install):**
```json
{ "command": "npx", "args": ["-y", "@dioptx/mcp-atom-of-thoughts"] }
```

**npm global:**
```bash
npm install -g @dioptx/mcp-atom-of-thoughts
```
```json
{ "command": "mcp-atom-of-thoughts" }
```

**Smithery:**
```bash
npx -y @smithery/cli install @dioptx/mcp-atom-of-thoughts --client claude
```

**Docker:**
```bash
docker build -t aot .
```
```json
{ "command": "docker", "args": ["run", "-i", "--rm", "aot"] }
```

</details>

<details>
<summary><b>Development</b></summary>

```bash
git clone https://github.com/dioptx/mcp-atom-of-thoughts.git
cd mcp-atom-of-thoughts
npm install
npm test        # 121 tests
npm run build
```

</details>

---

MIT · Based on [Atom of Thoughts](https://arxiv.org/abs/2502.12018)
