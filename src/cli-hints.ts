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
 * Scoped to the `graph` command — other commands (e.g. `aot list --format
 * mermaid`) fall through to the framework's own error. Returns a hint
 * message pointing at `--graphFormat`, or null when argv is fine.
 */
export function graphFormatMisuseHint(argv: string[]): string | null {
  if (argv[0] !== 'graph') return null;
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

/** Converts a kebab-case flag name to the camelCase schema key. */
function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Extracts the option names whose (unwrapped) zod type is boolean from a
 * command's `options` z.object schema. Duck-typed so it stays decoupled from
 * the CLI framework's internals; returns an empty set for anything that does
 * not look like a z.object.
 */
export function booleanOptionNames(schema: unknown): Set<string> {
  const names = new Set<string>();
  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape;
  if (!shape || typeof shape !== 'object') return names;
  for (const [key, field] of Object.entries(shape)) {
    let inner = field as { def?: { innerType?: unknown; type?: string } };
    while (inner?.def?.innerType) inner = inner.def.innerType as typeof inner;
    if (inner?.def?.type === 'boolean') names.add(key);
  }
  return names;
}

/**
 * Rewrites kebab-case `--no-br`-style tokens to the camelCase boolean flag
 * the command actually declares (`--noBr`). The framework intercepts
 * `--no-X` as boolean negation of flag `X`, so flags whose OWN name starts
 * with `no` (noBr, noBv, noGit, noBeads, noBrInit, ...) are unreachable in
 * the kebab form the help screen prints. Mutates nothing; returns a new argv.
 */
export function rewriteNegatedBoolFlags(argv: string[], booleanFlags: ReadonlySet<string>): string[] {
  return argv.map(token => {
    if (!token.startsWith('--no-')) return token;
    const camel = kebabToCamel(token.slice(2).split('=')[0]);
    if (!booleanFlags.has(camel)) return token;
    const eq = token.indexOf('=');
    return eq >= 0 ? `--${camel}${token.slice(eq)}` : `--${camel}`;
  });
}

/**
 * Detects `aot new --sessionId x` / `aot fast --atomId P1`-style misuse where
 * a POSITIONAL argument of the invoked command is passed as a flag. The
 * framework's bare "Unknown flag" gives no clue the name exists as a
 * positional. Returns a hint or null.
 */
export function positionalFlagMisuseHint(argv: string[], positionalNames: readonly string[]): string | null {
  if (positionalNames.length === 0) return null;
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const name = kebabToCamel(token.slice(2).split('=')[0]);
    if (positionalNames.includes(name)) {
      return [
        `Unknown flag: --${name}. "${name}" is a positional argument of this command, not a flag.`,
        `Pass it positionally, e.g.: aot ${argv[0]} ${positionalNames.map(p => `<${p}>`).join(' ')}`,
      ].join('\n');
    }
  }
  return null;
}

/**
 * Detects the bare-boolean-flag footgun: `--verified false` parses as
 * `verified: true` (bare boolean flag) with `false` silently dropped as an
 * extra positional, so the user writes the WRONG state with a success
 * response. Fires only when a known boolean flag of the invoked command is
 * immediately followed by a literal `true`/`false` token. Returns a hint
 * telling the user to use the unambiguous `=` form, or null when argv is
 * fine. Tokens after a bare `--` separator are ignored.
 */
export function booleanFlagLiteralHint(argv: string[], booleanFlags: ReadonlySet<string>): string | null {
  if (booleanFlags.size === 0) return null;
  for (let i = 0; i < argv.length - 1; i++) {
    const token = argv[i];
    if (token === '--') break;
    if (!token.startsWith('--') || token.includes('=')) continue;
    const next = argv[i + 1];
    // Case-insensitive: `--verified False`/`TRUE`/`False` are just as
    // silently dropped by the parser as the lowercase literals.
    const nextLower = next.toLowerCase();
    if (nextLower !== 'true' && nextLower !== 'false') continue;
    const raw = token.slice(2);
    const negated = raw.startsWith('no-') && booleanFlags.has(kebabToCamel(raw.slice(3)));
    const name = negated ? kebabToCamel(raw.slice(3)) : kebabToCamel(raw);
    if (!negated && !booleanFlags.has(name)) continue;
    const wanted = nextLower === 'true';
    return [
      `Ambiguous boolean flag: "${token} ${next}". Bare ${token} already means ${negated ? 'false' : 'true'}, and "${next}" would be silently ignored as a stray positional.`,
      `Use the explicit form instead: --${name}=${wanted ? 'true' : 'false'}${wanted ? ` (or bare --${name})` : ` (or --no-${name})`}.`,
    ].join('\n');
  }
  return null;
}
