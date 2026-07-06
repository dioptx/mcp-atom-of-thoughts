/**
 * Pure CLI hint helpers, kept standalone so they are testable without
 * spawning the CLI.
 */

export const GRAPH_RENDER_FORMATS = ['tree', 'mermaid', 'dot', 'canvas'] as const;

const ENVELOPE_FORMATS = ['toon', 'json', 'yaml', 'md', 'jsonl'] as const;

/**
 * Detects `aot graph --format mermaid`-style misuse, where a graph render
 * format is passed to the global `--format` output-envelope flag (which the
 * CLI framework rejects with an unhelpful "Invalid format" parse error).
 * Returns a hint message pointing at `--graphFormat`, or null when argv is
 * fine.
 */
export function graphFormatMisuseHint(argv: string[]): string | null {
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--format') value = argv[i + 1];
    else if (token.startsWith('--format=')) value = token.slice('--format='.length);
  }
  if (!value || !(GRAPH_RENDER_FORMATS as readonly string[]).includes(value)) return null;
  return [
    `Invalid format: "${value}". --format selects the CLI output envelope (${ENVELOPE_FORMATS.join(', ')}).`,
    `To render the graph as ${value}, use: aot graph --graphFormat ${value}`,
  ].join('\n');
}
