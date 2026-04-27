# Examples — alternative trace viewers

Two standalone HTML renderers for AoT atom-graph exports. Read the JSON produced by `atomcommands export` and render a different visual than the default D3 force-graph in `src/visualization.ts`. Useful when a long-form text view reads better than an interactive graph — async review, documentation, or anywhere you want the atom content visible without clicking.

Both renderers consume the export JSON unchanged, plus two optional fields on verification atoms:

- `kills: string[]` — which hypotheses this verification eliminates
- `confirms: string[]` — which hypotheses this verification supports

The default D3 viewer ignores these. The viewers in this directory use them to highlight the killing-V → killed-H relationship.

## Renderers

### `render-review.mjs` — review viewer

Atom graph in a left rail (small) + stage-by-stage atom content as the main column. Stages are stacked top-to-bottom: Premises → Reasoning → Hypotheses → Verifications → Conclusion. The Verifications stage gets a focus treatment (cyan accent + "in focus" pill). Killed hypotheses are dimmed. Killing verifications get a red accent and an explicit `× kills H2` badge.

Use for full-trace review where you want both the structure and the content readable at a glance.

```bash
node examples/render-review.mjs examples/example-trace.json
# wrote examples/example-trace-review.html
```

Open the resulting HTML in a browser, or convert to PNG via Playwright / similar.

### `render-focus.mjs` — focus viewer

Verifications + Conclusion only, full-bleed. A single-frame summary of what the trace caught and what survived. Each V atom prints as a card with a `× KILLS H2` or `✓ confirms H1` banner.

```bash
node examples/render-focus.mjs examples/example-trace.json
# wrote examples/example-trace-focus.html
```

## Example data

`example-trace.json` — a synthetic trace ("pick a database for query telemetry") that exercises all five atom types and demonstrates the V-kills-H pattern. Both renderers should produce sensible output from this file. Use it as a template when building your own.

## Producing your own input JSON

```text
1. Run AoT-fast / AoT-full in your MCP-enabled session
2. Call atomcommands export (optionally with a title)
3. Save the returned `graph` object to disk as JSON
4. (Optional) Add `kills` / `confirms` fields to your verification atoms
   so the alternative viewers can highlight the V-kills-H relationships
```

If you don't add `kills` / `confirms`, the viewers still work — verifications just render as neutral verification atoms without the kill/confirm callouts.
