# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
