import * as os from 'node:os';
import * as path from 'node:path';

export type ServerMode = 'full' | 'fast' | 'both';

export interface ServerConfig {
  mode: ServerMode;
  vizEnabled: boolean;
  approvalEnabled: boolean;
  maxDepth: number;
  outputDir: string;
  downloadsDir: string;
}

const VALID_MODES: ServerMode[] = ['full', 'fast', 'both'];

export function parseArgs(argv: string[]): ServerConfig {
  const args = argv.slice(2);

  let mode: ServerMode = 'both';
  let vizEnabled = true;
  let approvalEnabled = true;
  let maxDepthOverride: number | undefined;
  let outputDir: string | undefined;
  let downloadsDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--mode': {
        const val = args[++i];
        if (!val || !VALID_MODES.includes(val as ServerMode)) {
          throw new Error(`Invalid --mode value: ${val ?? '(missing)'}. Must be one of: full, fast, both`);
        }
        mode = val as ServerMode;
        break;
      }
      case '--no-viz':
        vizEnabled = false;
        approvalEnabled = false;
        break;
      case '--no-approval':
        approvalEnabled = false;
        break;
      case '--max-depth': {
        const val = args[++i];
        const num = Number(val);
        if (!val || !Number.isInteger(num) || num <= 0) {
          throw new Error(`Invalid --max-depth value: ${val ?? '(missing)'}. Must be a positive integer`);
        }
        maxDepthOverride = num;
        break;
      }
      case '--output-dir':
        outputDir = args[++i];
        if (!outputDir) {
          throw new Error('--output-dir requires a path argument');
        }
        break;
      case '--downloads-dir':
        downloadsDir = args[++i];
        if (!downloadsDir) {
          throw new Error('--downloads-dir requires a path argument');
        }
        break;
      default:
        break;
    }
  }

  const defaultMaxDepth = mode === 'fast' ? 3 : 5;

  return {
    mode,
    vizEnabled,
    approvalEnabled,
    maxDepth: maxDepthOverride ?? defaultMaxDepth,
    outputDir: outputDir ?? path.join(os.tmpdir(), 'aot-diagrams'),
    downloadsDir: downloadsDir ?? path.join(os.homedir(), 'Downloads'),
  };
}
